use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::process::Command;

const GITHUB_OWNER: &str = "xzajyjs";
const GITHUB_REPO: &str = "HDRCut";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_name: String,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub asset_size: u64,
    pub can_self_update: bool,
    pub self_update_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressEvent {
    pub stage: String, // "downloading" | "installing" | "restarting" | "error" | "cancelled"
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub message: String,
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

pub struct UpdaterState {
    cancel_flag: Arc<AtomicBool>,
    in_progress: Arc<AtomicBool>,
}

impl UpdaterState {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
            in_progress: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
    }
}

/// Parse semantic version `v1.4.2` or `1.4.2-beta` into `(major, minor, patch)`.
pub fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let trimmed = raw.trim().trim_start_matches('v').trim_start_matches('V');
    let core = trimmed.split(['-', '+']).next().unwrap_or(trimmed);
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

pub fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    }
}

/// Normalize proxy URL (adds `http://` scheme if missing, e.g. `127.0.0.1:1091`).
fn normalize_proxy_url(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if s.contains("://") {
        Some(s.to_string())
    } else {
        Some(format!("http://{s}"))
    }
}

/// Detect active proxy on macOS (checks env vars first, then `scutil --proxy` for GUI .app launches).
#[cfg(target_os = "macos")]
async fn detect_proxy_arg() -> Option<String> {
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(val) = std::env::var(key) {
            if let Some(norm) = normalize_proxy_url(&val) {
                return Some(norm);
            }
        }
    }

    // Read macOS System Configuration proxy (for Finder-launched .app bundles without shell env)
    if let Ok(out) = Command::new("/usr/sbin/scutil").arg("--proxy").output().await {
        if out.status.success() {
            let txt = String::from_utf8_lossy(&out.stdout);
            let mut http_on = false;
            let mut http_host = String::new();
            let mut http_port = String::new();
            let mut https_on = false;
            let mut https_host = String::new();
            let mut https_port = String::new();
            let mut socks_on = false;
            let mut socks_host = String::new();
            let mut socks_port = String::new();

            for line in txt.lines() {
                let line = line.trim();
                if let Some((k, v)) = line.split_once(':') {
                    let k = k.trim();
                    let v = v.trim();
                    match k {
                        "HTTPEnable" => http_on = v == "1",
                        "HTTPProxy" => http_host = v.to_string(),
                        "HTTPPort" => http_port = v.to_string(),
                        "HTTPSEnable" => https_on = v == "1",
                        "HTTPSProxy" => https_host = v.to_string(),
                        "HTTPSPort" => https_port = v.to_string(),
                        "SOCKSEnable" => socks_on = v == "1",
                        "SOCKSProxy" => socks_host = v.to_string(),
                        "SOCKSPort" => socks_port = v.to_string(),
                        _ => {}
                    }
                }
            }

            if https_on && !https_host.is_empty() && !https_port.is_empty() {
                return Some(format!("http://{https_host}:{https_port}"));
            }
            if http_on && !http_host.is_empty() && !http_port.is_empty() {
                return Some(format!("http://{http_host}:{http_port}"));
            }
            if socks_on && !socks_host.is_empty() && !socks_port.is_empty() {
                return Some(format!("socks5h://{socks_host}:{socks_port}"));
            }
        }
    }
    None
}

#[cfg(not(target_os = "macos"))]
async fn detect_proxy_arg() -> Option<String> {
    for key in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(val) = std::env::var(key) {
            if let Some(norm) = normalize_proxy_url(&val) {
                return Some(norm);
            }
        }
    }
    None
}

fn select_platform_asset<'a>(assets: &'a [GithubAsset]) -> Option<&'a GithubAsset> {
    #[cfg(target_os = "macos")]
    {
        assets
            .iter()
            .find(|a| a.name.ends_with(".dmg") && a.name.to_lowercase().contains("macos"))
            .or_else(|| assets.iter().find(|a| a.name.ends_with(".dmg")))
    }
    #[cfg(target_os = "windows")]
    {
        assets
            .iter()
            .find(|a| a.name.ends_with(".zip") && a.name.to_lowercase().contains("windows"))
            .or_else(|| assets.iter().find(|a| a.name.ends_with(".zip")))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = assets;
        None
    }
}

/// Resolve the currently running macOS `.app` bundle directory (`.../HDRCut.app`), if running from a bundle.
#[cfg(target_os = "macos")]
fn resolve_running_macos_app_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // Expected: <path>/HDRCut.app/Contents/MacOS/hdrcut
    let macos_dir = exe.parent()?;
    if macos_dir.file_name()?.to_string_lossy() != "MacOS" {
        return None;
    }
    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()?.to_string_lossy() != "Contents" {
        return None;
    }
    let app_dir = contents_dir.parent()?;
    if app_dir.extension()?.to_string_lossy() != "app" {
        return None;
    }
    if app_dir.join("Contents").join("Info.plist").is_file() {
        Some(app_dir.to_path_buf())
    } else {
        None
    }
}

fn check_self_update_capability() -> (bool, Option<String>) {
    #[cfg(target_os = "macos")]
    {
        if resolve_running_macos_app_bundle().is_some() {
            (true, None)
        } else {
            (
                false,
                Some("Development binary detected (not running inside HDRCut.app)".to_string()),
            )
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            let s = exe.to_string_lossy().to_lowercase();
            if s.contains("\\target\\debug\\") {
                return (
                    false,
                    Some("Development binary detected (target/debug)".to_string()),
                );
            }
        }
        (true, None)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        (false, Some("Unsupported platform for self-update".to_string()))
    }
}

/// Fetch latest release metadata from GitHub Releases API.
pub async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let api_url = format!("https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest");

    let json_text = fetch_url_text(&api_url).await?;
    let release: GithubRelease = serde_json::from_str(&json_text)
        .map_err(|e| format!("Failed to parse GitHub release metadata: {e}"))?;

    let latest_version = release.tag_name.trim().trim_start_matches('v').to_string();
    let has_update = is_newer_version(&current_version, &latest_version);
    let asset = select_platform_asset(&release.assets);
    let (can_self_update, self_update_note) = check_self_update_capability();

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        has_update,
        release_name: release
            .name
            .unwrap_or_else(|| format!("HDRCut {}", release.tag_name)),
        release_notes: release.body.unwrap_or_default(),
        release_url: release.html_url,
        published_at: release.published_at.unwrap_or_default(),
        asset_name: asset.map(|a| a.name.clone()),
        asset_url: asset.map(|a| a.browser_download_url.clone()),
        asset_size: asset.map(|a| a.size).unwrap_or(0),
        can_self_update: can_self_update && asset.is_some(),
        self_update_note: if asset.is_none() {
            Some("No matching platform asset found in the latest release".to_string())
        } else {
            self_update_note
        },
    })
}

async fn fetch_url_text(url: &str) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        // PowerShell natively respects Windows system proxy & TLS 1.2+
        let ps_script = format!(
            "$ErrorActionPreference='Stop'; \
             [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
             $resp = Invoke-WebRequest -UseBasicParsing -Uri '{}' -Headers @{{'User-Agent'='HDRCut-Updater'; 'Accept'='application/vnd.github+json'}} -TimeoutSec 20; \
             [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; \
             Write-Output $resp.Content",
            url.replace('\'', "''")
        );
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps_script]);
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
        let out = cmd
            .output()
            .await
            .map_err(|e| format!("Failed to invoke network client: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("GitHub API request failed: {}", err.trim()));
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new("/usr/bin/curl");
        cmd.args([
            "-fsSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "30",
            "-H",
            "User-Agent: HDRCut-Updater",
            "-H",
            "Accept: application/vnd.github+json",
        ]);
        if let Some(proxy) = detect_proxy_arg().await {
            cmd.args(["--proxy", &proxy]);
        }
        cmd.arg(url);

        let out = cmd
            .output()
            .await
            .map_err(|e| format!("Failed to run curl: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("GitHub API request failed: {}", err.trim()));
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }
}

async fn download_with_progress(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    expected_size: u64,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::remove_file(dest);

    let mut child = {
        #[cfg(target_os = "windows")]
        {
            let ps_script = format!(
                "$ErrorActionPreference='Stop'; \
                 [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
                 $wc = New-Object System.Net.WebClient; \
                 $wc.Headers.Add('User-Agent', 'HDRCut-Updater'); \
                 $wc.DownloadFile('{}', '{}')",
                url.replace('\'', "''"),
                dest.to_string_lossy().replace('\'', "''")
            );
            let mut cmd = Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps_script]);
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
            cmd.stdout(std::process::Stdio::null());
            cmd.stderr(std::process::Stdio::piped());
            cmd.spawn()
                .map_err(|e| format!("Failed to start download: {e}"))?
        }

        #[cfg(not(target_os = "windows"))]
        {
            let mut cmd = Command::new("/usr/bin/curl");
            cmd.args([
                "-fL",
                "--connect-timeout",
                "20",
                "--retry",
                "2",
                "-H",
                "User-Agent: HDRCut-Updater",
                "-o",
                &dest.to_string_lossy(),
            ]);
            if let Some(proxy) = detect_proxy_arg().await {
                cmd.args(["--proxy", &proxy]);
            }
            cmd.arg(url);
            cmd.stdout(std::process::Stdio::null());
            cmd.stderr(std::process::Stdio::piped());
            cmd.spawn()
                .map_err(|e| format!("Failed to start curl download: {e}"))?
        }
    };

    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = child.kill().await;
            let _ = std::fs::remove_file(dest);
            let _ = app.emit(
                "update-progress",
                UpdateProgressEvent {
                    stage: "cancelled".into(),
                    percent: 0.0,
                    downloaded_bytes: 0,
                    total_bytes: expected_size,
                    message: "Update cancelled".into(),
                },
            );
            return Err("CANCELLED".into());
        }

        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Download monitor error: {e}"))?
        {
            if !status.success() {
                let mut err_buf = String::new();
                if let Some(mut stderr) = child.stderr.take() {
                    use tokio::io::AsyncReadExt;
                    let _ = stderr.read_to_string(&mut err_buf).await;
                }
                let _ = std::fs::remove_file(dest);
                return Err(format!("Download failed: {}", err_buf.trim()));
            }
            break;
        }

        let written = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
        let percent = if expected_size > 0 {
            ((written as f64 / expected_size as f64) * 100.0).clamp(0.0, 99.0)
        } else {
            0.0
        };
        let _ = app.emit(
            "update-progress",
            UpdateProgressEvent {
                stage: "downloading".into(),
                percent,
                downloaded_bytes: written,
                total_bytes: expected_size,
                message: format!("{:.0}%", percent),
            },
        );

        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    let final_size = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    if final_size < 1024 * 1024 {
        let _ = std::fs::remove_file(dest);
        return Err("Downloaded update package appears incomplete or corrupted".into());
    }

    let _ = app.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: "downloading".into(),
            percent: 100.0,
            downloaded_bytes: final_size,
            total_bytes: expected_size.max(final_size),
            message: "100%".into(),
        },
    );

    Ok(())
}

/// Download the latest release asset, verify/extract it, stage an atomic self-replacement,
/// and relaunch HDRCut cleanly.
pub async fn download_and_install_update(
    app: AppHandle,
    state: &UpdaterState,
    asset_url: String,
    asset_name: String,
    asset_size: u64,
    on_before_exit: impl FnOnce(),
) -> Result<(), String> {
    if state
        .in_progress
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("An update is already in progress".into());
    }
    state.cancel_flag.store(false, Ordering::SeqCst);

    let result = run_update_pipeline(
        &app,
        &state.cancel_flag,
        &asset_url,
        &asset_name,
        asset_size,
        on_before_exit,
    )
    .await;

    state.in_progress.store(false, Ordering::SeqCst);

    if let Err(ref e) = result {
        if e != "CANCELLED" {
            let _ = app.emit(
                "update-progress",
                UpdateProgressEvent {
                    stage: "error".into(),
                    percent: 0.0,
                    downloaded_bytes: 0,
                    total_bytes: asset_size,
                    message: e.clone(),
                },
            );
        }
    }
    result
}

async fn run_update_pipeline(
    app: &AppHandle,
    cancel_flag: &Arc<AtomicBool>,
    asset_url: &str,
    asset_name: &str,
    asset_size: u64,
    on_before_exit: impl FnOnce(),
) -> Result<(), String> {
    let work_dir = std::env::temp_dir().join(format!("hdrcut_update_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&work_dir);
    let download_path = work_dir.join(asset_name);

    download_with_progress(app, asset_url, &download_path, asset_size, cancel_flag).await?;

    let _ = app.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: "installing".into(),
            percent: 100.0,
            downloaded_bytes: asset_size,
            total_bytes: asset_size,
            message: "Installing update...".into(),
        },
    );

    #[cfg(target_os = "macos")]
    {
        install_macos_dmg(app, &work_dir, &download_path, on_before_exit).await?;
    }

    #[cfg(target_os = "windows")]
    {
        install_windows_zip(app, &work_dir, &download_path, on_before_exit).await?;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (on_before_exit, &download_path);
        return Err("Automatic installation is only supported on macOS and Windows".into());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
async fn install_macos_dmg(
    app: &AppHandle,
    work_dir: &Path,
    dmg_path: &Path,
    on_before_exit: impl FnOnce(),
) -> Result<(), String> {
    let target_app = resolve_running_macos_app_bundle()
        .ok_or_else(|| "Cannot self-update outside of HDRCut.app bundle".to_string())?;
    let parent_dir = target_app
        .parent()
        .ok_or_else(|| "Invalid .app bundle parent directory".to_string())?;

    let mount_dir = work_dir.join("mnt");
    let _ = std::fs::create_dir_all(&mount_dir);

    // 1. Mount DMG silently
    let attach = Command::new("/usr/bin/hdiutil")
        .args([
            "attach",
            &dmg_path.to_string_lossy(),
            "-nobrowse",
            "-noautoopen",
            "-quiet",
            "-mountpoint",
            &mount_dir.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to mount DMG: {e}"))?;

    if !attach.status.success() {
        let err = String::from_utf8_lossy(&attach.stderr);
        return Err(format!("Failed to mount update DMG: {}", err.trim()));
    }

    // Locate HDRCut.app inside mounted DMG
    let mounted_app = mount_dir.join("HDRCut.app");
    if !mounted_app.is_dir() {
        let _ = Command::new("/usr/bin/hdiutil")
            .args(["detach", &mount_dir.to_string_lossy(), "-force", "-quiet"])
            .output()
            .await;
        return Err("HDRCut.app not found inside update DMG".into());
    }

    // 2. Copy new bundle to same parent directory for instant atomic rename
    let staged_app = parent_dir.join(".HDRCut_update_new.app");
    let _ = std::fs::remove_dir_all(&staged_app);

    let copy_out = Command::new("/usr/bin/ditto")
        .arg(&mounted_app)
        .arg(&staged_app)
        .output()
        .await
        .map_err(|e| format!("Failed to stage new app bundle: {e}"))?;

    // Detach DMG & clean up temp DMG regardless of ditto result
    let _ = Command::new("/usr/bin/hdiutil")
        .args(["detach", &mount_dir.to_string_lossy(), "-force", "-quiet"])
        .output()
        .await;
    let _ = std::fs::remove_dir_all(work_dir);

    if !copy_out.status.success() {
        let _ = std::fs::remove_dir_all(&staged_app);
        let err = String::from_utf8_lossy(&copy_out.stderr);
        return Err(format!(
            "Failed to write update into {}: {}",
            parent_dir.display(),
            err.trim()
        ));
    }

    // Clear quarantine flag so macOS Gatekeeper never blocks the updated bundle
    let _ = Command::new("/usr/bin/xattr")
        .args(["-cr", &staged_app.to_string_lossy()])
        .output()
        .await;

    let backup_app = parent_dir.join(".HDRCut_update_backup.app");
    let pid = std::process::id();

    let _ = app.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: "restarting".into(),
            percent: 100.0,
            downloaded_bytes: 0,
            total_bytes: 0,
            message: "Restarting HDRCut...".into(),
        },
    );

    // 3. Spawn detached swap-and-relaunch script
    let script = r#"
PID="$1"
TARGET="$2"
STAGED="$3"
BACKUP="$4"

for i in $(seq 1 60); do
  if ! kill -0 "$PID" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

rm -rf "$BACKUP"
if mv "$TARGET" "$BACKUP"; then
  if mv "$STAGED" "$TARGET"; then
    rm -rf "$BACKUP"
    xattr -cr "$TARGET" 2>/dev/null || true
    open -n "$TARGET"
  else
    mv "$BACKUP" "$TARGET" 2>/dev/null || true
  fi
fi
"#;

    std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("hdrcut-updater")
        .arg(pid.to_string())
        .arg(&target_app)
        .arg(&staged_app)
        .arg(&backup_app)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn update swapper: {e}"))?;

    // Cleanly shut down libmpv and exit so swapper replaces bundle & relaunches
    on_before_exit();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "windows")]
async fn install_windows_zip(
    app: &AppHandle,
    work_dir: &Path,
    zip_path: &Path,
    on_before_exit: impl FnOnce(),
) -> Result<(), String> {
    let exe_path =
        std::env::current_exe().map_err(|e| format!("Cannot determine exe path: {e}"))?;
    let app_dir = exe_path
        .parent()
        .ok_or_else(|| "Invalid executable directory".to_string())?
        .to_path_buf();

    let extract_dir = work_dir.join("extracted");
    let _ = std::fs::create_dir_all(&extract_dir);

    let ps_extract = format!(
        "$ErrorActionPreference='Stop'; Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
        zip_path.to_string_lossy().replace('\'', "''"),
        extract_dir.to_string_lossy().replace('\'', "''")
    );
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &ps_extract]);
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x08000000);
    let out = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to extract update zip: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Failed to extract update zip: {}", err.trim()));
    }

    if !extract_dir.join("HDRCut.exe").is_file() {
        return Err("HDRCut.exe not found inside downloaded zip".into());
    }

    let _ = app.emit(
        "update-progress",
        UpdateProgressEvent {
            stage: "restarting".into(),
            percent: 100.0,
            downloaded_bytes: 0,
            total_bytes: 0,
            message: "Restarting HDRCut...".into(),
        },
    );

    let pid = std::process::id();
    let script_path = work_dir.join("apply_update.ps1");
    let ps_swap = format!(
        r#"
$pidToWait = {pid}
$src = '{src}'
$dst = '{dst}'
$work = '{work}'
$exeName = '{exe_name}'

try {{ Wait-Process -Id $pidToWait -Timeout 20 -ErrorAction SilentlyContinue }} catch {{}}
Start-Sleep -Milliseconds 400
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
Start-Process -FilePath (Join-Path $dst $exeName)
Start-Sleep -Seconds 2
Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue
"#,
        pid = pid,
        src = extract_dir.to_string_lossy().replace('\'', "''"),
        dst = app_dir.to_string_lossy().replace('\'', "''"),
        work = work_dir.to_string_lossy().replace('\'', "''"),
        exe_name = exe_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "HDRCut.exe".to_string())
            .replace('\'', "''"),
    );

    std::fs::write(&script_path, ps_swap)
        .map_err(|e| format!("Failed to write Windows updater script: {e}"))?;

    let mut swap_cmd = std::process::Command::new("powershell");
    swap_cmd
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(&script_path);
    swap_cmd.creation_flags(0x08000000);
    swap_cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch Windows updater: {e}"))?;

    on_before_exit();
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_newer_version, parse_semver};

    #[test]
    fn test_semver_comparison() {
        assert_eq!(parse_semver("v1.4.2"), Some((1, 4, 2)));
        assert_eq!(parse_semver("1.5.0"), Some((1, 5, 0)));
        assert!(is_newer_version("1.4.2", "1.5.0"));
        assert!(is_newer_version("1.4.2", "v1.4.3"));
        assert!(is_newer_version("1.9.9", "2.0.0"));
        assert!(!is_newer_version("1.5.0", "1.5.0"));
        assert!(!is_newer_version("1.5.0", "1.4.2"));
    }
}
