#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;

/// Resolves native binaries (ffmpeg, ffprobe, mkvmerge) and libmpv shared library
/// across bundled macOS .app, Windows installation dir, Homebrew arm64, and system PATH.
pub fn find_binary(name: &str) -> Option<PathBuf> {
    let exe_name = if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // Next to executable (Windows & dev)
            candidates.push(exe_dir.join(&exe_name));
            candidates.push(exe_dir.join("bin").join(&exe_name));
            candidates.push(exe_dir.join("resources").join(&exe_name));
            candidates.push(exe_dir.join("resources").join("bin").join(&exe_name));

            // Inside macOS .app/Contents/Resources/bin or MacOS
            if let Some(contents_dir) = exe_dir.parent() {
                candidates.push(contents_dir.join("Resources").join("bin").join(&exe_name));
                candidates.push(contents_dir.join("Resources").join(&exe_name));
            }
        }
    }

    // Prefer native Apple Silicon Homebrew binaries over older x86_64 /usr/local/bin ones
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin").join(&exe_name));
        candidates.push(PathBuf::from("/usr/local/bin").join(&exe_name));
        candidates.push(PathBuf::from("/usr/bin").join(&exe_name));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(Path::new(&pf).join("MKVToolNix").join(&exe_name));
            candidates.push(Path::new(&pf).join("ffmpeg").join("bin").join(&exe_name));
        }
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // Search PATH
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let p = dir.join(&exe_name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    None
}

pub fn find_libmpv_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    let names = ["libmpv.2.dylib", "libmpv.dylib"];
    #[cfg(target_os = "windows")]
    let names = ["libmpv-2.dll", "mpv-2.dll", "libmpv.dll"];
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let names = ["libmpv.so.2", "libmpv.so"];

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for name in &names {
                candidates.push(exe_dir.join(name));
                candidates.push(exe_dir.join("resources").join(name));
            }
            if let Some(contents_dir) = exe_dir.parent() {
                for name in &names {
                    candidates.push(contents_dir.join("Frameworks").join(name));
                    candidates.push(contents_dir.join("Resources").join(name));
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for name in &names {
            candidates.push(PathBuf::from("/opt/homebrew/lib").join(name));
            candidates.push(PathBuf::from("/usr/local/lib").join(name));
        }
    }

    // Fallback to dynamic linker search path
    for name in &names {
        candidates.push(PathBuf::from(name));
    }

    candidates
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ToolStatus {
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub mkvmerge: Option<String>,
    pub libmpv_available: bool,
    pub libmpv_path: Option<String>,
}

pub fn check_tool_status() -> ToolStatus {
    let libmpv_found = find_libmpv_candidates()
        .into_iter()
        .find(|p| p.is_file());

    ToolStatus {
        ffmpeg: find_binary("ffmpeg").map(|p| p.to_string_lossy().to_string()),
        ffprobe: find_binary("ffprobe").map(|p| p.to_string_lossy().to_string()),
        mkvmerge: find_binary("mkvmerge").map(|p| p.to_string_lossy().to_string()),
        libmpv_available: libmpv_found.is_some(),
        libmpv_path: libmpv_found.map(|p| p.to_string_lossy().to_string()),
    }
}
