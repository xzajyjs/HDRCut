use crate::exporter::{ExportProgressEvent, ExportRequest};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AdvancedExportConfig {
    /// Target container: "mp4" | "mkv" | "mov" | "webm" | "avi" | "ts" | "flv" | "m4v"
    pub container: String,
    /// Video codec: "h264" | "hevc" | "av1" | "vp9" | "prores" | "mpeg4"
    pub video_codec: String,
    /// Optional target width (guaranteed even & aspect-ratio locked with source)
    pub width: Option<u32>,
    /// Optional target height (guaranteed even & aspect-ratio locked with source)
    pub height: Option<u32>,
    /// Optional target FPS (strictly <= source FPS; None = keep source FPS)
    pub fps: Option<f64>,
    /// Rate control mode: "crf" | "bitrate" | "target_size"
    pub rate_control: String,
    /// CRF value (14..35, lower = higher quality) when rate_control == "crf"
    pub crf: Option<u32>,
    /// Target video bitrate in kbps when rate_control == "bitrate"
    pub video_bitrate_kbps: Option<u32>,
    /// Maximum target output file size in MB when rate_control == "target_size"
    pub target_size_mb: Option<f64>,
    /// Encoding speed preset: "ultrafast" | "veryfast" | "fast" | "medium" | "slow"
    pub preset: String,
    /// Enable GPU hardware acceleration when compatible (VideoToolbox on macOS)
    pub use_hw_accel: bool,
    /// Convert HDR (PQ / HLG BT.2020) to SDR (BT.709) via tone mapping
    pub hdr_to_sdr: bool,
    /// Tone mapping operator: "hable" | "mobius" | "reinhard" | "bt2390"
    pub tonemap_algo: String,
    /// Output color depth: "auto" | "8bit" | "10bit"
    pub color_depth: String,
    /// Audio export mode: "copy" | "aac_320" | "aac_192" | "aac_128" | "opus_160" | "mp3_192" | "flac" | "none"
    pub audio_mode: String,
    /// Subtitle mode: "keep" | "none"
    pub subtitle_mode: String,
    /// Enable `-movflags +faststart` for MP4 / MOV / M4V web streaming
    pub faststart: bool,
    /// Rotation / flip: "none" | "cw90" | "rot180" | "ccw90" | "hflip" | "vflip"
    pub rotation: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TargetSizePlan {
    pub video_kbps: u32,
    pub audio_kbps_per_track: u32,
    pub force_audio_codec: Option<&'static str>,
}

/// Calculates conservative video + audio bitrates so the final muxed file stays
/// strictly `<= target_size_mb` (leaving a 4.5% container/VBV safety headroom).
pub fn calculate_target_size_plan(
    target_size_mb: f64,
    duration_sec: f64,
    audio_track_count: usize,
    requested_audio_mode: &str,
    container: &str,
) -> Result<TargetSizePlan, String> {
    if !target_size_mb.is_finite() || target_size_mb < 0.5 {
        return Err("目标文件大小不能小于 0.5 MB".to_string());
    }
    let dur = duration_sec.max(0.5);
    // 1 MB = 1_048_576 bytes; keep 4.5% headroom for container index, audio framing & VBV variance
    let usable_kbits = target_size_mb * 1024.0 * 1024.0 * 8.0 * 0.955 / 1000.0;
    let total_kbps = usable_kbits / dur;

    let mut audio_kbps: u32 = if audio_track_count == 0 || requested_audio_mode == "none" {
        0
    } else {
        match requested_audio_mode {
            "aac_320" => 320,
            "aac_192" | "mp3_192" => 192,
            "opus_160" => 160,
            "aac_128" => 128,
            "flac" => 900,
            _ => 192, // default reasonable audio budget when "copy" was selected
        }
    };

    let mut force_audio_codec: Option<&'static str> = if requested_audio_mode == "copy"
        && audio_track_count > 0
    {
        // Re-encode audio to predictable CBR/ABR when strictly targeting file size
        Some(if container == "webm" { "libopus" } else { "aac" })
    } else {
        None
    };

    let tracks = audio_track_count.max(1) as f64;
    if audio_track_count > 0 && requested_audio_mode != "none" {
        // Ensure audio never consumes more than 25% of total bitrate budget
        let max_audio_per_track = (total_kbps * 0.25 / tracks).floor();
        if (audio_kbps as f64) > max_audio_per_track {
            let down = if max_audio_per_track >= 128.0 {
                128
            } else if max_audio_per_track >= 96.0 {
                96
            } else if max_audio_per_track >= 64.0 {
                64
            } else {
                48
            };
            audio_kbps = down;
            force_audio_codec = Some(if container == "webm" { "libopus" } else { "aac" });
        }
    }

    let total_audio_kbps = (audio_kbps as f64) * (audio_track_count as f64);
    let video_kbps = (total_kbps - total_audio_kbps).floor();
    if video_kbps < 80.0 {
        return Err(format!(
            "目标体积 ({target_size_mb:.1} MB) 对于当前时长 ({dur:.0}s) 过小，建议提高目标大小或缩短片段"
        ));
    }

    Ok(TargetSizePlan {
        video_kbps: video_kbps as u32,
        audio_kbps_per_track: audio_kbps,
        force_audio_codec,
    })
}

fn escape_ffconcat_path(path: &str) -> String {
    path.replace('\'', "'\\''")
}

fn escape_ffmpeg_filter_path(path: &str) -> String {
    path.replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "\\'")
}

fn ffmpeg_muxer_for_container(container: &str) -> (&'static str, &'static str) {
    match container.to_lowercase().as_str() {
        "mkv" => ("matroska", "MKV"),
        "mov" => ("mov", "MOV"),
        "webm" => ("webm", "WebM"),
        "avi" => ("avi", "AVI"),
        "ts" => ("mpegts", "TS"),
        "flv" => ("flv", "FLV"),
        "m4v" => ("mp4", "M4V"),
        _ => ("mp4", "MP4"),
    }
}

async fn ffmpeg_has_filter(ffmpeg: &Path, filter_name: &str) -> bool {
    let mut cmd = Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-h", &format!("filter={filter_name}")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    match cmd.output().await {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            out.status.success()
                && !stdout.contains("Unknown filter")
                && !stderr.contains("Unknown filter")
        }
        Err(_) => false,
    }
}

/// SMPTE ST 2084 (PQ) EOTF: electrical [0,1] -> normalized linear [0, 100] (where 1.0 = 100 nits SDR white)
fn pq_eotf_normalized(v: f64) -> f64 {
    const M1: f64 = 0.1593017578125;
    const M2: f64 = 78.84375;
    const C1: f64 = 0.8359375;
    const C2: f64 = 18.8515625;
    const C3: f64 = 18.6875;
    let vp = v.clamp(0.0, 1.0).powf(1.0 / M2);
    let num = (vp - C1).max(0.0);
    let den = (C2 - C3 * vp).max(1e-9);
    let linear_10000 = (num / den).powf(1.0 / M1);
    // 10000 nits / 100 nits SDR reference white = 100.0
    linear_10000 * 100.0
}

/// ARIB STD-B67 (HLG) inverse OETF + simple OOTF to normalized linear SDR scale (~10.0 peak)
fn hlg_eotf_normalized(v: f64) -> f64 {
    const A: f64 = 0.17883277;
    const B: f64 = 0.28466892;
    const C: f64 = 0.55991073;
    let x = v.clamp(0.0, 1.0);
    let scene = if x <= 0.5 {
        (x * x) / 3.0
    } else {
        (((x - C) / A).exp() + B) / 12.0
    };
    scene.powf(1.2) * 10.0
}

/// BT.709 OETF: linear [0,1] -> electrical [0,1]
fn bt709_oetf(l: f64) -> f64 {
    let x = l.clamp(0.0, 1.0);
    if x < 0.018 {
        4.5 * x
    } else {
        1.099 * x.powf(0.45) - 0.099
    }
}

fn hable_curve(x: f64) -> f64 {
    const A: f64 = 0.15;
    const B: f64 = 0.50;
    const C: f64 = 0.10;
    const D: f64 = 0.20;
    const E: f64 = 0.02;
    const F: f64 = 0.30;
    ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F
}

fn apply_tonemap_scalar(l: f64, peak: f64, algo: &str) -> f64 {
    if l <= 0.0 {
        return 0.0;
    }
    match algo {
        "reinhard" => {
            let scaled = l * (1.0 + l / (peak * peak));
            (scaled / (1.0 + l)).clamp(0.0, 1.0)
        }
        "mobius" => {
            let j = 0.3;
            if l <= j {
                l
            } else {
                let a = -j * j * (peak - 1.0) / (j * j - 2.0 * j + peak);
                let b = (j * j - 2.0 * j * peak + peak) / (peak - 1.0).max(1e-6);
                ((b * b + 2.0 * b * j + j * j) / (b - a) * (l + a) / (l + b)).clamp(0.0, 1.0)
            }
        }
        "bt2390" => {
            // Smooth ITU-R BT.2390 EETF approximation in normalized luminance space
            let ks = 0.65;
            let norm = (l / peak).clamp(0.0, 1.0);
            if norm <= ks {
                (l / (1.0 + 0.15 * l)).clamp(0.0, 1.0)
            } else {
                let t = (norm - ks) / (1.0 - ks);
                let p = (2.0 * t * t * t - 3.0 * t * t + 1.0) * ks
                    + (t * t * t - 2.0 * t * t + t) * (1.0 - ks)
                    + (-2.0 * t * t * t + 3.0 * t * t);
                p.clamp(0.0, 1.0)
            }
        }
        _ => {
            // Hable (Filmic) — natural highlights & rich midtones
            let w = hable_curve(peak).max(1e-6);
            (hable_curve(l * 1.45) / w).clamp(0.0, 1.0)
        }
    }
}

/// Generates a 33x33x33 `.cube` 3D LUT converting BT.2020 PQ/HLG RGB directly into
/// tone-mapped BT.709 SDR RGB — fast, mathematically exact, and compatible with every FFmpeg build.
pub fn generate_hdr_to_sdr_cube_lut(
    path: &Path,
    is_hlg: bool,
    algo: &str,
) -> Result<(), String> {
    const N: usize = 33;
    let peak = if is_hlg { 10.0 } else { 10.0 }; // 1000 nits typical HDR10 mastering peak normalized to 100 nits
    let mut out = String::with_capacity(N * N * N * 30 + 128);
    out.push_str("TITLE \"HDRCut HDR-to-SDR ToneMap\"\n");
    out.push_str(&format!("LUT_3D_SIZE {N}\n"));
    out.push_str("DOMAIN_MIN 0.0 0.0 0.0\n");
    out.push_str("DOMAIN_MAX 1.0 1.0 1.0\n");

    let inv_n = 1.0 / ((N - 1) as f64);
    for bi in 0..N {
        let b_in = bi as f64 * inv_n;
        let b_lin = if is_hlg {
            hlg_eotf_normalized(b_in)
        } else {
            pq_eotf_normalized(b_in)
        };
        for gi in 0..N {
            let g_in = gi as f64 * inv_n;
            let g_lin = if is_hlg {
                hlg_eotf_normalized(g_in)
            } else {
                pq_eotf_normalized(g_in)
            };
            for ri in 0..N {
                let r_in = ri as f64 * inv_n;
                let r_lin = if is_hlg {
                    hlg_eotf_normalized(r_in)
                } else {
                    pq_eotf_normalized(r_in)
                };

                // BT.2020 luminance
                let luma = (0.2627 * r_lin + 0.6780 * g_lin + 0.0593 * b_lin).max(0.0);
                let (rm, gm, bm) = if luma > 1e-7 {
                    let mapped_luma = apply_tonemap_scalar(luma, peak, algo);
                    let scale = mapped_luma / luma;
                    let r1 = r_lin * scale;
                    let g1 = g_lin * scale;
                    let b1 = b_lin * scale;
                    // Gentle highlight desaturation to prevent neon color shifts in bright speculars
                    let desat = ((mapped_luma - 0.72) / 0.28).clamp(0.0, 1.0) * 0.35;
                    (
                        r1 + (mapped_luma - r1) * desat,
                        g1 + (mapped_luma - g1) * desat,
                        b1 + (mapped_luma - b1) * desat,
                    )
                } else {
                    (0.0, 0.0, 0.0)
                };

                // Exact Rec.2020 -> Rec.709 linear chromaticity matrix
                let r709 = 1.660491 * rm - 0.587641 * gm - 0.072850 * bm;
                let g709 = -0.124550 * rm + 1.132900 * gm - 0.008349 * bm;
                let b709 = -0.018151 * rm - 0.100579 * gm + 1.118730 * bm;

                let ro = bt709_oetf(r709);
                let go = bt709_oetf(g709);
                let bo = bt709_oetf(b709);
                out.push_str(&format!("{ro:.6} {go:.6} {bo:.6}\n"));
            }
        }
    }

    std::fs::write(path, out).map_err(|e| format!("生成 HDR→SDR LUT 失败: {e}"))
}

fn select_video_encoder(cfg: &AdvancedExportConfig, is_two_pass: bool) -> &'static str {
    let codec = cfg.video_codec.to_lowercase();
    #[cfg(target_os = "macos")]
    {
        if cfg.use_hw_accel && !is_two_pass {
            match codec.as_str() {
                "h264" => return "h264_videotoolbox",
                "hevc" => return "hevc_videotoolbox",
                "prores" => return "prores_videotoolbox",
                _ => {}
            }
        }
    }
    let _ = is_two_pass;
    match codec.as_str() {
        "hevc" => "libx265",
        "av1" => "libsvtav1",
        "vp9" => "libvpx-vp9",
        "prores" => "prores_ks",
        "mpeg4" => "mpeg4",
        _ => "libx264",
    }
}

fn target_pix_fmt(cfg: &AdvancedExportConfig, encoder: &str, source_is_hdr: bool) -> &'static str {
    if encoder == "prores_ks" || encoder == "prores_videotoolbox" {
        return "yuv422p10le";
    }
    if encoder == "mpeg4" {
        return "yuv420p";
    }
    if cfg.hdr_to_sdr {
        return match cfg.color_depth.as_str() {
            "10bit" if encoder != "h264_videotoolbox" => {
                if encoder == "hevc_videotoolbox" {
                    "p010le"
                } else {
                    "yuv420p10le"
                }
            }
            _ => "yuv420p",
        };
    }

    let want_10bit = match cfg.color_depth.as_str() {
        "10bit" => true,
        "8bit" => false,
        _ => source_is_hdr,
    };

    if want_10bit && encoder != "h264_videotoolbox" {
        if encoder == "hevc_videotoolbox" {
            "p010le"
        } else {
            "yuv420p10le"
        }
    } else {
        "yuv420p"
    }
}

pub async fn run_advanced_export(
    app: &AppHandle,
    ffmpeg: &Path,
    req: &ExportRequest,
    cfg: &AdvancedExportConfig,
    expected_duration: f64,
    active_pid: &Arc<Mutex<Option<u32>>>,
    cancelled: &Arc<Mutex<bool>>,
    temp_files: &mut Vec<PathBuf>,
) -> Result<String, String> {
    let total_started = std::time::Instant::now();
    let container = cfg.container.to_lowercase();
    let (muxer_fmt, fmt_label) = ffmpeg_muxer_for_container(&container);

    let source_trc = req
        .video_meta
        .as_ref()
        .and_then(|m| m.color_transfer.as_deref())
        .unwrap_or("")
        .to_lowercase();
    let source_is_hlg = source_trc == "arib-std-b67";
    let source_is_hdr = source_trc == "smpte2084" || source_is_hlg;

    // Count output audio tracks to accurately budget bitrate for Target Size mode
    let audio_track_count = if cfg.audio_mode == "none" {
        0
    } else {
        req.keep_audio_tracks.len() + req.external_audio_tracks.len() + req.mixed_audio_tracks.len()
    };

    let size_plan = if cfg.rate_control == "target_size" {
        let mb = cfg
            .target_size_mb
            .ok_or_else(|| "请指定目标文件大小 (MB)".to_string())?;
        Some(calculate_target_size_plan(
            mb,
            expected_duration,
            audio_track_count,
            &cfg.audio_mode,
            &container,
        )?)
    } else {
        None
    };

    let is_two_pass = size_plan.is_some()
        && matches!(
            cfg.video_codec.to_lowercase().as_str(),
            "h264" | "hevc" | "vp9" | "mpeg4"
        );
    let encoder = select_video_encoder(cfg, is_two_pass);
    let out_pix_fmt = target_pix_fmt(cfg, encoder, source_is_hdr);

    // Build primary input args (supporting full file, single cut range, or multi-segment ffconcat)
    let mut primary_input_args: Vec<String> = Vec::new();
    let mut single_seg_dur: Option<f64> = None;

    if req.is_full_file {
        primary_input_args.push("-i".into());
        primary_input_args.push(req.input_path.clone());
    } else if req.kept_segments.len() == 1 {
        let seg = &req.kept_segments[0];
        if seg.start > 0.005 {
            primary_input_args.push("-ss".into());
            primary_input_args.push(format!("{:.6}", seg.start));
        }
        primary_input_args.push("-i".into());
        primary_input_args.push(req.input_path.clone());
        let dur = (seg.end - seg.start).max(0.05);
        if seg.end < req.total_source_duration - 0.1 {
            single_seg_dur = Some(dur);
        }
    } else {
        let concat_path =
            std::env::temp_dir().join(format!("hdrcut_adv_{}.ffconcat", uuid::Uuid::new_v4()));
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
    }

    // Build video filter chain: Rotation -> FPS -> Resolution Scale -> HDR-to-SDR ToneMap -> Pixel Format
    let mut vf_steps: Vec<String> = Vec::new();
    match cfg.rotation.as_str() {
        "cw90" => vf_steps.push("transpose=1".into()),
        "ccw90" => vf_steps.push("transpose=2".into()),
        "rot180" => {
            vf_steps.push("transpose=1".into());
            vf_steps.push("transpose=1".into());
        }
        "hflip" => vf_steps.push("hflip".into()),
        "vflip" => vf_steps.push("vflip".into()),
        _ => {}
    }

    if let Some(fps) = cfg.fps {
        if fps.is_finite() && fps >= 1.0 {
            vf_steps.push(format!("fps=fps={fps:.3}"));
        }
    }

    if let (Some(w), Some(h)) = (cfg.width, cfg.height) {
        let ew = ((w / 2) * 2).max(2);
        let eh = ((h / 2) * 2).max(2);
        vf_steps.push(format!("scale={ew}:{eh}:flags=lanczos"));
    }

    if cfg.hdr_to_sdr {
        let algo = match cfg.tonemap_algo.as_str() {
            "mobius" => "mobius",
            "reinhard" => "reinhard",
            "bt2390" => "bt2390",
            _ => "hable",
        };
        if ffmpeg_has_filter(ffmpeg, "zscale").await {
            let z_algo = if algo == "bt2390" { "hable" } else { algo };
            vf_steps.push(format!(
                "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap={z_algo}:desat=0,zscale=t=bt709:m=bt709:r=tv,format={out_pix_fmt}"
            ));
        } else {
            let lut_path = std::env::temp_dir()
                .join(format!("hdrcut_tonemap_{}.cube", uuid::Uuid::new_v4()));
            generate_hdr_to_sdr_cube_lut(&lut_path, source_is_hlg, algo)?;
            temp_files.push(lut_path.clone());
            let escaped_lut = escape_ffmpeg_filter_path(&lut_path.to_string_lossy());
            let in_matrix = if source_is_hdr { "bt2020" } else { "bt709" };
            vf_steps.push(format!(
                "scale=in_color_matrix={in_matrix}:in_range=tv,format=rgb48le,lut3d=file='{escaped_lut}':interp=tetrahedral,scale=out_color_matrix=bt709:out_range=tv,format={out_pix_fmt}"
            ));
        }
    } else {
        vf_steps.push(format!("format={out_pix_fmt}"));
    }

    // Build video codec + rate control args helper
    let append_video_encode_args =
        |args: &mut Vec<String>, pass_num: Option<u8>, pass_log: Option<&str>| {
            args.push("-c:v".into());
            args.push(encoder.into());

            // Rate control
            if let Some(ref plan) = size_plan {
                let v_kbps = plan.video_kbps;
                args.push("-b:v".into());
                args.push(format!("{v_kbps}k"));
                args.push("-maxrate".into());
                args.push(format!("{}k", ((v_kbps as f64) * 1.15).round() as u32));
                args.push("-bufsize".into());
                args.push(format!("{}k", ((v_kbps as f64) * 1.6).round() as u32));
            } else if cfg.rate_control == "bitrate" {
                let v_kbps = cfg.video_bitrate_kbps.unwrap_or(8000).max(100);
                args.push("-b:v".into());
                args.push(format!("{v_kbps}k"));
                args.push("-maxrate".into());
                args.push(format!("{}k", ((v_kbps as f64) * 1.35).round() as u32));
                args.push("-bufsize".into());
                args.push(format!("{}k", ((v_kbps as f64) * 2.0).round() as u32));
            } else {
                // CRF / Quality mode
                let crf = cfg.crf.unwrap_or(20).clamp(10, 42);
                match encoder {
                    "libx264" | "libx265" | "libsvtav1" => {
                        args.push("-crf".into());
                        args.push(crf.to_string());
                    }
                    "libvpx-vp9" => {
                        args.push("-crf".into());
                        args.push((crf + 8).min(52).to_string());
                        args.push("-b:v".into());
                        args.push("0".into());
                    }
                    "h264_videotoolbox" | "hevc_videotoolbox" => {
                        // VideoToolbox -q:v: 1 (low) .. 100 (high); map CRF 14..32 -> q 82..42
                        let q = (100i32 - (crf as i32) * 2 + 10).clamp(35, 92);
                        args.push("-q:v".into());
                        args.push(q.to_string());
                    }
                    "mpeg4" => {
                        let q = ((crf as f64 - 10.0) / 2.2 + 2.0).round().clamp(2.0, 18.0) as u32;
                        args.push("-q:v".into());
                        args.push(q.to_string());
                    }
                    "prores_ks" | "prores_videotoolbox" => {
                        args.push("-profile:v".into());
                        args.push("3".into()); // ProRes 422 HQ
                    }
                    _ => {}
                }
            }

            // Speed preset
            match encoder {
                "libx264" | "libx265" => {
                    let p = match cfg.preset.as_str() {
                        "ultrafast" | "veryfast" | "fast" | "medium" | "slow" => {
                            cfg.preset.as_str()
                        }
                        _ => "medium",
                    };
                    args.push("-preset".into());
                    args.push(p.into());
                }
                "libsvtav1" => {
                    let p = match cfg.preset.as_str() {
                        "ultrafast" => "10",
                        "veryfast" => "8",
                        "fast" => "7",
                        "slow" => "4",
                        _ => "6",
                    };
                    args.push("-preset".into());
                    args.push(p.into());
                }
                "libvpx-vp9" => {
                    let cpu_used = match cfg.preset.as_str() {
                        "ultrafast" | "veryfast" => "5",
                        "fast" => "4",
                        "slow" => "1",
                        _ => "2",
                    };
                    args.push("-cpu-used".into());
                    args.push(cpu_used.into());
                    args.push("-row-mt".into());
                    args.push("1".into());
                }
                _ => {}
            }

            // 2-Pass parameters
            if let (Some(p), Some(log)) = (pass_num, pass_log) {
                if encoder == "libx265" {
                    args.push("-x265-params".into());
                    args.push(format!("pass={p}:stats={log}.log"));
                } else {
                    args.push("-pass".into());
                    args.push(p.to_string());
                    args.push("-passlogfile".into());
                    args.push(log.to_string());
                }
            }

            // HEVC tag for MP4/MOV/M4V compatibility
            if matches!(container.as_str(), "mp4" | "mov" | "m4v")
                && (encoder == "libx265" || encoder == "hevc_videotoolbox")
            {
                args.push("-tag:v".into());
                args.push("hvc1".into());
            }

            // Color metadata tags
            if cfg.hdr_to_sdr {
                args.push("-color_primaries".into());
                args.push("bt709".into());
                args.push("-color_trc".into());
                args.push("bt709".into());
                args.push("-colorspace".into());
                args.push("bt709".into());
                args.push("-color_range".into());
                args.push("tv".into());
            } else if source_is_hdr {
                if let Some(ref vm) = req.video_meta {
                    if let Some(ref cp) = vm.color_primaries {
                        args.push("-color_primaries".into());
                        args.push(cp.clone());
                    }
                    if let Some(ref ct) = vm.color_transfer {
                        args.push("-color_trc".into());
                        args.push(ct.clone());
                    }
                    if let Some(ref cs) = vm.color_space {
                        args.push("-colorspace".into());
                        args.push(cs.clone());
                    }
                }
            }
        };

    // Pass 1 (only for 2-Pass Target Size mode)
    let pass_log_base = std::env::temp_dir().join(format!("hdrcut_2pass_{}", uuid::Uuid::new_v4()));
    let pass_log_str = pass_log_base.to_string_lossy().to_string();
    if is_two_pass {
        // Register potential 2-pass log temp files for automatic cleanup
        for suffix in [
            "-0.log",
            "-0.log.mbtree",
            ".log",
            ".log.cutree",
            ".log.temp",
            "-0.log.temp",
        ] {
            temp_files.push(PathBuf::from(format!("{pass_log_str}{suffix}")));
        }

        let mut p1_args: Vec<String> = vec![
            "-y".into(),
            "-hide_banner".into(),
            "-loglevel".into(),
            "warning".into(),
            "-progress".into(),
            "pipe:1".into(),
            "-nostats".into(),
        ];
        p1_args.extend(primary_input_args.clone());
        if let Some(dur) = single_seg_dur {
            p1_args.push("-t".into());
            p1_args.push(format!("{dur:.6}"));
        }
        p1_args.push("-map".into());
        p1_args.push("0:v:0".into());
        p1_args.push("-vf".into());
        p1_args.push(vf_steps.join(","));
        append_video_encode_args(&mut p1_args, Some(1), Some(&pass_log_str));
        p1_args.push("-an".into());
        p1_args.push("-sn".into());
        p1_args.push("-f".into());
        p1_args.push("null".into());
        #[cfg(target_os = "windows")]
        p1_args.push("NUL".into());
        #[cfg(not(target_os = "windows"))]
        p1_args.push("/dev/null".into());

        run_ffmpeg_pass(
            app,
            ffmpeg,
            &p1_args,
            req,
            expected_duration,
            0.0,
            38.0,
            "进阶导出（第 1/2 遍码率分析）",
            total_started,
            active_pid,
            cancelled,
        )
        .await?;

        if *cancelled.lock() {
            return Err("导出已由用户取消".to_string());
        }
    }

    // Build Final Pass (Pass 2 or Single Pass) args with audio, mixes, and subtitles
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
    ];
    args.extend(primary_input_args.clone());
    if let Some(dur) = single_seg_dur {
        args.push("-t".into());
        args.push(format!("{dur:.6}"));
    }

    let mut next_input_idx: usize = 1;
    let mut ext_audio_input_indices: Vec<usize> = Vec::new();
    if cfg.audio_mode != "none" {
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
                    .join(format!("hdrcut_adv_exta_{}.ffconcat", uuid::Uuid::new_v4()));
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
    }

    // Subtitles (only for containers that support soft subtitle tracks)
    let container_supports_subs = matches!(container.as_str(), "mkv" | "mp4" | "mov" | "m4v" | "webm");
    let keep_subs = cfg.subtitle_mode != "none" && container_supports_subs && !req.subtitle_tracks.is_empty();
    let mut ext_sub_input_indices: Vec<Option<usize>> = Vec::new();
    let mut int_sub_input_indices: Vec<Option<usize>> = Vec::new();
    let mut int_sub_offset_cache: HashMap<String, usize> = HashMap::new();

    if keep_subs {
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
    }

    // Build filter_complex if mixed audio tracks exist, otherwise simple -vf
    let has_mix = cfg.audio_mode != "none" && !req.mixed_audio_tracks.is_empty();
    if has_mix {
        let mut fc_parts: Vec<String> = Vec::new();
        fc_parts.push(format!("[0:v:0]{}[vout]", vf_steps.join(",")));
        for (m_idx, mix) in req.mixed_audio_tracks.iter().enumerate() {
            if mix.source_audio_indices.is_empty() {
                continue;
            }
            let mut mix_inputs = String::new();
            for (s_pos, &src_aidx) in mix.source_audio_indices.iter().enumerate() {
                let gain = mix.gains_db.get(s_pos).copied().unwrap_or(0.0);
                let label = format!("m{m_idx}_s{s_pos}");
                if gain.abs() > 0.05 {
                    fc_parts.push(format!("[0:a:{src_aidx}]volume={gain:.2}dB[{label}]"));
                } else {
                    fc_parts.push(format!("[0:a:{src_aidx}]anull[{label}]"));
                }
                mix_inputs.push_str(&format!("[{label}]"));
            }
            let norm_flag = if mix.normalize { 1 } else { 0 };
            let n = mix.source_audio_indices.len();
            fc_parts.push(format!(
                "{mix_inputs}amix=inputs={n}:duration=longest:dropout_transition=0:normalize={norm_flag},asetpts=N/SR/TB[mixout{m_idx}]"
            ));
        }
        args.push("-filter_complex".into());
        args.push(fc_parts.join(";"));
        args.push("-map".into());
        args.push("[vout]".into());
    } else {
        args.push("-map".into());
        args.push("0:v:0".into());
        args.push("-vf".into());
        args.push(vf_steps.join(","));
    }

    append_video_encode_args(
        &mut args,
        if is_two_pass { Some(2) } else { None },
        if is_two_pass { Some(&pass_log_str) } else { None },
    );

    // Map & encode audio tracks
    let is_mp4_like = matches!(container.as_str(), "mp4" | "mov" | "m4v");
    let resolve_audio_codec = |mode: &str| -> (&'static str, Option<u32>) {
        if let Some(ref plan) = size_plan {
            if let Some(forced) = plan.force_audio_codec {
                return (forced, Some(plan.audio_kbps_per_track));
            }
        }
        if container == "webm" {
            return ("libopus", Some(size_plan.as_ref().map(|p| p.audio_kbps_per_track).unwrap_or(160)));
        }
        if container == "flv" {
            return ("aac", Some(size_plan.as_ref().map(|p| p.audio_kbps_per_track).unwrap_or(192)));
        }
        match mode {
            "copy" => ("copy", None),
            "aac_320" => ("aac", Some(320)),
            "aac_192" => ("aac", Some(192)),
            "aac_128" => ("aac", Some(128)),
            "opus_160" => ("libopus", Some(160)),
            "mp3_192" => ("libmp3lame", Some(192)),
            "flac" => ("flac", None),
            _ => ("aac", Some(192)),
        }
    };

    if cfg.audio_mode == "none" {
        args.push("-an".into());
    } else {
        let (acodec, ab_kbps) = resolve_audio_codec(&cfg.audio_mode);
        let mut out_a: usize = 0;

        for track in &req.keep_audio_tracks {
            args.push("-map".into());
            args.push(format!("0:a:{}", track.audio_index));
            args.push(format!("-c:a:{out_a}"));
            args.push(acodec.into());
            if let Some(kb) = ab_kbps {
                args.push(format!("-b:a:{out_a}"));
                args.push(format!("{kb}k"));
            }
            args.push(format!("-metadata:s:a:{out_a}"));
            args.push(format!("title={}", track.title));
            if is_mp4_like {
                args.push(format!("-metadata:s:a:{out_a}"));
                args.push(format!("handler_name={}", track.title));
            }
            if let Some(ref lang) = track.language {
                if !lang.trim().is_empty() {
                    args.push(format!("-metadata:s:a:{out_a}"));
                    args.push(format!("language={}", lang.trim()));
                }
            }
            args.push(format!("-disposition:a:{out_a}"));
            args.push(if track.is_default { "default".into() } else { "0".into() });
            out_a += 1;
        }

        for (ext_pos, ext_a) in req.external_audio_tracks.iter().enumerate() {
            let Some(&in_idx) = ext_audio_input_indices.get(ext_pos) else {
                continue;
            };
            args.push("-map".into());
            args.push(format!("{in_idx}:a:0"));
            args.push(format!("-c:a:{out_a}"));
            args.push(acodec.into());
            if let Some(kb) = ab_kbps {
                args.push(format!("-b:a:{out_a}"));
                args.push(format!("{kb}k"));
            }
            args.push(format!("-metadata:s:a:{out_a}"));
            args.push(format!("title={}", ext_a.title));
            if is_mp4_like {
                args.push(format!("-metadata:s:a:{out_a}"));
                args.push(format!("handler_name={}", ext_a.title));
            }
            if let Some(ref lang) = ext_a.language {
                if !lang.trim().is_empty() {
                    args.push(format!("-metadata:s:a:{out_a}"));
                    args.push(format!("language={}", lang.trim()));
                }
            }
            args.push(format!("-disposition:a:{out_a}"));
            args.push(if ext_a.is_default { "default".into() } else { "0".into() });
            out_a += 1;
        }

        for (m_idx, mix) in req.mixed_audio_tracks.iter().enumerate() {
            if mix.source_audio_indices.is_empty() {
                continue;
            }
            let (m_codec, m_kbps) = if acodec == "copy" {
                ("aac", Some(256))
            } else {
                (acodec, ab_kbps)
            };
            args.push("-map".into());
            args.push(format!("[mixout{m_idx}]"));
            args.push(format!("-c:a:{out_a}"));
            args.push(m_codec.into());
            if let Some(kb) = m_kbps {
                args.push(format!("-b:a:{out_a}"));
                args.push(format!("{kb}k"));
            }
            args.push(format!("-metadata:s:a:{out_a}"));
            args.push(format!("title={}", mix.title));
            if is_mp4_like {
                args.push(format!("-metadata:s:a:{out_a}"));
                args.push(format!("handler_name={}", mix.title));
            }
            args.push(format!("-disposition:a:{out_a}"));
            args.push(if mix.is_default { "default".into() } else { "0".into() });
            out_a += 1;
        }
    }

    // Map subtitles
    if keep_subs {
        let mut out_s: usize = 0;
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
            let target_sub_codec: Option<&str> = if is_mp4_like {
                if matches!(c.as_str(), "mov_text" | "tx3g") {
                    Some("copy")
                } else if matches!(c.as_str(), "subrip" | "srt" | "ass" | "ssa" | "webvtt" | "text" | "ttml") {
                    Some("mov_text")
                } else {
                    None
                }
            } else if container == "webm" {
                if c == "webvtt" {
                    Some("copy")
                } else if matches!(c.as_str(), "subrip" | "srt" | "ass" | "ssa" | "mov_text" | "text") {
                    Some("webvtt")
                } else {
                    None
                }
            } else if matches!(
                c.as_str(),
                "subrip" | "srt" | "ass" | "ssa" | "hdmv_pgs_subtitle" | "dvd_subtitle" | "webvtt" | "dvb_subtitle"
            ) {
                Some("copy")
            } else {
                Some("srt")
            };

            if let Some(sc) = target_sub_codec {
                args.push("-map".into());
                args.push(map_spec);
                args.push(format!("-c:s:{out_s}"));
                args.push(sc.into());
                if !sub.title.trim().is_empty() {
                    args.push(format!("-metadata:s:s:{out_s}"));
                    args.push(format!("title={}", sub.title.trim()));
                    if is_mp4_like {
                        args.push(format!("-metadata:s:s:{out_s}"));
                        args.push(format!("handler_name={}", sub.title.trim()));
                    }
                }
                if let Some(ref lang) = sub.language {
                    if !lang.trim().is_empty() {
                        args.push(format!("-metadata:s:s:{out_s}"));
                        args.push(format!("language={}", lang.trim()));
                    }
                }
                args.push(format!("-disposition:s:{out_s}"));
                args.push(if sub.is_default { "default".into() } else { "0".into() });
                out_s += 1;
            }
        }
    } else {
        args.push("-sn".into());
    }

    if is_mp4_like {
        args.push("-strict".into());
        args.push("unofficial".into());
        if cfg.faststart {
            args.push("-movflags".into());
            args.push("+faststart+use_metadata_tags".into());
        } else {
            args.push("-movflags".into());
            args.push("+use_metadata_tags".into());
        }
    }

    args.push("-f".into());
    args.push(muxer_fmt.into());
    args.push(req.output_path.clone());

    let (base_pct, end_pct, label) = if is_two_pass {
        (38.0, 99.5, format!("进阶导出 {fmt_label}（第 2/2 遍精准压缩）"))
    } else {
        (0.0, 99.5, format!("进阶导出 {fmt_label} 编码中"))
    };

    let last_speed = run_ffmpeg_pass(
        app,
        ffmpeg,
        &args,
        req,
        expected_duration,
        base_pct,
        end_pct,
        &label,
        total_started,
        active_pid,
        cancelled,
    )
    .await?;

    let final_size = std::fs::metadata(&req.output_path)
        .map(|m| m.len())
        .unwrap_or(0);
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
            speed: last_speed,
            written_bytes: final_size,
            message: format!("进阶 {fmt_label} 导出完成！"),
            output_path: req.output_path.clone(),
            eta_sec: Some(0.0),
            write_bytes_per_sec: avg_bps,
            elapsed_sec: Some(total_elapsed),
        },
    );

    Ok(req.output_path.clone())
}

#[allow(clippy::too_many_arguments)]
async fn run_ffmpeg_pass(
    app: &AppHandle,
    ffmpeg: &Path,
    args: &[String],
    req: &ExportRequest,
    expected_duration: f64,
    base_pct: f64,
    end_pct: f64,
    stage_msg: &str,
    total_started: std::time::Instant,
    active_pid: &Arc<Mutex<Option<u32>>>,
    cancelled: &Arc<Mutex<bool>>,
) -> Result<String, String> {
    let _ = app.emit(
        "export-progress",
        ExportProgressEvent {
            status: "running".into(),
            percent: base_pct,
            out_time_sec: 0.0,
            expected_duration_sec: expected_duration,
            speed: String::new(),
            written_bytes: 0,
            message: stage_msg.to_string(),
            output_path: req.output_path.clone(),
            eta_sec: None,
            write_bytes_per_sec: None,
            elapsed_sec: Some(total_started.elapsed().as_secs_f64()),
        },
    );

    let mut cmd = Command::new(ffmpeg);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let pass_started = std::time::Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("启动 ffmpeg 失败: {e}"))?;
    *active_pid.lock() = child.id();

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
                    let pct = (base_pct + raw_ratio * (end_pct - base_pct)).clamp(0.0, 99.5);
                    let pass_elapsed = pass_started.elapsed().as_secs_f64();
                    let write_bps = if pass_elapsed > 0.15 && written_bytes > 0 {
                        Some(written_bytes as f64 / pass_elapsed)
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
                    } else if out_time_sec > 0.3 && pass_elapsed > 0.2 {
                        Some(remaining_media * (pass_elapsed / out_time_sec))
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
                            message: stage_msg.to_string(),
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
    *active_pid.lock() = None;

    let stderr_text = stderr_handle.await.unwrap_or_default();
    if *cancelled.lock() {
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
        return Err("导出已由用户取消".to_string());
    }

    if !status.success() {
        let msg = if stderr_text.trim().is_empty() {
            format!("FFmpeg 进阶导出失败 (退出码 {:?})", status.code())
        } else {
            format!("FFmpeg 进阶导出失败:\n{stderr_text}")
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

    Ok(speed)
}

#[cfg(test)]
mod tests {
    use super::{calculate_target_size_plan, generate_hdr_to_sdr_cube_lut};

    #[test]
    fn test_target_size_bitrate_calculation() {
        // 50 MB for 60 seconds with 1 audio track (AAC 192k)
        let plan = calculate_target_size_plan(50.0, 60.0, 1, "aac_192", "mp4").unwrap();
        let estimated_bytes =
            ((plan.video_kbps + plan.audio_kbps_per_track) as f64 * 1000.0 / 8.0) * 60.0;
        assert!(estimated_bytes <= 50.0 * 1024.0 * 1024.0);
        assert!(plan.video_kbps > 5500 && plan.video_kbps < 6600);

        // Tight target: 10 MB for 300s (5 min) should auto-downscale audio so video still gets safe budget
        let tight = calculate_target_size_plan(10.0, 300.0, 1, "aac_320", "mp4").unwrap();
        assert!(tight.audio_kbps_per_track <= 64);
        assert!(tight.video_kbps >= 150);

        // Impossibly tiny target should return clear error
        assert!(calculate_target_size_plan(0.5, 3600.0, 1, "aac_128", "mp4").is_err());
    }

    #[test]
    fn test_hdr_to_sdr_cube_lut_generation() {
        for algo in ["hable", "mobius", "reinhard", "bt2390"] {
            let p = std::env::temp_dir().join(format!("hdrcut_lut_test_{algo}.cube"));
            generate_hdr_to_sdr_cube_lut(&p, false, algo).unwrap();
            let text = std::fs::read_to_string(&p).unwrap();
            let lines: Vec<&str> = text.lines().collect();
            assert_eq!(lines.len(), 4 + 33 * 33 * 33);
            assert!(lines[1].contains("LUT_3D_SIZE 33"));
            let _ = std::fs::remove_file(&p);
        }
    }
}
