use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::bins::find_binary;
use crate::media_probe::probe_keyframes_near;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportSegment {
    pub start: f64,
    pub end: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportAudioTrack {
    /// 0-based audio stream index in the source file (`0:a:{audio_index}`)
    pub audio_index: usize,
    pub title: String,
    pub language: Option<String>,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportMixedAudioTrack {
    pub source_audio_indices: Vec<usize>,
    /// Optional per-track gain in dB (0.0 = unchanged)
    pub gains_db: Vec<f64>,
    pub title: String,
    /// "flac" (default lossless), "pcm_s24le", or "aac"
    pub codec: String,
    pub normalize: bool,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SmartCutVideoMeta {
    pub codec_name: String,
    pub fps: f64,
    pub pix_fmt: Option<String>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub color_range: Option<String>,
    pub time_base_den: u32,
    pub master_display: Option<String>,
    pub max_cll: Option<String>,
    pub format_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportExternalAudioTrack {
    pub file_path: String,
    pub title: String,
    pub language: Option<String>,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportSubtitleTrack {
    /// "internal" | "external"
    pub source_kind: String,
    /// For internal tracks: 0-based subtitle index (`0:s:{idx}`)
    pub subtitle_index: Option<usize>,
    /// For external tracks: path to `.srt`/`.ass`/`.vtt`/`.sup`
    pub file_path: Option<String>,
    pub codec_name: String,
    pub title: String,
    pub language: Option<String>,
    pub is_default: bool,
    /// Time offset in seconds (+ = delay/later, - = advance/earlier), matching mpv `sub-delay`
    #[serde(default)]
    pub delay_sec: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExtractAudioItem {
    pub audio_index: usize,
    pub output_path: String,
    pub codec_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExtractSubtitleItem {
    pub subtitle_index: usize,
    pub output_path: String,
    pub codec_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportRequest {
    pub input_path: String,
    pub output_path: String,
    /// Output container format: "mkv" (default) or "mp4"
    #[serde(default)]
    pub output_format: String,
    pub total_source_duration: f64,
    /// True when the entire video is kept without cutting any segments
    pub is_full_file: bool,
    /// Ordered, non-overlapping kept time intervals
    pub kept_segments: Vec<ExportSegment>,
    pub keep_audio_tracks: Vec<ExportAudioTrack>,
    #[serde(default)]
    pub external_audio_tracks: Vec<ExportExternalAudioTrack>,
    pub mixed_audio_tracks: Vec<ExportMixedAudioTrack>,
    pub keep_subtitles: bool,
    /// Legacy codec list fallback
    #[serde(default)]
    pub subtitle_codecs: Vec<String>,
    /// Explicit internal + external subtitle track selection & UTF-8 Chinese naming
    #[serde(default)]
    pub subtitle_tracks: Vec<ExportSubtitleTrack>,
    /// Enable frame-accurate Smart Cut: only re-encode tiny boundary GOPs at non-keyframe cut points,
    /// while 99%+ of the video stays strictly `-c:v copy` with zero 100GB temp copies!
    #[serde(default)]
    pub smart_cut: bool,
    /// Sorted keyframe timestamps of the source video (used for Smart Cut boundary planning)
    #[serde(default)]
    pub keyframes: Vec<f64>,
    #[serde(default)]
    pub video_meta: Option<SmartCutVideoMeta>,
    /// Optional Advanced Export transcoding config; when `None`, uses strictly lossless stream-copy / Smart Cut.
    #[serde(default)]
    pub advanced: Option<crate::advanced_export::AdvancedExportConfig>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ExportProgressEvent {
    pub status: String, // "running" | "done" | "cancelled" | "error"
    pub percent: f64,
    pub out_time_sec: f64,
    pub expected_duration_sec: f64,
    pub speed: String,
    pub written_bytes: u64,
    pub message: String,
    pub output_path: String,
    pub eta_sec: Option<f64>,
    pub write_bytes_per_sec: Option<f64>,
    pub elapsed_sec: Option<f64>,
}

#[derive(Debug, Clone)]
enum SmartPiece {
    /// Direct `-c:v copy` reference into the original 100GB source file (ZERO temp copy!)
    CopySource { start: f64, end: f64 },
    /// Tiny boundary GOP slice (~1-10s) to re-encode with matching codec/HDR/timescale
    ReencodeClip {
        seek_base: f64,
        start: f64,
        duration: f64,
    },
}

pub struct ExportManager {
    active_pid: Arc<Mutex<Option<u32>>>,
    cancelled: Arc<Mutex<bool>>,
}

impl Default for ExportManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ExportManager {
    pub fn new() -> Self {
        Self {
            active_pid: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(Mutex::new(false)),
        }
    }

    pub fn cancel(&self) -> Result<(), String> {
        *self.cancelled.lock() = true;
        if let Some(pid) = *self.active_pid.lock() {
            kill_process(pid);
        }
        Ok(())
    }

    pub async fn run_export(
        &self,
        app: AppHandle,
        req: ExportRequest,
    ) -> Result<String, String> {
        if self.active_pid.lock().is_some() {
            return Err("已有导出任务正在进行中，请先等待完成或取消".to_string());
        }

        let ffmpeg = find_binary("ffmpeg")
            .ok_or_else(|| "未找到 ffmpeg，无法执行导出".to_string())?;

        if !Path::new(&req.input_path).is_file() {
            return Err(format!("源文件不存在: {}", req.input_path));
        }

        if !req.is_full_file && req.kept_segments.is_empty() {
            return Err("没有可保留的视频片段，请检查剪辑时间段设置".to_string());
        }

        if let Some(parent) = Path::new(&req.output_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("无法创建输出目录: {e}"))?;
        }

        let expected_duration: f64 = if req.is_full_file {
            req.total_source_duration.max(0.1)
        } else {
            req.kept_segments
                .iter()
                .map(|s| (s.end - s.start).max(0.0))
                .sum::<f64>()
                .max(0.1)
        };

        *self.cancelled.lock() = false;

        let mut temp_files: Vec<PathBuf> = Vec::new();
        let result = if let Some(ref adv_cfg) = req.advanced {
            crate::advanced_export::run_advanced_export(
                &app,
                &ffmpeg,
                &req,
                adv_cfg,
                expected_duration,
                &self.active_pid,
                &self.cancelled,
                &mut temp_files,
            )
            .await
        } else {
            self.run_export_inner(&app, &ffmpeg, &req, expected_duration, &mut temp_files)
                .await
        };

        // Always clean up all temporary concat manifests and Smart Cut boundary clips
        for p in &temp_files {
            let _ = std::fs::remove_file(p);
        }

        result
    }

    async fn run_export_inner(
        &self,
        app: &AppHandle,
        ffmpeg: &Path,
        req: &ExportRequest,
        expected_duration: f64,
        temp_files: &mut Vec<PathBuf>,
    ) -> Result<String, String> {
        let total_started = std::time::Instant::now();
        // Determine whether Smart Cut can and should be used
        let can_smart_encode = req
            .video_meta
            .as_ref()
            .and_then(|m| resolve_smart_encoder(&m.codec_name))
            .is_some();

        let use_smart_cut = req.smart_cut && !req.is_full_file && can_smart_encode;

        let mut args: Vec<String> = vec![
            "-y".into(),
            "-hide_banner".into(),
            "-loglevel".into(),
            "warning".into(),
            "-progress".into(),
            "pipe:1".into(),
            "-nostats".into(),
        ];

        let mut progress_base_pct = 0.0_f64;
        // Reusable input flags for duplicating input 0 with `-itsoffset` when an internal subtitle has a delay offset
        let mut primary_input_args: Vec<String> = Vec::new();

        if req.is_full_file {
            primary_input_args.push("-i".into());
            primary_input_args.push(req.input_path.clone());
            args.extend(primary_input_args.clone());
        } else if use_smart_cut {
            // Collect keyframes (use fast index if provided, or probe locally near cut boundaries)
            let mut keyframes = req.keyframes.clone();
            if keyframes.is_empty() {
                for seg in &req.kept_segments {
                    if let Ok(k1) = probe_keyframes_near(&req.input_path, seg.start, 20.0).await {
                        keyframes.extend(k1);
                    }
                    if let Ok(k2) = probe_keyframes_near(&req.input_path, seg.end, 20.0).await {
                        keyframes.extend(k2);
                    }
                }
                keyframes.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                keyframes.dedup_by(|a, b| (*a - *b).abs() < 0.001);
            }

            let video_meta = req.video_meta.as_ref().unwrap();
            let pieces = build_smart_cut_plan(
                &req.kept_segments,
                &keyframes,
                req.total_source_duration,
                video_meta.fps,
            );

            let reencode_total = pieces
                .iter()
                .filter(|p| matches!(p, SmartPiece::ReencodeClip { .. }))
                .count();

            let is_mkv_source = video_meta.format_name.contains("matroska")
                || video_meta.format_name.contains("webm");
            let (temp_ext, temp_fmt) = if is_mkv_source {
                ("mkv", "matroska")
            } else {
                ("mov", "mov")
            };

            let mut concat_content = String::from("ffconcat version 1.0\n");
            let escaped_src = escape_ffconcat_path(&req.input_path);
            let mut reencode_done = 0usize;

            for piece in pieces {
                if *self.cancelled.lock() {
                    return self.emit_cancelled(app, req, expected_duration);
                }

                match piece {
                    SmartPiece::CopySource { start, end } => {
                        concat_content.push_str(&format!("file '{escaped_src}'\n"));
                        if start > 0.002 {
                            concat_content.push_str(&format!("inpoint {start:.6}\n"));
                        }
                        if end < req.total_source_duration - 0.08 {
                            concat_content.push_str(&format!("outpoint {end:.6}\n"));
                        }
                    }
                    SmartPiece::ReencodeClip {
                        seek_base,
                        start,
                        duration,
                    } => {
                        reencode_done += 1;
                        let pct = if reencode_total > 0 {
                            ((reencode_done - 1) as f64 / reencode_total as f64) * 22.0
                        } else {
                            5.0
                        };
                        let _ = app.emit(
                            "export-progress",
                            ExportProgressEvent {
                                status: "running".into(),
                                percent: pct,
                                out_time_sec: 0.0,
                                expected_duration_sec: expected_duration,
                                speed: format!("切点 {reencode_done}/{reencode_total}"),
                                written_bytes: 0,
                                message: format!(
                                    "智能剪辑：精确编码切点 GOP ({reencode_done}/{reencode_total})，其余片段保持零重编码..."
                                ),
                                output_path: req.output_path.clone(),
                                eta_sec: None,
                                write_bytes_per_sec: None,
                                elapsed_sec: Some(total_started.elapsed().as_secs_f64()),
                            },
                        );

                        let clip_path = std::env::temp_dir().join(format!(
                            "hdrcut_smart_{}_{}.{temp_ext}",
                            uuid::Uuid::new_v4(),
                            reencode_done
                        ));
                        temp_files.push(clip_path.clone());

                        self.encode_smart_boundary_clip(
                            ffmpeg,
                            req,
                            video_meta,
                            seek_base,
                            start,
                            duration,
                            temp_fmt,
                            &clip_path,
                        )
                        .await?;

                        if *self.cancelled.lock() {
                            return self.emit_cancelled(app, req, expected_duration);
                        }

                        let escaped_clip =
                            escape_ffconcat_path(&clip_path.to_string_lossy());
                        concat_content.push_str(&format!("file '{escaped_clip}'\n"));
                    }
                }
            }

            if reencode_total > 0 {
                progress_base_pct = 24.0;
            }

            let concat_path = std::env::temp_dir()
                .join(format!("hdrcut_concat_{}.ffconcat", uuid::Uuid::new_v4()));
            std::fs::write(&concat_path, &concat_content)
                .map_err(|e| format!("写入智能剪辑分段清单失败: {e}"))?;
            temp_files.push(concat_path.clone());

            primary_input_args.push("-f".into());
            primary_input_args.push("concat".into());
            primary_input_args.push("-safe".into());
            primary_input_args.push("0".into());
            primary_input_args.push("-auto_convert".into());
            primary_input_args.push("1".into());
            primary_input_args.push("-i".into());
            primary_input_args.push(concat_path.to_string_lossy().to_string());
            args.extend(primary_input_args.clone());
        } else if req.kept_segments.len() == 1 {
            // Single kept range (keyframe-only mode): direct fast input seeking with zero temp file!
            let seg = &req.kept_segments[0];
            if seg.start > 0.005 {
                primary_input_args.push("-ss".into());
                primary_input_args.push(format!("{:.6}", seg.start));
            }
            primary_input_args.push("-i".into());
            primary_input_args.push(req.input_path.clone());
            args.extend(primary_input_args.clone());
            let seg_dur = (seg.end - seg.start).max(0.05);
            if seg.end < req.total_source_duration - 0.1 {
                args.push("-t".into());
                args.push(format!("{:.6}", seg_dur));
            }
        } else {
            // Multi-segment keyframe-only single-pass via ffconcat
            let concat_path = std::env::temp_dir()
                .join(format!("hdrcut_concat_{}.ffconcat", uuid::Uuid::new_v4()));
            let escaped_input = escape_ffconcat_path(&req.input_path);
            let mut content = String::from("ffconcat version 1.0\n");
            for seg in &req.kept_segments {
                content.push_str(&format!("file '{escaped_input}'\n"));
                if seg.start > 0.001 {
                    content.push_str(&format!("inpoint {:.6}\n", seg.start));
                }
                if seg.end < req.total_source_duration - 0.05 {
                    content.push_str(&format!("outpoint {:.6}\n", seg.end));
                }
            }
            std::fs::write(&concat_path, &content)
                .map_err(|e| format!("写入剪辑分段清单失败: {e}"))?;
            temp_files.push(concat_path.clone());

            primary_input_args.push("-f".into());
            primary_input_args.push("concat".into());
            primary_input_args.push("-safe".into());
            primary_input_args.push("0".into());
            primary_input_args.push("-auto_convert".into());
            primary_input_args.push("1".into());
            primary_input_args.push("-i".into());
            primary_input_args.push(concat_path.to_string_lossy().to_string());
            args.extend(primary_input_args.clone());
        }

        // Register extra inputs:
        // Input 0 = main video (+ internal audio/subtitles)
        // Input 1.. = imported external audio files
        // Input N.. = imported external subtitle files
        let mut next_input_idx: usize = 1;
        let mut ext_audio_input_indices: Vec<usize> = Vec::new();
        for ext_a in &req.external_audio_tracks {
            if !Path::new(&ext_a.file_path).is_file() {
                continue;
            }
            if req.is_full_file {
                args.push("-i".into());
                args.push(ext_a.file_path.clone());
            } else if req.kept_segments.len() == 1 {
                let seg = &req.kept_segments[0];
                if seg.start > 0.005 {
                    args.push("-ss".into());
                    args.push(format!("{:.6}", seg.start));
                }
                let seg_dur = (seg.end - seg.start).max(0.05);
                if seg.end < req.total_source_duration - 0.1 {
                    args.push("-t".into());
                    args.push(format!("{:.6}", seg_dur));
                }
                args.push("-i".into());
                args.push(ext_a.file_path.clone());
            } else {
                let ext_concat = std::env::temp_dir()
                    .join(format!("hdrcut_exta_{}.ffconcat", uuid::Uuid::new_v4()));
                let escaped = escape_ffconcat_path(&ext_a.file_path);
                let mut content = String::from("ffconcat version 1.0\n");
                for seg in &req.kept_segments {
                    content.push_str(&format!("file '{escaped}'\n"));
                    if seg.start > 0.001 {
                        content.push_str(&format!("inpoint {:.6}\n", seg.start));
                    }
                    if seg.end < req.total_source_duration - 0.05 {
                        content.push_str(&format!("outpoint {:.6}\n", seg.end));
                    }
                }
                std::fs::write(&ext_concat, &content)
                    .map_err(|e| format!("写入外部音轨分段清单失败: {e}"))?;
                temp_files.push(ext_concat.clone());
                args.push("-f".into());
                args.push("concat".into());
                args.push("-safe".into());
                args.push("0".into());
                args.push("-i".into());
                args.push(ext_concat.to_string_lossy().to_string());
            }
            ext_audio_input_indices.push(next_input_idx);
            next_input_idx += 1;
        }

        let mut ext_sub_input_indices: Vec<Option<usize>> = Vec::new();
        let mut int_sub_input_indices: Vec<Option<usize>> = Vec::new();
        let mut int_sub_offset_cache: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for sub in &req.subtitle_tracks {
            if sub.source_kind == "external" {
                int_sub_input_indices.push(None);
                if let Some(ref fp) = sub.file_path {
                    if Path::new(fp).is_file() {
                        if sub.delay_sec.abs() > 0.001 {
                            args.push("-itsoffset".into());
                            args.push(format!("{:.3}", sub.delay_sec));
                        }
                        args.push("-i".into());
                        args.push(fp.clone());
                        ext_sub_input_indices.push(Some(next_input_idx));
                        next_input_idx += 1;
                        continue;
                    }
                }
                ext_sub_input_indices.push(None);
            } else {
                ext_sub_input_indices.push(None);
                if sub.delay_sec.abs() > 0.001 && !primary_input_args.is_empty() {
                    let key = format!("{:.3}", sub.delay_sec);
                    let in_idx = if let Some(&existing) = int_sub_offset_cache.get(&key) {
                        existing
                    } else {
                        args.push("-itsoffset".into());
                        args.push(key.clone());
                        args.extend(primary_input_args.clone());
                        let idx = next_input_idx;
                        next_input_idx += 1;
                        int_sub_offset_cache.insert(key, idx);
                        idx
                    };
                    int_sub_input_indices.push(Some(in_idx));
                } else {
                    int_sub_input_indices.push(None);
                }
            }
        }

        // Build filter_complex if any mixed audio tracks are requested
        let mut filter_parts: Vec<String> = Vec::new();
        for (m_idx, mix) in req.mixed_audio_tracks.iter().enumerate() {
            if mix.source_audio_indices.is_empty() {
                continue;
            }
            let mut mix_inputs = String::new();
            for (s_pos, &src_aidx) in mix.source_audio_indices.iter().enumerate() {
                let gain = mix.gains_db.get(s_pos).copied().unwrap_or(0.0);
                let label = format!("m{m_idx}_s{s_pos}");
                if gain.abs() > 0.05 {
                    filter_parts.push(format!(
                        "[0:a:{src_aidx}]volume={gain:.2}dB[{label}]"
                    ));
                } else {
                    filter_parts.push(format!("[0:a:{src_aidx}]anull[{label}]"));
                }
                mix_inputs.push_str(&format!("[{label}]"));
            }
            let norm_flag = if mix.normalize { 1 } else { 0 };
            let n = mix.source_audio_indices.len();
            filter_parts.push(format!(
                "{mix_inputs}amix=inputs={n}:duration=longest:dropout_transition=0:normalize={norm_flag},asetpts=N/SR/TB[mixout{m_idx}]"
            ));
        }

        if !filter_parts.is_empty() {
            args.push("-filter_complex".into());
            args.push(filter_parts.join(";"));
        }

        let is_mp4 = req.output_format.eq_ignore_ascii_case("mp4")
            || (req.output_format.is_empty()
                && req.output_path.to_lowercase().ends_with(".mp4"));
        let fmt_label = if is_mp4 { "MP4" } else { "MKV" };

        // Map video stream — STRICTLY `-c:v copy` (for Smart Cut, the tiny boundary GOPs are already matched!)
        args.push("-map".into());
        args.push("0:v:0".into());
        args.push("-c:v".into());
        args.push("copy".into());

        // For HEVC inside MP4, tag as `hvc1` so macOS QuickTime / Finder / Windows Media Player play it natively!
        if is_mp4 {
            let is_hevc = req
                .video_meta
                .as_ref()
                .map(|m| {
                    let c = m.codec_name.to_lowercase();
                    c == "hevc" || c == "h265"
                })
                .unwrap_or(false);
            if is_hevc {
                args.push("-tag:v".into());
                args.push("hvc1".into());
            }
        }

        // Map independent (unmixed) audio tracks — STRICTLY ZERO RE-ENCODE
        let mut out_audio_idx: usize = 0;
        for track in &req.keep_audio_tracks {
            args.push("-map".into());
            args.push(format!("0:a:{}", track.audio_index));
            args.push(format!("-c:a:{out_audio_idx}"));
            args.push("copy".into());
            args.push(format!("-metadata:s:a:{out_audio_idx}"));
            args.push(format!("title={}", track.title));
            if is_mp4 {
                args.push(format!("-metadata:s:a:{out_audio_idx}"));
                args.push(format!("handler_name={}", track.title));
            }
            if let Some(ref lang) = track.language {
                if !lang.trim().is_empty() {
                    args.push(format!("-metadata:s:a:{out_audio_idx}"));
                    args.push(format!("language={}", lang.trim()));
                }
            }
            args.push(format!("-disposition:a:{out_audio_idx}"));
            args.push(if track.is_default {
                "default".into()
            } else {
                "0".into()
            });
            out_audio_idx += 1;
        }

        // Map imported external audio tracks — STRICTLY `-c:a copy` (zero re-encode!)
        for (i, ext_a) in req.external_audio_tracks.iter().enumerate() {
            let Some(&in_idx) = ext_audio_input_indices.get(i) else {
                continue;
            };
            args.push("-map".into());
            args.push(format!("{in_idx}:a:0"));
            args.push(format!("-c:a:{out_audio_idx}"));
            args.push("copy".into());
            args.push(format!("-metadata:s:a:{out_audio_idx}"));
            args.push(format!("title={}", ext_a.title));
            if is_mp4 {
                args.push(format!("-metadata:s:a:{out_audio_idx}"));
                args.push(format!("handler_name={}", ext_a.title));
            }
            if let Some(ref lang) = ext_a.language {
                if !lang.trim().is_empty() {
                    args.push(format!("-metadata:s:a:{out_audio_idx}"));
                    args.push(format!("language={}", lang.trim()));
                }
            }
            args.push(format!("-disposition:a:{out_audio_idx}"));
            args.push(if ext_a.is_default {
                "default".into()
            } else {
                "0".into()
            });
            out_audio_idx += 1;
        }

        // Map mixed audio tracks — lossless FLAC (or PCM / ALAC in MP4 / AAC)
        for (m_idx, mix) in req.mixed_audio_tracks.iter().enumerate() {
            if mix.source_audio_indices.is_empty() {
                continue;
            }
            args.push("-map".into());
            args.push(format!("[mixout{m_idx}]"));
            args.push(format!("-c:a:{out_audio_idx}"));
            match mix.codec.as_str() {
                "pcm_s24le" => {
                    // Strict MP4 does not accept raw PCM; use bit-exact lossless ALAC in MP4!
                    if is_mp4 {
                        args.push("alac".into());
                    } else {
                        args.push("pcm_s24le".into());
                    }
                }
                "aac" => {
                    args.push("aac".into());
                    args.push(format!("-b:a:{out_audio_idx}"));
                    args.push("320k".into());
                }
                _ => {
                    args.push("flac".into());
                    args.push(format!("-compression_level:a:{out_audio_idx}"));
                    args.push("5".into());
                }
            }
            args.push(format!("-metadata:s:a:{out_audio_idx}"));
            args.push(format!("title={}", mix.title));
            if is_mp4 {
                args.push(format!("-metadata:s:a:{out_audio_idx}"));
                args.push(format!("handler_name={}", mix.title));
            }
            args.push(format!("-disposition:a:{out_audio_idx}"));
            args.push(if mix.is_default {
                "default".into()
            } else {
                "0".into()
            });
            out_audio_idx += 1;
        }

        // Preserve selected internal + imported external subtitle tracks according to target container (MKV vs MP4)
        if !req.subtitle_tracks.is_empty() {
            let mut out_sub_idx: usize = 0;
            for (pos, sub) in req.subtitle_tracks.iter().enumerate() {
                let map_spec = if sub.source_kind == "external" {
                    let Some(in_idx) = ext_sub_input_indices.get(pos).copied().flatten() else {
                        continue;
                    };
                    format!("{in_idx}:s:0")
                } else {
                    let Some(s_idx) = sub.subtitle_index else {
                        continue;
                    };
                    let in_idx = int_sub_input_indices.get(pos).copied().flatten().unwrap_or(0);
                    format!("{in_idx}:s:{s_idx}")
                };

                let c = sub.codec_name.to_lowercase();
                let target_codec: Option<&str> = if is_mp4 {
                    if matches!(c.as_str(), "mov_text" | "tx3g") {
                        Some("copy")
                    } else if matches!(
                        c.as_str(),
                        "subrip" | "srt" | "ass" | "ssa" | "webvtt" | "text" | "ttml"
                    ) {
                        Some("mov_text")
                    } else {
                        None
                    }
                } else {
                    if matches!(
                        c.as_str(),
                        "subrip"
                            | "srt"
                            | "ass"
                            | "ssa"
                            | "hdmv_pgs_subtitle"
                            | "dvd_subtitle"
                            | "webvtt"
                            | "dvb_subtitle"
                            | "hdmv_text_subtitle"
                            | "arib_caption"
                    ) {
                        Some("copy")
                    } else if matches!(
                        c.as_str(),
                        "mov_text" | "tx3g" | "text" | "ttml" | "eia_608" | "eia_708" | "scc" | "stl"
                    ) {
                        Some("srt")
                    } else {
                        None
                    }
                };

                if let Some(tc) = target_codec {
                    args.push("-map".into());
                    args.push(map_spec);
                    args.push(format!("-c:s:{out_sub_idx}"));
                    args.push(tc.into());
                    if !sub.title.trim().is_empty() {
                        args.push(format!("-metadata:s:s:{out_sub_idx}"));
                        args.push(format!("title={}", sub.title.trim()));
                        if is_mp4 {
                            args.push(format!("-metadata:s:s:{out_sub_idx}"));
                            args.push(format!("handler_name={}", sub.title.trim()));
                        }
                    }
                    if let Some(ref lang) = sub.language {
                        if !lang.trim().is_empty() {
                            args.push(format!("-metadata:s:s:{out_sub_idx}"));
                            args.push(format!("language={}", lang.trim()));
                        }
                    }
                    args.push(format!("-disposition:s:{out_sub_idx}"));
                    args.push(if sub.is_default {
                        "default".into()
                    } else {
                        "0".into()
                    });
                    out_sub_idx += 1;
                }
            }
        } else if req.keep_subtitles && !req.subtitle_codecs.is_empty() {
            let mut out_sub_idx: usize = 0;
            for (src_s_idx, codec) in req.subtitle_codecs.iter().enumerate() {
                let c = codec.to_lowercase();
                if is_mp4 {
                    if matches!(c.as_str(), "mov_text" | "tx3g") {
                        args.push("-map".into());
                        args.push(format!("0:s:{src_s_idx}"));
                        args.push(format!("-c:s:{out_sub_idx}"));
                        args.push("copy".into());
                        out_sub_idx += 1;
                    } else if matches!(
                        c.as_str(),
                        "subrip" | "srt" | "ass" | "ssa" | "webvtt" | "text" | "ttml"
                    ) {
                        args.push("-map".into());
                        args.push(format!("0:s:{src_s_idx}"));
                        args.push(format!("-c:s:{out_sub_idx}"));
                        args.push("mov_text".into());
                        out_sub_idx += 1;
                    }
                } else {
                    let is_mkv_native = matches!(
                        c.as_str(),
                        "subrip"
                            | "srt"
                            | "ass"
                            | "ssa"
                            | "hdmv_pgs_subtitle"
                            | "dvd_subtitle"
                            | "webvtt"
                            | "dvb_subtitle"
                            | "hdmv_text_subtitle"
                            | "arib_caption"
                    );
                    let is_convertible_text = matches!(
                        c.as_str(),
                        "mov_text" | "tx3g" | "text" | "ttml" | "eia_608" | "eia_708" | "scc" | "stl"
                    );

                    if is_mkv_native {
                        args.push("-map".into());
                        args.push(format!("0:s:{src_s_idx}"));
                        args.push(format!("-c:s:{out_sub_idx}"));
                        args.push("copy".into());
                        out_sub_idx += 1;
                    } else if is_convertible_text {
                        args.push("-map".into());
                        args.push(format!("0:s:{src_s_idx}"));
                        args.push(format!("-c:s:{out_sub_idx}"));
                        args.push("srt".into());
                        out_sub_idx += 1;
                    }
                }
            }
        }

        if req.is_full_file {
            args.push("-map_chapters".into());
            args.push("0".into());
        } else {
            args.push("-map_chapters".into());
            args.push("-1".into());
        }
        args.push("-avoid_negative_ts".into());
        args.push("make_zero".into());
        args.push("-max_interleave_delta".into());
        args.push("0".into());
        if is_mp4 {
            // Allow FLAC/Opus/TrueHD in MP4 & preserve UTF-8 metadata tags without 2x faststart rewrite on 100GB files
            args.push("-strict".into());
            args.push("unofficial".into());
            args.push("-movflags".into());
            args.push("+use_metadata_tags".into());
            args.push("-f".into());
            args.push("mp4".into());
        } else {
            args.push("-f".into());
            args.push("matroska".into());
        }
        args.push(req.output_path.clone());

        let _ = app.emit(
            "export-progress",
            ExportProgressEvent {
                status: "running".into(),
                percent: progress_base_pct,
                out_time_sec: 0.0,
                expected_duration_sec: expected_duration,
                speed: "准备中...".into(),
                written_bytes: 0,
                message: if use_smart_cut {
                    "智能剪辑：单遍无损拼接封装中...".into()
                } else {
                    "正在启动单遍无损封装...".into()
                },
                output_path: req.output_path.clone(),
                eta_sec: None,
                write_bytes_per_sec: None,
                elapsed_sec: Some(total_started.elapsed().as_secs_f64()),
            },
        );

        let mut cmd = Command::new(ffmpeg);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let mux_started = std::time::Instant::now();
        let mut child = cmd.spawn().map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
        *self.active_pid.lock() = child.id();

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let stderr_handle = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            let mut lines = Vec::new();
            while let Ok(Some(line)) = reader.next_line().await {
                if lines.len() < 80 {
                    lines.push(line);
                }
            }
            lines.join("\n")
        });

        let mut reader = BufReader::new(stdout).lines();
        let mut out_time_sec: f64 = 0.0;
        let mut speed = String::from("0x");
        let mut written_bytes: u64 = 0;

        while let Ok(Some(line)) = reader.next_line().await {
            if let Some((k, v)) = line.split_once('=') {
                let v = v.trim();
                match k.trim() {
                    "out_time_us" | "out_time_ms" => {
                        if let Ok(us) = v.parse::<i64>() {
                            if us >= 0 {
                                out_time_sec = (us as f64) / 1_000_000.0;
                            }
                        }
                    }
                    "total_size" => {
                        if let Ok(b) = v.parse::<u64>() {
                            written_bytes = b;
                        }
                    }
                    "speed" => {
                        speed = v.to_string();
                    }
                    "progress" => {
                        let raw_ratio = (out_time_sec / expected_duration).clamp(0.0, 1.0);
                        let pct = (progress_base_pct + raw_ratio * (99.5 - progress_base_pct))
                            .clamp(0.0, 99.5);
                        let mux_elapsed = mux_started.elapsed().as_secs_f64();
                        let write_bps = if mux_elapsed > 0.15 && written_bytes > 0 {
                            Some(written_bytes as f64 / mux_elapsed)
                        } else {
                            None
                        };
                        let remaining_media = (expected_duration - out_time_sec).max(0.0);
                        let speed_mult = speed
                            .trim()
                            .trim_end_matches(['x', 'X'])
                            .parse::<f64>()
                            .ok()
                            .filter(|v| v.is_finite() && *v > 0.05);
                        let eta_sec = if let Some(mult) = speed_mult {
                            Some(remaining_media / mult)
                        } else if out_time_sec > 0.3 && mux_elapsed > 0.2 {
                            Some(remaining_media * (mux_elapsed / out_time_sec))
                        } else {
                            None
                        };

                        let _ = app.emit(
                            "export-progress",
                            ExportProgressEvent {
                                status: "running".into(),
                                percent: pct,
                                out_time_sec,
                                expected_duration_sec: expected_duration,
                                speed: speed.clone(),
                                written_bytes,
                                message: if use_smart_cut {
                                    "智能剪辑无损拼接中".into()
                                } else {
                                    "无损直出封装中".into()
                                },
                                output_path: req.output_path.clone(),
                                eta_sec,
                                write_bytes_per_sec: write_bps,
                                elapsed_sec: Some(total_started.elapsed().as_secs_f64()),
                            },
                        );
                    }
                    _ => {}
                }
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| format!("等待导出进程失败: {e}"))?;
        *self.active_pid.lock() = None;

        let stderr_text = stderr_handle.await.unwrap_or_default();
        if *self.cancelled.lock() {
            return self.emit_cancelled(app, req, expected_duration);
        }

        if !status.success() {
            let msg = if stderr_text.trim().is_empty() {
                format!("FFmpeg 导出失败 (退出码 {:?})", status.code())
            } else {
                format!("FFmpeg 导出失败:\n{stderr_text}")
            };
            let _ = app.emit(
                "export-progress",
                ExportProgressEvent {
                    status: "error".into(),
                    percent: 0.0,
                    out_time_sec,
                    expected_duration_sec: expected_duration,
                    speed,
                    written_bytes,
                    message: msg.clone(),
                    output_path: req.output_path.clone(),
                    eta_sec: None,
                    write_bytes_per_sec: None,
                    elapsed_sec: Some(total_started.elapsed().as_secs_f64()),
                },
            );
            return Err(msg);
        }

        let final_size = std::fs::metadata(&req.output_path)
            .map(|m| m.len())
            .unwrap_or(written_bytes);
        let total_elapsed = total_started.elapsed().as_secs_f64();
        let avg_bps = if total_elapsed > 0.05 && final_size > 0 {
            Some(final_size as f64 / total_elapsed)
        } else {
            None
        };

        let _ = app.emit(
            "export-progress",
            ExportProgressEvent {
                status: "done".into(),
                percent: 100.0,
                out_time_sec: expected_duration,
                expected_duration_sec: expected_duration,
                speed,
                written_bytes: final_size,
                message: if use_smart_cut {
                    format!("智能剪辑 {fmt_label} 导出完成！")
                } else {
                    format!("无损 {fmt_label} 导出完成！")
                },
                output_path: req.output_path.clone(),
                eta_sec: Some(0.0),
                write_bytes_per_sec: avg_bps,
                elapsed_sec: Some(total_elapsed),
            },
        );

        Ok(req.output_path.clone())
    }

    async fn encode_smart_boundary_clip(
        &self,
        ffmpeg: &Path,
        req: &ExportRequest,
        meta: &SmartCutVideoMeta,
        seek_base: f64,
        start: f64,
        duration: f64,
        temp_fmt: &str,
        out_path: &Path,
    ) -> Result<(), String> {
        let encoder = resolve_smart_encoder(&meta.codec_name)
            .ok_or_else(|| format!("不支持的智能剪辑编码器: {}", meta.codec_name))?;

        let fast_seek = (seek_base - 0.5).max(0.0);
        let fine_seek = (start - fast_seek).max(0.0);

        let mut args: Vec<String> = vec![
            "-y".into(),
            "-hide_banner".into(),
            "-loglevel".into(),
            "error".into(),
        ];

        // Two-stage accurate seek: instant container jump on 100GB file + frame-exact trim!
        if fast_seek > 0.01 {
            args.push("-ss".into());
            args.push(format!("{fast_seek:.6}"));
        }
        args.push("-i".into());
        args.push(req.input_path.clone());
        if fine_seek > 0.001 {
            args.push("-ss".into());
            args.push(format!("{fine_seek:.6}"));
        }
        args.push("-t".into());
        args.push(format!("{:.6}", duration.max(0.04)));

        // Match source streams 1:1 so ffconcat stitches seamlessly with the untouched source body
        args.push("-map".into());
        args.push("0:v:0".into());
        args.push("-map".into());
        args.push("0:a?".into());
        if req.keep_subtitles && !req.subtitle_codecs.is_empty() {
            args.push("-map".into());
            args.push("0:s?".into());
        }

        args.push("-c:v".into());
        args.push(encoder.into());

        // Match exact pixel format (10-bit yuv420p10le for HDR, yuv420p for SDR)
        if let Some(ref pf) = meta.pix_fmt {
            if !pf.trim().is_empty() {
                args.push("-pix_fmt".into());
                args.push(pf.clone());
            }
        }

        // Preserve exact color primaries / transfer / matrix / range
        if let Some(ref cp) = meta.color_primaries {
            if !cp.is_empty() && cp != "unknown" {
                args.push("-color_primaries".into());
                args.push(cp.clone());
            }
        }
        if let Some(ref ct) = meta.color_transfer {
            if !ct.is_empty() && ct != "unknown" {
                args.push("-color_trc".into());
                args.push(ct.clone());
            }
        }
        if let Some(ref cs) = meta.color_space {
            if !cs.is_empty() && cs != "unknown" {
                args.push("-colorspace".into());
                args.push(cs.clone());
            }
        }
        if let Some(ref cr) = meta.color_range {
            if !cr.is_empty() && cr != "unknown" {
                args.push("-color_range".into());
                args.push(cr.clone());
            }
        }

        match encoder {
            "libx265" => {
                args.extend(["-crf".into(), "14".into(), "-preset".into(), "fast".into()]);
                let mut x265_opts = vec![
                    "repeat-headers=1".to_string(),
                    "open-gop=0".to_string(),
                    "log-level=error".to_string(),
                ];
                let is_pq_or_hlg = meta
                    .color_transfer
                    .as_deref()
                    .map(|t| t == "smpte2084" || t == "arib-std-b67")
                    .unwrap_or(false);
                if is_pq_or_hlg {
                    x265_opts.push("hdr-opt=1".into());
                }
                if let Some(ref cp) = meta.color_primaries {
                    if !cp.is_empty() && cp != "unknown" {
                        x265_opts.push(format!("colorprim={cp}"));
                    }
                }
                if let Some(ref ct) = meta.color_transfer {
                    if !ct.is_empty() && ct != "unknown" {
                        x265_opts.push(format!("transfer={ct}"));
                    }
                }
                if let Some(ref cs) = meta.color_space {
                    if !cs.is_empty() && cs != "unknown" {
                        x265_opts.push(format!("colormatrix={cs}"));
                    }
                }
                if let Some(ref md) = meta.master_display {
                    x265_opts.push(format!("master-display={md}"));
                }
                if let Some(ref cll) = meta.max_cll {
                    x265_opts.push(format!("max-cll={cll}"));
                }
                args.push("-x265-params".into());
                args.push(x265_opts.join(":"));
            }
            "libx264" => {
                args.extend([
                    "-crf".into(),
                    "14".into(),
                    "-preset".into(),
                    "fast".into(),
                    "-x264-params".into(),
                    "repeat-headers=1:open-gop=0".into(),
                ]);
            }
            "libvpx-vp9" => {
                args.extend([
                    "-crf".into(),
                    "16".into(),
                    "-b:v".into(),
                    "0".into(),
                    "-row-mt".into(),
                    "1".into(),
                    "-deadline".into(),
                    "realtime".into(),
                    "-cpu-used".into(),
                    "4".into(),
                ]);
            }
            "libsvtav1" => {
                args.extend(["-crf".into(), "18".into(), "-preset".into(), "8".into()]);
            }
            "prores_ks" => {
                args.extend(["-profile:v".into(), "3".into()]);
            }
            _ => {}
        }

        // Match exact video_track_timescale for MP4/MOV so ffconcat stitches with zero timestamp jump!
        if temp_fmt != "matroska" && meta.time_base_den > 0 {
            args.push("-video_track_timescale".into());
            args.push(meta.time_base_den.to_string());
        }

        // Keep audio & subtitles untouched inside the tiny boundary clip
        args.extend(["-c:a".into(), "copy".into()]);
        if req.keep_subtitles && !req.subtitle_codecs.is_empty() {
            args.extend(["-c:s".into(), "copy".into()]);
        }

        args.extend([
            "-avoid_negative_ts".into(),
            "make_zero".into(),
            "-f".into(),
            temp_fmt.into(),
            out_path.to_string_lossy().to_string(),
        ]);

        let mut cmd = Command::new(ffmpeg);
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("启动智能剪辑切点编码失败: {e}"))?;
        *self.active_pid.lock() = child.id();

        let output = child
            .wait_with_output()
            .await
            .map_err(|e| format!("等待智能剪辑切点编码失败: {e}"))?;
        *self.active_pid.lock() = None;

        if *self.cancelled.lock() {
            return Err("导出已由用户取消".into());
        }

        if !output.status.success() {
            let err_str = String::from_utf8_lossy(&output.stderr);
            return Err(format!("智能剪辑切点编码失败:\n{err_str}"));
        }

        Ok(())
    }

    fn emit_cancelled(
        &self,
        app: &AppHandle,
        req: &ExportRequest,
        expected_duration: f64,
    ) -> Result<String, String> {
        let _ = std::fs::remove_file(&req.output_path);
        let _ = app.emit(
            "export-progress",
            ExportProgressEvent {
                status: "cancelled".into(),
                percent: 0.0,
                out_time_sec: 0.0,
                expected_duration_sec: expected_duration,
                speed: String::new(),
                written_bytes: 0,
                message: "导出已取消".into(),
                output_path: req.output_path.clone(),
                eta_sec: None,
                write_bytes_per_sec: None,
                elapsed_sec: None,
            },
        );
        Err("导出已由用户取消".to_string())
    }
}

fn resolve_smart_encoder(codec_name: &str) -> Option<&'static str> {
    match codec_name.to_lowercase().as_str() {
        "hevc" | "h265" => Some("libx265"),
        "h264" | "avc" | "avc1" => Some("libx264"),
        "vp9" => Some("libvpx-vp9"),
        "av1" => Some("libsvtav1"),
        "prores" => Some("prores_ks"),
        _ => None,
    }
}

/// Plans Head (tiny re-encode) + Keyframe-Bounded Body (99% `-c:v copy`) + Tail (tiny re-encode)
/// so every non-keyframe cut boundary is frame-accurate with ZERO B-frame DTS overlap!
fn build_smart_cut_plan(
    segments: &[ExportSegment],
    keyframes: &[f64],
    total_duration: f64,
    fps: f64,
) -> Vec<SmartPiece> {
    let eps = 0.04;
    let half_frame = if fps > 1.0 { 0.5 / fps } else { 0.015 };
    let mut plan: Vec<SmartPiece> = Vec::new();

    for seg in segments {
        let s = seg.start.max(0.0);
        let e = seg.end.min(total_duration);
        if e <= s + 0.04 {
            continue;
        }

        let start_on_kf = s <= eps || is_near_keyframe(s, keyframes, eps);
        let end_is_eof = e >= total_duration - 0.08;
        let end_on_kf = end_is_eof || is_near_keyframe(e, keyframes, eps);

        if start_on_kf && end_on_kf {
            // Entire segment starts & ends on keyframes -> 100% direct -c:v copy!
            let copy_s = if s <= eps {
                0.0
            } else {
                nearest_keyframe(s, keyframes).unwrap_or(s)
            };
            let copy_e = if end_is_eof {
                total_duration
            } else {
                nearest_keyframe(e, keyframes).unwrap_or(e)
            };
            plan.push(SmartPiece::CopySource {
                start: copy_s,
                end: copy_e,
            });
            continue;
        }

        // Keyframe strictly after S (start of untouched body)
        let body_start = if start_on_kf {
            if s <= eps {
                0.0
            } else {
                nearest_keyframe(s, keyframes).unwrap_or(s)
            }
        } else {
            first_keyframe_after(s + eps, keyframes).unwrap_or(e)
        };

        // Keyframe at or before E (end of untouched body)
        let body_end = if end_is_eof {
            total_duration
        } else if end_on_kf {
            nearest_keyframe(e, keyframes).unwrap_or(e)
        } else {
            last_keyframe_before(e - eps, keyframes).unwrap_or(s)
        };

        // If the segment doesn't span at least one full inner keyframe-bounded GOP,
        // re-encode the short segment [s, e] cleanly in one piece.
        if body_end <= body_start + 0.1 {
            let seek_base = last_keyframe_before(s + eps, keyframes).unwrap_or(0.0);
            plan.push(SmartPiece::ReencodeClip {
                seek_base,
                start: s,
                duration: (e - s).max(0.04),
            });
            continue;
        }

        // 1. Head boundary GOP: [s, body_start - half_frame]
        if !start_on_kf && body_start > s + eps {
            let seek_base = last_keyframe_before(s + eps, keyframes).unwrap_or(0.0);
            let dur = (body_start - s - half_frame).max(0.04);
            plan.push(SmartPiece::ReencodeClip {
                seek_base,
                start: s,
                duration: dur,
            });
        }

        // 2. Untouched 99% Body: [body_start, body_end] — BOTH endpoints are exact keyframes!
        plan.push(SmartPiece::CopySource {
            start: body_start,
            end: body_end,
        });

        // 3. Tail boundary GOP: [body_end, e]
        if !end_on_kf && e > body_end + eps {
            plan.push(SmartPiece::ReencodeClip {
                seek_base: body_end,
                start: body_end,
                duration: (e - body_end).max(0.04),
            });
        }
    }

    plan
}

fn nearest_keyframe(t: f64, keyframes: &[f64]) -> Option<f64> {
    if keyframes.is_empty() {
        return None;
    }
    let idx = keyframes.partition_point(|&k| k < t);
    let cand1 = idx.checked_sub(1).and_then(|i| keyframes.get(i).copied());
    let cand2 = keyframes.get(idx).copied();
    match (cand1, cand2) {
        (Some(a), Some(b)) => Some(if (t - a).abs() <= (b - t).abs() { a } else { b }),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    }
}

fn is_near_keyframe(t: f64, keyframes: &[f64], eps: f64) -> bool {
    nearest_keyframe(t, keyframes)
        .map(|k| (k - t).abs() <= eps)
        .unwrap_or(false)
}

fn first_keyframe_after(t: f64, keyframes: &[f64]) -> Option<f64> {
    let idx = keyframes.partition_point(|&k| k <= t);
    keyframes.get(idx).copied()
}

fn last_keyframe_before(t: f64, keyframes: &[f64]) -> Option<f64> {
    let idx = keyframes.partition_point(|&k| k <= t);
    idx.checked_sub(1).and_then(|i| keyframes.get(i).copied())
}

fn escape_ffconcat_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    let normalized = path.replace('\\', "/");
    #[cfg(not(target_os = "windows"))]
    let normalized = path.to_string();

    normalized.replace('\'', "'\\''")
}

/// Standalone lossless audio track extraction (single or batch) using `-vn -sn -c:a copy`!
pub async fn extract_audio_tracks(
    input_path: &str,
    items: Vec<ExtractAudioItem>,
) -> Result<Vec<String>, String> {
    let ffmpeg = find_binary("ffmpeg").ok_or_else(|| "未找到 ffmpeg".to_string())?;
    if !Path::new(input_path).is_file() {
        return Err(format!("源文件不存在: {input_path}"));
    }
    if items.is_empty() {
        return Err("未选择需要导出的音轨".to_string());
    }

    // Single FFmpeg invocation can demux & write all requested audio tracks in 1 read pass!
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-i".into(),
        input_path.to_string(),
    ];

    let mut outputs = Vec::with_capacity(items.len());
    for item in &items {
        if let Some(parent) = Path::new(&item.output_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        args.push("-map".into());
        args.push(format!("0:a:{}", item.audio_index));
        args.push("-vn".into());
        args.push("-sn".into());
        args.push("-c:a".into());
        args.push("copy".into());
        args.push(item.output_path.clone());
        outputs.push(item.output_path.clone());
    }

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("启动音频提取失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("导出音轨失败:\n{stderr}"));
    }
    Ok(outputs)
}

/// Standalone subtitle track extraction (single or batch) in 1 single read pass!
pub async fn extract_subtitle_tracks(
    input_path: &str,
    items: Vec<ExtractSubtitleItem>,
) -> Result<Vec<String>, String> {
    let ffmpeg = find_binary("ffmpeg").ok_or_else(|| "未找到 ffmpeg".to_string())?;
    if !Path::new(input_path).is_file() {
        return Err(format!("源文件不存在: {input_path}"));
    }
    if items.is_empty() {
        return Err("未选择需要导出的字幕轨".to_string());
    }

    let mut args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-i".into(),
        input_path.to_string(),
    ];

    let mut outputs = Vec::with_capacity(items.len());
    for item in &items {
        if let Some(parent) = Path::new(&item.output_path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let c = item.codec_name.to_lowercase();
        let out_ext = Path::new(&item.output_path)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let sub_codec = match (c.as_str(), out_ext.as_str()) {
            ("ass" | "ssa", "ass" | "ssa") => "copy",
            ("subrip" | "srt", "srt") => "copy",
            ("webvtt", "vtt") => "copy",
            ("hdmv_pgs_subtitle", "sup") => "copy",
            (_, "ass") => "ass",
            (_, "vtt") => "webvtt",
            (_, "sup") => "copy",
            _ => "srt",
        };

        args.push("-map".into());
        args.push(format!("0:s:{}", item.subtitle_index));
        args.push("-vn".into());
        args.push("-an".into());
        args.push("-c:s".into());
        args.push(sub_codec.into());
        args.push(item.output_path.clone());
        outputs.push(item.output_path.clone());
    }

    let mut cmd = Command::new(&ffmpeg);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("启动字幕提取失败: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("导出字幕失败:\n{stderr}"));
    }
    Ok(outputs)
}

fn kill_process(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .creation_flags(0x08000000)
            .status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_smart_cut_plan_10s_gop() {
        // 26-minute video (1560s) with 10-second keyframes
        let kfs: Vec<f64> = (0..=156).map(|i| (i * 10) as f64).collect();
        let kept = vec![
            ExportSegment { start: 0.0, end: 85.0 },
            ExportSegment { start: 135.5, end: 1560.0 },
        ];
        let plan = build_smart_cut_plan(&kept, &kfs, 1560.0, 60.0);
        // Expected:
        // 1) CopySource [0, 80]
        // 2) ReencodeClip [80, 5.0s] (tiny tail GOP)
        // 3) ReencodeClip [135.5, ~4.5s] (tiny head GOP)
        // 4) CopySource [140, 1560] (99%+ untouched!)
        assert_eq!(plan.len(), 4, "plan: {:?}", plan);
        match &plan[0] {
            SmartPiece::CopySource { start, end } => {
                assert!((*start - 0.0).abs() < 0.01);
                assert!((*end - 80.0).abs() < 0.01);
            }
            _ => panic!("expected CopySource"),
        }
        match &plan[1] {
            SmartPiece::ReencodeClip { start, duration, .. } => {
                assert!((*start - 80.0).abs() < 0.01);
                assert!((*duration - 5.0).abs() < 0.05);
            }
            _ => panic!("expected ReencodeClip tail"),
        }
        match &plan[2] {
            SmartPiece::ReencodeClip { start, duration, .. } => {
                assert!((*start - 135.5).abs() < 0.01);
                assert!((*duration - 4.5).abs() < 0.05);
            }
            _ => panic!("expected ReencodeClip head"),
        }
        match &plan[3] {
            SmartPiece::CopySource { start, end } => {
                assert!((*start - 140.0).abs() < 0.01);
                assert!((*end - 1560.0).abs() < 0.01);
            }
            _ => panic!("expected CopySource body"),
        }
    }
}

