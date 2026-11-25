use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use tokio::process::Command;

use crate::bins::find_binary;
use crate::keyframe_index::extract_keyframes_fast;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VideoStreamInfo {
    pub stream_index: usize,
    pub codec_name: String,
    pub codec_long_name: String,
    pub profile: Option<String>,
    pub level: Option<i64>,
    pub width: u32,
    pub height: u32,
    pub sar: Option<String>,
    pub dar: Option<String>,
    pub fps: f64,
    pub fps_display: String,
    pub pix_fmt: Option<String>,
    pub bit_depth: Option<u32>,
    pub chroma_location: Option<String>,
    pub field_order: Option<String>,
    pub has_b_frames: Option<i64>,
    pub color_space: Option<String>,
    pub color_transfer: Option<String>,
    pub color_primaries: Option<String>,
    pub color_range: Option<String>,
    pub time_base_den: u32,
    pub master_display: Option<String>,
    pub max_cll: Option<String>,
    pub is_hdr: bool,
    pub hdr_format: Option<String>,
    pub bit_rate: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AudioStreamInfo {
    /// Global FFmpeg stream index (0, 1, 2...)
    pub stream_index: usize,
    /// 0-based audio-only index (a:0, a:1, ...)
    pub audio_index: usize,
    /// 1-based track ID for libmpv `aid` property
    pub mpv_aid: usize,
    pub codec_name: String,
    pub codec_long_name: String,
    pub profile: Option<String>,
    pub channels: u32,
    pub channel_layout: String,
    pub sample_rate: u32,
    pub bit_rate: Option<u64>,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SubtitleStreamInfo {
    pub stream_index: usize,
    pub subtitle_index: usize,
    /// 1-based track ID for libmpv `sid` property
    pub mpv_sid: usize,
    pub codec_name: String,
    pub codec_long_name: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub is_default: bool,
    pub is_forced: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MediaInfo {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub format_name: String,
    pub format_long_name: String,
    pub nb_streams: usize,
    pub nb_chapters: usize,
    pub encoder_tag: Option<String>,
    pub duration: f64,
    pub bit_rate: Option<u64>,
    pub video: Option<VideoStreamInfo>,
    pub audio_tracks: Vec<AudioStreamInfo>,
    pub subtitle_tracks: Vec<SubtitleStreamInfo>,
    pub keyframes: Vec<f64>,
    pub keyframe_source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExternalAudioInfo {
    pub file_path: String,
    pub file_name: String,
    pub codec_name: String,
    pub channels: u32,
    pub channel_layout: String,
    pub sample_rate: u32,
    pub bit_rate: Option<u64>,
    pub language: Option<String>,
    pub title: Option<String>,
    pub duration: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExternalSubtitleInfo {
    pub file_path: String,
    pub file_name: String,
    pub codec_name: String,
    pub title: String,
}

fn parse_fraction(s: &str) -> Option<f64> {
    if let Some((n, d)) = s.split_once('/') {
        let num: f64 = n.parse().ok()?;
        let den: f64 = d.parse().ok()?;
        if den > 0.0 {
            return Some(num / den);
        }
    }
    s.parse().ok()
}

fn parse_timebase_den(s: &str) -> u32 {
    if let Some((_, d)) = s.split_once('/') {
        if let Ok(den) = d.parse::<u32>() {
            if den > 0 {
                return den;
            }
        }
    }
    1000
}

fn extract_x265_hdr_side_data(side_data: Option<&Vec<Value>>) -> (Option<String>, Option<String>) {
    let mut master_display = None;
    let mut max_cll = None;

    let Some(list) = side_data else {
        return (None, None);
    };

    let parse_scaled = |val: Option<&Value>, scale: f64| -> Option<u64> {
        let s = val?.as_str()?;
        let f = parse_fraction(s)?;
        Some((f * scale).round().max(0.0) as u64)
    };

    for item in list {
        let sd_type = item
            .get("side_data_type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();

        if sd_type.contains("mastering display") {
            if let (Some(gx), Some(gy), Some(bx), Some(by), Some(rx), Some(ry), Some(wx), Some(wy), Some(lmax), Some(lmin)) = (
                parse_scaled(item.get("green_x"), 50000.0),
                parse_scaled(item.get("green_y"), 50000.0),
                parse_scaled(item.get("blue_x"), 50000.0),
                parse_scaled(item.get("blue_y"), 50000.0),
                parse_scaled(item.get("red_x"), 50000.0),
                parse_scaled(item.get("red_y"), 50000.0),
                parse_scaled(item.get("white_point_x"), 50000.0),
                parse_scaled(item.get("white_point_y"), 50000.0),
                parse_scaled(item.get("max_luminance"), 10000.0),
                parse_scaled(item.get("min_luminance"), 10000.0),
            ) {
                master_display = Some(format!(
                    "G({gx},{gy})B({bx},{by})R({rx},{ry})WP({wx},{wy})L({lmax},{lmin})"
                ));
            }
        } else if sd_type.contains("content light level") {
            let max_content = item.get("max_content").and_then(|v| v.as_u64()).unwrap_or(0);
            let max_avg = item.get("max_average").and_then(|v| v.as_u64()).unwrap_or(0);
            if max_content > 0 || max_avg > 0 {
                max_cll = Some(format!("{max_content},{max_avg}"));
            }
        }
    }

    (master_display, max_cll)
}

fn detect_bit_depth(pix_fmt: Option<&str>, bits_per_raw: Option<&str>) -> Option<u32> {
    if let Some(b) = bits_per_raw.and_then(|v| v.parse::<u32>().ok()) {
        if b > 0 {
            return Some(b);
        }
    }
    let pf = pix_fmt?;
    if pf.contains("12le") || pf.contains("12be") || pf.contains("p12") {
        Some(12)
    } else if pf.contains("10le") || pf.contains("10be") || pf.contains("p10") {
        Some(10)
    } else if pf.contains("16le") || pf.contains("16be") {
        Some(16)
    } else {
        Some(8)
    }
}

fn detect_hdr(
    color_transfer: Option<&str>,
    color_primaries: Option<&str>,
    side_data: Option<&Vec<Value>>,
) -> (bool, Option<String>) {
    let mut has_dovi = false;
    let mut has_hdr10_plus = false;
    let mut has_mastering = false;
    let mut has_cll = false;

    if let Some(list) = side_data {
        for item in list {
            if let Some(sd_type) = item.get("side_data_type").and_then(|v| v.as_str()) {
                let low = sd_type.to_lowercase();
                if low.contains("dovi") || low.contains("dolby vision") {
                    has_dovi = true;
                } else if low.contains("hdr10+") || low.contains("dynamic hdr") || low.contains("smpte2094") {
                    has_hdr10_plus = true;
                } else if low.contains("mastering display") {
                    has_mastering = true;
                } else if low.contains("content light level") {
                    has_cll = true;
                }
            }
        }
    }

    let tr = color_transfer.unwrap_or("").to_lowercase();
    let pr = color_primaries.unwrap_or("").to_lowercase();

    if has_dovi {
        if tr == "smpte2084" {
            return (true, Some("Dolby Vision + HDR10".to_string()));
        }
        return (true, Some("Dolby Vision".to_string()));
    }
    if has_hdr10_plus {
        return (true, Some("HDR10+".to_string()));
    }
    if tr == "smpte2084" {
        return (true, Some("HDR10 (PQ)".to_string()));
    }
    if tr == "arib-std-b67" {
        return (true, Some("HLG HDR".to_string()));
    }
    if (has_mastering || has_cll) && pr == "bt2020" {
        return (true, Some("HDR (BT.2020)".to_string()));
    }
    (false, None)
}

pub async fn probe_media(file_path: &str) -> Result<MediaInfo, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("文件不存在: {file_path}"));
    }

    let ffprobe = find_binary("ffprobe")
        .ok_or_else(|| "未找到 ffprobe，请确认 FFmpeg 已安装或打包".to_string())?;

    let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());

    // Run ffprobe header scan & pure-Rust fast keyframe index in parallel!
    let path_owned = path.to_path_buf();
    let kf_task = tokio::task::spawn_blocking(move || extract_keyframes_fast(&path_owned));

    let mut cmd = Command::new(&ffprobe);
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        file_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("启动 ffprobe 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe 解析失败: {stderr}"));
    }

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("解析 ffprobe JSON 失败: {e}"))?;

    let format_obj = json.get("format");
    let format_name = format_obj
        .and_then(|f| f.get("format_name"))
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let format_long_name = format_obj
        .and_then(|f| f.get("format_long_name"))
        .and_then(|v| v.as_str())
        .unwrap_or(&format_name)
        .to_string();
    let nb_streams = format_obj
        .and_then(|f| f.get("nb_streams"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;
    let nb_chapters = json
        .get("chapters")
        .and_then(|c| c.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    let encoder_tag = format_obj
        .and_then(|f| f.get("tags"))
        .and_then(|t| t.get("encoder").or_else(|| t.get("ENCODER")))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let duration = format_obj
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let bit_rate = format_obj
        .and_then(|f| f.get("bit_rate"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok());

    let mut video: Option<VideoStreamInfo> = None;
    let mut audio_tracks: Vec<AudioStreamInfo> = Vec::new();
    let mut subtitle_tracks: Vec<SubtitleStreamInfo> = Vec::new();

    if let Some(streams) = json.get("streams").and_then(|s| s.as_array()) {
        for s in streams {
            let codec_type = s.get("codec_type").and_then(|v| v.as_str()).unwrap_or("");
            let stream_index = s.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let codec_name = s
                .get("codec_name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let codec_long_name = s
                .get("codec_long_name")
                .and_then(|v| v.as_str())
                .unwrap_or(&codec_name)
                .to_string();
            let profile = s.get("profile").and_then(|v| v.as_str()).map(|v| v.to_string());
            let tags = s.get("tags");
            let tag_str = |k: &str| -> Option<String> {
                tags.and_then(|t| {
                    t.get(k)
                        .or_else(|| t.get(&k.to_uppercase()))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
            };

            match codec_type {
                "video" => {
                    // Ignore attached cover art pictures (mjpeg/png with attached_pic disposition)
                    let is_attached_pic = s
                        .get("disposition")
                        .and_then(|d| d.get("attached_pic"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                        == 1;
                    if video.is_none() && !is_attached_pic {
                        let width = s.get("width").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        let height = s.get("height").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
                        let fps_raw = s
                            .get("avg_frame_rate")
                            .and_then(|v| v.as_str())
                            .filter(|r| *r != "0/0")
                            .or_else(|| s.get("r_frame_rate").and_then(|v| v.as_str()))
                            .unwrap_or("0/1");
                        let fps = parse_fraction(fps_raw).unwrap_or(0.0);
                        let fps_display = if (fps - fps.round()).abs() < 0.01 {
                            format!("{:.0}", fps.round())
                        } else {
                            format!("{:.3}", fps)
                        };
                        let pix_fmt = s.get("pix_fmt").and_then(|v| v.as_str()).map(|v| v.to_string());
                        let bits_raw = s.get("bits_per_raw_sample").and_then(|v| v.as_str());
                        let bit_depth = detect_bit_depth(pix_fmt.as_deref(), bits_raw);
                        let color_space = s
                            .get("color_space")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let color_transfer = s
                            .get("color_transfer")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let color_primaries = s
                            .get("color_primaries")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let color_range = s
                            .get("color_range")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let time_base_den = s
                            .get("time_base")
                            .and_then(|v| v.as_str())
                            .map(parse_timebase_den)
                            .unwrap_or(1000);
                        let side_data = s.get("side_data_list").and_then(|v| v.as_array());
                        let (master_display, max_cll) = extract_x265_hdr_side_data(side_data);
                        let (is_hdr, hdr_format) = detect_hdr(
                            color_transfer.as_deref(),
                            color_primaries.as_deref(),
                            side_data,
                        );
                        let level = s.get("level").and_then(|v| v.as_i64());
                        let sar = s
                            .get("sample_aspect_ratio")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let dar = s
                            .get("display_aspect_ratio")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let chroma_location = s
                            .get("chroma_location")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let field_order = s
                            .get("field_order")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string());
                        let has_b_frames = s.get("has_b_frames").and_then(|v| v.as_i64());
                        let v_bitrate = s
                            .get("bit_rate")
                            .and_then(|v| v.as_str())
                            .and_then(|x| x.parse::<u64>().ok())
                            .or_else(|| {
                                tag_str("BPS")
                                    .or_else(|| tag_str("BPS-eng"))
                                    .and_then(|x| x.parse::<u64>().ok())
                            });

                        video = Some(VideoStreamInfo {
                            stream_index,
                            codec_name,
                            codec_long_name,
                            profile,
                            level,
                            width,
                            height,
                            sar,
                            dar,
                            fps,
                            fps_display,
                            pix_fmt,
                            bit_depth,
                            chroma_location,
                            field_order,
                            has_b_frames,
                            color_space,
                            color_transfer,
                            color_primaries,
                            color_range,
                            time_base_den,
                            master_display,
                            max_cll,
                            is_hdr,
                            hdr_format,
                            bit_rate: v_bitrate,
                        });
                    }
                }
                "audio" => {
                    let audio_index = audio_tracks.len();
                    let channels = s.get("channels").and_then(|v| v.as_u64()).unwrap_or(2) as u32;
                    let channel_layout = s
                        .get("channel_layout")
                        .and_then(|v| v.as_str())
                        .map(|v| v.to_string())
                        .unwrap_or_else(|| match channels {
                            1 => "mono".to_string(),
                            2 => "stereo".to_string(),
                            6 => "5.1".to_string(),
                            8 => "7.1".to_string(),
                            n => format!("{n}ch"),
                        });
                    let sample_rate = s
                        .get("sample_rate")
                        .and_then(|v| v.as_str())
                        .and_then(|x| x.parse::<u32>().ok())
                        .unwrap_or(48000);
                    let a_bitrate = s
                        .get("bit_rate")
                        .and_then(|v| v.as_str())
                        .and_then(|x| x.parse::<u64>().ok())
                        .or_else(|| {
                            tag_str("BPS")
                                .or_else(|| tag_str("BPS-eng"))
                                .and_then(|x| x.parse::<u64>().ok())
                        });
                    let is_default = s
                        .get("disposition")
                        .and_then(|d| d.get("default"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                        == 1;

                    audio_tracks.push(AudioStreamInfo {
                        stream_index,
                        audio_index,
                        mpv_aid: audio_index + 1,
                        codec_name,
                        codec_long_name,
                        profile,
                        channels,
                        channel_layout,
                        sample_rate,
                        bit_rate: a_bitrate,
                        language: tag_str("language"),
                        title: tag_str("title"),
                        is_default,
                    });
                }
                "subtitle" => {
                    let subtitle_index = subtitle_tracks.len();
                    let is_default = s
                        .get("disposition")
                        .and_then(|d| d.get("default"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                        == 1;
                    let is_forced = s
                        .get("disposition")
                        .and_then(|d| d.get("forced"))
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0)
                        == 1;
                    subtitle_tracks.push(SubtitleStreamInfo {
                        stream_index,
                        subtitle_index,
                        mpv_sid: subtitle_index + 1,
                        codec_name,
                        codec_long_name,
                        language: tag_str("language"),
                        title: tag_str("title"),
                        is_default,
                        is_forced,
                    });
                }
                _ => {}
            }
        }
    }

    let (keyframes, keyframe_source) = match kf_task.await.ok().flatten() {
        Some(kfs) if !kfs.is_empty() => (kfs, "native-index".to_string()),
        _ => (Vec::new(), "on-demand".to_string()),
    };

    Ok(MediaInfo {
        file_path: file_path.to_string(),
        file_name,
        file_size,
        format_name,
        format_long_name,
        nb_streams,
        nb_chapters,
        encoder_tag,
        duration,
        bit_rate,
        video,
        audio_tracks,
        subtitle_tracks,
        keyframes,
        keyframe_source,
    })
}

pub async fn probe_external_audio(file_path: &str) -> Result<ExternalAudioInfo, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("音频文件不存在: {file_path}"));
    }
    let ffprobe = find_binary("ffprobe").ok_or_else(|| "未找到 ffprobe".to_string())?;
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());

    let mut cmd = Command::new(&ffprobe);
    cmd.args([
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-select_streams",
        "a:0",
        file_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("解析外部音轨失败: {e}"))?;
    let json: Value =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("解析音频 JSON 失败: {e}"))?;
    let stream = json
        .get("streams")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "所选文件中未检测到音频流".to_string())?;

    let codec_name = stream
        .get("codec_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let channels = stream.get("channels").and_then(|v| v.as_u64()).unwrap_or(2) as u32;
    let channel_layout = stream
        .get("channel_layout")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| match channels {
            1 => "mono".into(),
            2 => "stereo".into(),
            6 => "5.1".into(),
            8 => "7.1".into(),
            n => format!("{n}ch"),
        });
    let sample_rate = stream
        .get("sample_rate")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(48000);
    let bit_rate = stream
        .get("bit_rate")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| {
            json.get("format")
                .and_then(|f| f.get("bit_rate"))
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<u64>().ok())
        });
    let duration = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    let tags = stream.get("tags");
    let language = tags
        .and_then(|t| t.get("language"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let title = tags
        .and_then(|t| t.get("title"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(ExternalAudioInfo {
        file_path: file_path.to_string(),
        file_name,
        codec_name,
        channels,
        channel_layout,
        sample_rate,
        bit_rate,
        language,
        title,
        duration,
    })
}

pub fn probe_external_subtitle(file_path: &str) -> Result<ExternalSubtitleInfo, String> {
    let path = Path::new(file_path);
    if !path.is_file() {
        return Err(format!("字幕文件不存在: {file_path}"));
    }
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| file_path.to_string());
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let codec_name = match ext.as_str() {
        "ass" => "ass",
        "ssa" => "ssa",
        "vtt" => "webvtt",
        "sup" => "hdmv_pgs_subtitle",
        "sub" | "idx" => "dvd_subtitle",
        _ => "subrip",
    }
    .to_string();
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "外挂字幕".to_string());

    Ok(ExternalSubtitleInfo {
        file_path: file_path.to_string(),
        file_name,
        codec_name,
        title: stem,
    })
}

/// On-demand targeted local keyframe probe using ffprobe `-read_intervals`.
/// Seeks directly to [target - window, target + window] — fast (< 80ms) even on 100GB files!
pub async fn probe_keyframes_near(
    file_path: &str,
    target_time: f64,
    window_sec: f64,
) -> Result<Vec<f64>, String> {
    let ffprobe = find_binary("ffprobe")
        .ok_or_else(|| "未找到 ffprobe".to_string())?;

    let start = (target_time - window_sec).max(0.0);
    let duration = window_sec * 2.0;
    let interval = format!("{start:.3}%+{duration:.3}");

    let mut cmd = Command::new(&ffprobe);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-skip_frame",
        "nokey",
        "-read_intervals",
        &interval,
        "-show_entries",
        "packet=pts_time,dts_time,flags",
        "-of",
        "json",
        file_path,
    ]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("ffprobe 关键帧查询失败: {e}"))?;

    let json: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("解析关键帧 JSON 失败: {e}"))?;

    let mut kfs = Vec::new();
    if let Some(packets) = json.get("packets").and_then(|v| v.as_array()) {
        for pkt in packets {
            let flags = pkt.get("flags").and_then(|v| v.as_str()).unwrap_or("");
            if !flags.contains('K') {
                continue;
            }
            let ts = pkt
                .get("pts_time")
                .or_else(|| pkt.get("dts_time"))
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<f64>().ok());
            if let Some(t) = ts {
                kfs.push(t);
            }
        }
    }

    kfs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    kfs.dedup_by(|a, b| (*a - *b).abs() < 0.001);
    Ok(kfs)
}
