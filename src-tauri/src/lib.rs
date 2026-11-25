mod advanced_export;
mod bins;
mod exporter;
mod keyframe_index;
mod media_probe;
mod mpv_ffi;
#[cfg(target_os = "macos")]
mod mpv_mac_gl;
mod mpv_player;
#[cfg(not(target_os = "macos"))]
mod mpv_view;
mod project;
mod updater;

use bins::{check_tool_status, ToolStatus};
use exporter::{
    extract_audio_tracks, extract_subtitle_tracks, ExportManager, ExportRequest, ExtractAudioItem,
    ExtractSubtitleItem,
};
use media_probe::{
    probe_external_audio, probe_external_subtitle, probe_keyframes_near, probe_media,
    ExternalAudioInfo, ExternalSubtitleInfo, MediaInfo,
};
use mpv_player::MpvPlayer;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use updater::{
    check_for_updates, download_and_install_update, UpdateCheckResult, UpdaterState,
};

pub struct AppState {
    pub player: Arc<MpvPlayer>,
    pub exporter: Arc<ExportManager>,
    pub updater: Arc<UpdaterState>,
}

#[tauri::command]
fn get_tool_status() -> ToolStatus {
    check_tool_status()
}

#[tauri::command]
async fn analyze_media(file_path: String) -> Result<MediaInfo, String> {
    probe_media(&file_path).await
}

#[tauri::command]
async fn get_keyframes_near(
    file_path: String,
    target_time: f64,
    window_sec: Option<f64>,
) -> Result<Vec<f64>, String> {
    probe_keyframes_near(&file_path, target_time, window_sec.unwrap_or(15.0)).await
}

// IMPORTANT: All player commands are `async fn` so Tauri executes them on Tokio worker
// threads instead of blocking the macOS AppKit main thread!
#[tauri::command]
async fn player_init(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let player = state.player.clone();
    tokio::task::spawn_blocking(move || player.ensure_initialized(&app, &window))
        .await
        .map_err(|e| format!("初始化任务异常: {e}"))?
}

#[tauri::command]
async fn player_set_bounds(
    window: WebviewWindow,
    state: State<'_, AppState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_height: f64,
    scale_factor: f64,
    visible: bool,
) -> Result<(), String> {
    state.player.set_bounds(
        &window,
        x,
        y,
        width,
        height,
        viewport_height,
        scale_factor,
        visible,
    );
    Ok(())
}

#[tauri::command]
async fn player_load(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    file_path: String,
    hdr_format: Option<String>,
    start_time: Option<f64>,
    start_paused: Option<bool>,
) -> Result<(), String> {
    let player = state.player.clone();
    tokio::task::spawn_blocking(move || {
        player.ensure_initialized(&app, &window)?;
        player.load_file(&window, &file_path, hdr_format.as_deref(), start_time, start_paused)
    })
    .await
    .map_err(|e| format!("加载视频任务异常: {e}"))?
}

#[tauri::command]
async fn player_stop(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.player.stop_and_hide(&window)
}

#[tauri::command]
async fn player_toggle_pause(state: State<'_, AppState>) -> Result<bool, String> {
    state.player.toggle_pause()
}

#[tauri::command]
async fn player_set_pause(state: State<'_, AppState>, paused: bool) -> Result<(), String> {
    state.player.set_pause(paused)
}

#[tauri::command]
async fn player_seek(state: State<'_, AppState>, seconds: f64, exact: bool) -> Result<(), String> {
    state.player.seek_absolute(seconds, exact)
}

#[tauri::command]
async fn player_seek_relative(state: State<'_, AppState>, delta: f64) -> Result<(), String> {
    state.player.seek_relative(delta)
}

#[tauri::command]
async fn player_frame_step(state: State<'_, AppState>, forward: bool) -> Result<(), String> {
    state.player.frame_step(forward)
}

#[tauri::command]
async fn player_set_audio_track(state: State<'_, AppState>, aid: i64) -> Result<(), String> {
    state.player.set_audio_track(aid)
}

#[tauri::command]
async fn player_set_volume(state: State<'_, AppState>, volume: f64) -> Result<(), String> {
    state.player.set_volume(volume)
}

#[tauri::command]
async fn player_set_speed(state: State<'_, AppState>, speed: f64) -> Result<(), String> {
    state.player.set_speed(speed)
}

#[tauri::command]
async fn player_set_hdr(
    window: WebviewWindow,
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.player.set_hdr_passthrough(&window, enabled)
}

#[tauri::command]
async fn probe_external_audio_file(file_path: String) -> Result<ExternalAudioInfo, String> {
    probe_external_audio(&file_path).await
}

#[tauri::command]
fn probe_external_subtitle_file(file_path: String) -> Result<ExternalSubtitleInfo, String> {
    probe_external_subtitle(&file_path)
}

#[tauri::command]
async fn player_set_subtitle_track(state: State<'_, AppState>, sid: i64) -> Result<(), String> {
    state.player.set_subtitle_track(sid)
}

#[tauri::command]
async fn player_add_subtitle_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<i64, String> {
    state.player.add_subtitle_file(&file_path)
}

#[tauri::command]
async fn player_remove_subtitle_track(state: State<'_, AppState>, sid: i64) -> Result<(), String> {
    state.player.remove_subtitle_track(sid)
}

#[tauri::command]
async fn player_set_sub_delay(state: State<'_, AppState>, seconds: f64) -> Result<(), String> {
    state.player.set_sub_delay(seconds)
}

#[tauri::command]
async fn player_add_audio_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<i64, String> {
    state.player.add_audio_file(&file_path)
}

#[tauri::command]
async fn player_remove_audio_track(state: State<'_, AppState>, aid: i64) -> Result<(), String> {
    state.player.remove_audio_track(aid)
}

#[tauri::command]
async fn export_audio_tracks(
    input_path: String,
    items: Vec<ExtractAudioItem>,
) -> Result<Vec<String>, String> {
    extract_audio_tracks(&input_path, items).await
}

#[tauri::command]
async fn export_subtitle_tracks(
    input_path: String,
    items: Vec<ExtractSubtitleItem>,
) -> Result<Vec<String>, String> {
    extract_subtitle_tracks(&input_path, items).await
}

#[tauri::command]
async fn start_export(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ExportRequest,
) -> Result<String, String> {
    state.exporter.run_export(app, request).await
}

#[tauri::command]
fn cancel_export(state: State<'_, AppState>) -> Result<(), String> {
    state.exporter.cancel()
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("无法打开 Finder: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("无法打开资源管理器: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn check_app_update() -> Result<UpdateCheckResult, String> {
    check_for_updates().await
}

#[tauri::command]
async fn install_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
    asset_url: String,
    asset_name: String,
    asset_size: u64,
) -> Result<(), String> {
    let player = state.player.clone();
    let updater = state.updater.clone();
    download_and_install_update(app, &updater, asset_url, asset_name, asset_size, move || {
        player.shutdown();
    })
    .await
}

#[tauri::command]
fn cancel_app_update(state: State<'_, AppState>) {
    state.updater.cancel();
}

#[tauri::command]
fn save_project(file_path: String, content: String) -> Result<(), String> {
    project::save_project_file(&file_path, &content)
}

#[tauri::command]
fn load_project(file_path: String) -> Result<String, String> {
    project::load_project_file(&file_path)
}

#[tauri::command]
fn check_files_exist(paths: Vec<String>) -> Vec<bool> {
    project::check_files_exist(paths)
}

#[tauri::command]
fn find_file_in_dir(dir_path: String, file_name: String) -> Option<String> {
    project::find_file_in_dir(&dir_path, &file_name)
}

#[tauri::command]
fn show_project_menu(
    app: AppHandle,
    window: WebviewWindow,
    x: f64,
    y: f64,
    save_label: String,
    save_as_label: String,
    open_label: String,
) -> Result<(), String> {
    let save_item = MenuItemBuilder::with_id("save-project", &save_label)
        .accelerator("CmdOrCtrl+S")
        .build(&app)
        .map_err(|e| e.to_string())?;
    let save_as_item = MenuItemBuilder::with_id("save-project-as", &save_as_label)
        .accelerator("CmdOrCtrl+Shift+S")
        .build(&app)
        .map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let open_item = MenuItemBuilder::with_id("open-project", &open_label)
        .accelerator("CmdOrCtrl+Shift+O")
        .build(&app)
        .map_err(|e| e.to_string())?;
    let menu = MenuBuilder::new(&app)
        .items(&[&save_item, &save_as_item, &sep, &open_item])
        .build()
        .map_err(|e| e.to_string())?;
    window
        .popup_menu_at(&menu, tauri::Position::Logical(tauri::LogicalPosition::new(x, y)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        player: Arc::new(MpvPlayer::new()),
        exporter: Arc::new(ExportManager::new()),
        updater: Arc::new(UpdaterState::new()),
    };

    let player_for_close = app_state.player.clone();
    let player_for_exit = app_state.player.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_tool_status,
            analyze_media,
            probe_external_audio_file,
            probe_external_subtitle_file,
            get_keyframes_near,
            player_init,
            player_set_bounds,
            player_load,
            player_stop,
            player_toggle_pause,
            player_set_pause,
            player_seek,
            player_seek_relative,
            player_frame_step,
            player_set_audio_track,
            player_set_subtitle_track,
            player_add_subtitle_file,
            player_remove_subtitle_track,
            player_set_sub_delay,
            player_add_audio_file,
            player_remove_audio_track,
            player_set_volume,
            player_set_speed,
            player_set_hdr,
            export_audio_tracks,
            export_subtitle_tracks,
            start_export,
            cancel_export,
            reveal_in_folder,
            check_app_update,
            install_app_update,
            cancel_app_update,
            save_project,
            load_project,
            check_files_exist,
            find_file_in_dir,
            show_project_menu,
        ])
        .setup(|app| {
            // Build native menu so Cmd+W closes the active tab (not the entire window!),
            // Cmd+Z / Cmd+Shift+Z drive global Undo/Redo, and Cmd+S / Cmd+Shift+O manage projects.
            let new_tab = MenuItemBuilder::with_id("new-tab", "新建标签页 / New Tab")
                .accelerator("CmdOrCtrl+T")
                .build(app)?;
            let open_video = MenuItemBuilder::with_id("open-video", "导入视频... / Import Video...")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let open_project =
                MenuItemBuilder::with_id("open-project", "打开/导入项目... / Open Project...")
                    .accelerator("CmdOrCtrl+Shift+O")
                    .build(app)?;
            let save_project_item =
                MenuItemBuilder::with_id("save-project", "保存项目 / Save Project")
                    .accelerator("CmdOrCtrl+S")
                    .build(app)?;
            let save_project_as = MenuItemBuilder::with_id(
                "save-project-as",
                "导出/另存为项目... / Save Project As...",
            )
            .accelerator("CmdOrCtrl+Shift+S")
            .build(app)?;
            let close_tab = MenuItemBuilder::with_id("close-tab", "关闭当前标签页 / Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "文件")
                .item(&new_tab)
                .item(&open_video)
                .separator()
                .item(&open_project)
                .item(&save_project_item)
                .item(&save_project_as)
                .separator()
                .item(&close_tab)
                .build()?;

            let undo_item = MenuItemBuilder::with_id("undo", "撤销 / Undo")
                .accelerator("CmdOrCtrl+Z")
                .build(app)?;
            let redo_item = MenuItemBuilder::with_id("redo", "重做 / Redo")
                .accelerator("CmdOrCtrl+Shift+Z")
                .build(app)?;

            let edit_menu = SubmenuBuilder::new(app, "编辑")
                .item(&undo_item)
                .item(&redo_item)
                .separator()
                .item(&PredefinedMenuItem::cut(app, None)?)
                .item(&PredefinedMenuItem::copy(app, None)?)
                .item(&PredefinedMenuItem::paste(app, None)?)
                .item(&PredefinedMenuItem::select_all(app, None)?)
                .build()?;

            let prev_tab = MenuItemBuilder::with_id("prev-tab", "上一个标签页")
                .accelerator("CmdOrCtrl+Shift+[")
                .build(app)?;
            let next_tab = MenuItemBuilder::with_id("next-tab", "下一个标签页")
                .accelerator("CmdOrCtrl+Shift+]")
                .build(app)?;
            let mut tabs_builder = SubmenuBuilder::new(app, "标签页")
                .item(&prev_tab)
                .item(&next_tab)
                .separator();
            for n in 1..=9u8 {
                let label = if n == 9 {
                    "切换到标签页 9 / 末页".to_string()
                } else {
                    format!("切换到标签页 {}", n)
                };
                let item = MenuItemBuilder::with_id(format!("select-tab-{}", n), label)
                    .accelerator(format!("CmdOrCtrl+{}", n))
                    .build(app)?;
                tabs_builder = tabs_builder.item(&item);
            }
            let tabs_menu = tabs_builder.build()?;

            #[cfg(target_os = "macos")]
            let menu = {
                let app_menu = SubmenuBuilder::new(app, "HDRCut")
                    .item(&PredefinedMenuItem::about(app, None, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::hide(app, None)?)
                    .item(&PredefinedMenuItem::hide_others(app, None)?)
                    .item(&PredefinedMenuItem::show_all(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::quit(app, None)?)
                    .build()?;
                MenuBuilder::new(app)
                    .item(&app_menu)
                    .item(&file_menu)
                    .item(&edit_menu)
                    .item(&tabs_menu)
                    .build()?
            };

            #[cfg(not(target_os = "macos"))]
            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&tabs_menu)
                .build()?;

            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            match id {
                "close-tab" => {
                    let _ = app.emit("shortcut-close-tab", ());
                }
                "new-tab" => {
                    let _ = app.emit("shortcut-new-tab", ());
                }
                "open-video" => {
                    let _ = app.emit("shortcut-open-video", ());
                }
                "open-project" => {
                    let _ = app.emit("shortcut-open-project", ());
                }
                "save-project" => {
                    let _ = app.emit("shortcut-save-project", ());
                }
                "save-project-as" => {
                    let _ = app.emit("shortcut-save-project-as", ());
                }
                "undo" => {
                    let _ = app.emit("shortcut-undo", ());
                }
                "redo" => {
                    let _ = app.emit("shortcut-redo", ());
                }
                "prev-tab" => {
                    let _ = app.emit("shortcut-step-tab", -1i32);
                }
                "next-tab" => {
                    let _ = app.emit("shortcut-step-tab", 1i32);
                }
                _ => {
                    if let Some(num_str) = id.strip_prefix("select-tab-") {
                        if let Ok(num) = num_str.parse::<usize>() {
                            if (1..=9).contains(&num) {
                                let _ = app.emit("shortcut-select-tab", num - 1);
                            }
                        }
                    }
                }
            }
        })
        .on_window_event(move |_window, event| match event {
            tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                player_for_close.shutdown();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while building HDRCut")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                player_for_exit.shutdown();
            }
        });
}
