use parking_lot::Mutex;
use serde::Serialize;
use std::ffi::{c_int, CStr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, WebviewWindow};

use crate::mpv_ffi::{
    LibMpv, MpvEventProperty, MpvHandle, MPV_EVENT_END_FILE, MPV_EVENT_FILE_LOADED,
    MPV_EVENT_NONE, MPV_EVENT_PROPERTY_CHANGE, MPV_EVENT_SHUTDOWN, MPV_FORMAT_DOUBLE,
    MPV_FORMAT_FLAG, MPV_FORMAT_INT64,
};

#[cfg(target_os = "macos")]
use crate::mpv_mac_gl::MacEmbeddedRenderer;
#[cfg(not(target_os = "macos"))]
use crate::mpv_view::NativeVideoView;

#[derive(Serialize, Clone, Debug)]
pub struct PlayerStateEvent {
    pub time_pos: f64,
    pub duration: f64,
    pub paused: bool,
    pub volume: f64,
    pub speed: f64,
    pub aid: i64,
    pub sid: i64,
    pub eof_reached: bool,
    pub hdr_passthrough: bool,
}

struct MpvCore {
    lib: Arc<LibMpv>,
    handle: MpvHandle,
    #[cfg(target_os = "macos")]
    mac_renderer: Arc<MacEmbeddedRenderer>,
    #[cfg(not(target_os = "macos"))]
    view: Arc<NativeVideoView>,
    shutdown: Arc<AtomicBool>,
    current_hdr_kind: Mutex<Option<String>>,
}

unsafe impl Send for MpvCore {}
unsafe impl Sync for MpvCore {}

pub struct MpvPlayer {
    core: Mutex<Option<MpvCore>>,
    last_state: Arc<Mutex<PlayerStateEvent>>,
}

impl Default for MpvPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl MpvPlayer {
    pub fn new() -> Self {
        Self {
            core: Mutex::new(None),
            last_state: Arc::new(Mutex::new(PlayerStateEvent {
                time_pos: 0.0,
                duration: 0.0,
                paused: true,
                volume: 100.0,
                speed: 1.0,
                aid: 1,
                sid: 1,
                eof_reached: false,
                hdr_passthrough: true,
            })),
        }
    }

    /// Initializes libmpv and embeds its video surface inside the app window.
    /// MUST be called from an async/worker thread (never synchronously on the main UI thread!).
    pub fn ensure_initialized(
        &self,
        app: &AppHandle,
        window: &WebviewWindow,
    ) -> Result<String, String> {
        {
            let guard = self.core.lock();
            if let Some(c) = guard.as_ref() {
                return Ok(c.lib.loaded_path.to_string_lossy().to_string());
            }
        }

        let lib = LibMpv::load()?;
        let loaded_path = lib.loaded_path.to_string_lossy().to_string();

        #[cfg(target_os = "macos")]
        let (handle, mac_renderer) = {
            // macOS: Use vo=libmpv + embedded CAOpenGLLayer (64-bit float EDR HDR + VideoToolbox)
            // NEVER spawns a separate mpv window and NEVER deadlocks AppKit!
            let handle = init_mpv_instance_macos(&lib)?;
            let renderer = match MacEmbeddedRenderer::create(window, lib.clone(), handle) {
                Ok(r) => Arc::new(r),
                Err(e) => {
                    unsafe { (lib.terminate_destroy)(handle) };
                    return Err(e);
                }
            };
            (handle, renderer)
        };

        #[cfg(not(target_os = "macos"))]
        let (handle, view) = {
            // Windows: Native child HWND embedded via libmpv `wid` + vo=gpu-next + Direct3D 11 HDR
            let (tx, rx) = std::sync::mpsc::channel::<Result<NativeVideoView, String>>();
            let win_clone = window.clone();
            window
                .run_on_main_thread(move || {
                    let res = NativeVideoView::create(&win_clone);
                    let _ = tx.send(res);
                })
                .map_err(|e| format!("无法调度主线程创建视频视图: {e}"))?;

            let view = Arc::new(
                rx.recv()
                    .map_err(|_| "主线程创建视频视图通道断开".to_string())??,
            );
            let handle = init_mpv_instance_wid(&lib, view.wid)?;
            (handle, view)
        };

        // Observe properties for real-time UI sync
        let _ = lib.observe(handle, 1, "time-pos", MPV_FORMAT_DOUBLE);
        let _ = lib.observe(handle, 2, "duration", MPV_FORMAT_DOUBLE);
        let _ = lib.observe(handle, 3, "pause", MPV_FORMAT_FLAG);
        let _ = lib.observe(handle, 4, "volume", MPV_FORMAT_DOUBLE);
        let _ = lib.observe(handle, 5, "speed", MPV_FORMAT_DOUBLE);
        let _ = lib.observe(handle, 6, "aid", MPV_FORMAT_INT64);
        let _ = lib.observe(handle, 7, "eof-reached", MPV_FORMAT_FLAG);
        let _ = lib.observe(handle, 8, "sid", MPV_FORMAT_INT64);

        let shutdown = Arc::new(AtomicBool::new(false));
        spawn_event_loop(
            app.clone(),
            lib.clone(),
            handle as usize,
            shutdown.clone(),
            self.last_state.clone(),
        );

        let mut guard = self.core.lock();
        *guard = Some(MpvCore {
            lib,
            handle,
            #[cfg(target_os = "macos")]
            mac_renderer,
            #[cfg(not(target_os = "macos"))]
            view,
            shutdown,
            current_hdr_kind: Mutex::new(None),
        });

        Ok(loaded_path)
    }

    pub fn set_bounds(
        &self,
        window: &WebviewWindow,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        viewport_height: f64,
        scale_factor: f64,
        visible: bool,
    ) {
        #[cfg(target_os = "macos")]
        {
            let renderer = {
                let guard = self.core.lock();
                guard.as_ref().map(|c| c.mac_renderer.clone())
            };
            if let Some(r) = renderer {
                r.set_bounds(
                    window,
                    x,
                    y,
                    width,
                    height,
                    viewport_height,
                    scale_factor,
                    visible,
                );
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = viewport_height;
            let view = {
                let guard = self.core.lock();
                guard.as_ref().map(|c| c.view.clone())
            };
            if let Some(v) = view {
                let _ = window.run_on_main_thread(move || {
                    v.set_bounds(x, y, width, height, scale_factor, visible);
                });
            }
        }
    }

    pub fn load_file(
        &self,
        window: &WebviewWindow,
        path: &str,
        hdr_format: Option<&str>,
        start_time: Option<f64>,
        start_paused: Option<bool>,
    ) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;

        *core.current_hdr_kind.lock() = hdr_format.map(|s| s.to_string());
        let hdr_on = self.last_state.lock().hdr_passthrough;

        #[cfg(target_os = "macos")]
        {
            apply_macos_hdr_profile(&core.lib, core.handle, &core.mac_renderer, window, hdr_format, hdr_on);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = window;
            let _ = hdr_on;
        }

        // Reset or set exact start position for seamless tab restoration
        let start_val = match start_time {
            Some(t) if t > 0.05 => format!("{t:.3}"),
            _ => "none".to_string(),
        };
        let _ = core.lib.set_prop_str(core.handle, "start", &start_val);
        let _ = core.lib.set_prop_f64(core.handle, "sub-delay", 0.0);
        let _ = core
            .lib
            .set_prop_flag(core.handle, "pause", start_paused.unwrap_or(false));

        core.lib
            .run_command_async(core.handle, &["loadfile", path, "replace"])?;
        Ok(())
    }

    pub fn stop_and_hide(&self, window: &WebviewWindow) -> Result<(), String> {
        let guard = self.core.lock();
        if let Some(core) = guard.as_ref() {
            let _ = core.lib.run_command_async(core.handle, &["stop"]);
            *core.current_hdr_kind.lock() = None;
            #[cfg(target_os = "macos")]
            {
                core.mac_renderer
                    .set_bounds(window, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, false);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let v = core.view.clone();
                let _ = window.run_on_main_thread(move || {
                    v.set_bounds(0.0, 0.0, 0.0, 0.0, 1.0, false);
                });
            }
        }
        let mut st = self.last_state.lock();
        st.time_pos = 0.0;
        st.duration = 0.0;
        st.paused = true;
        st.eof_reached = false;
        Ok(())
    }

    pub fn toggle_pause(&self) -> Result<bool, String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        let paused = core.lib.get_prop_flag(core.handle, "pause").unwrap_or(false);
        let next = !paused;
        if !next && core.lib.get_prop_flag(core.handle, "eof-reached").unwrap_or(false) {
            let _ = core.lib.run_command_async(core.handle, &["seek", "0", "absolute"]);
        }
        core.lib.set_prop_flag(core.handle, "pause", next)?;
        Ok(next)
    }

    pub fn set_pause(&self, paused: bool) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        core.lib.set_prop_flag(core.handle, "pause", paused)
    }

    pub fn seek_absolute(&self, seconds: f64, exact: bool) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        let t = format!("{:.3}", seconds.max(0.0));
        let mode = if exact {
            "absolute+exact"
        } else {
            "absolute+keyframes"
        };
        core.lib.run_command_async(core.handle, &["seek", &t, mode])
    }

    pub fn seek_relative(&self, delta: f64) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        let d = format!("{:.3}", delta);
        core.lib.run_command_async(core.handle, &["seek", &d, "relative"])
    }

    pub fn frame_step(&self, forward: bool) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        let cmd = if forward { "frame-step" } else { "frame-back-step" };
        core.lib.run_command_async(core.handle, &[cmd])
    }

    pub fn set_audio_track(&self, aid: i64) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        if aid <= 0 {
            core.lib.set_prop_str(core.handle, "aid", "no")
        } else {
            core.lib.set_prop_i64(core.handle, "aid", aid)
        }
    }

    pub fn set_subtitle_track(&self, sid: i64) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        let res = if sid <= 0 {
            core.lib.set_prop_str(core.handle, "sid", "no")
        } else {
            core.lib.set_prop_i64(core.handle, "sid", sid)
        };
        if res.is_ok() {
            self.last_state.lock().sid = sid.max(0);
        }
        res
    }

    pub fn add_subtitle_file(&self, path: &str) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        core.lib
            .run_command_async(core.handle, &["sub-add", path, "select"])
    }

    pub fn set_sub_delay(&self, seconds: f64) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        core.lib.set_prop_f64(core.handle, "sub-delay", seconds)
    }

    pub fn add_audio_file(&self, path: &str) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        core.lib
            .run_command_async(core.handle, &["audio-add", path, "select"])
    }

    pub fn set_volume(&self, volume: f64) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        core.lib.set_prop_f64(core.handle, "volume", volume.clamp(0.0, 150.0))
    }

    pub fn set_speed(&self, speed: f64) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        core.lib.set_prop_f64(core.handle, "speed", speed.clamp(0.25, 4.0))
    }

    pub fn set_hdr_passthrough(&self, window: &WebviewWindow, enabled: bool) -> Result<(), String> {
        let guard = self.core.lock();
        let core = guard.as_ref().ok_or("播放器尚未初始化")?;
        self.last_state.lock().hdr_passthrough = enabled;

        #[cfg(target_os = "macos")]
        {
            let kind = core.current_hdr_kind.lock().clone();
            apply_macos_hdr_profile(
                &core.lib,
                core.handle,
                &core.mac_renderer,
                window,
                kind.as_deref(),
                enabled,
            );
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = window;
            let val = if enabled { "yes" } else { "no" };
            core.lib.set_prop_str(core.handle, "target-colorspace-hint", val)?;
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let core = self.core.lock().take();
        if let Some(c) = core {
            c.shutdown.store(true, Ordering::SeqCst);
            // Tear down render context first so mpv releases video output cleanly without blocking!
            #[cfg(target_os = "macos")]
            {
                c.mac_renderer.shutdown();
            }
            #[cfg(not(target_os = "macos"))]
            {
                c.view.destroy();
            }
            let lib = c.lib;
            let handle_addr = c.handle as usize;
            std::thread::spawn(move || unsafe {
                let h = handle_addr as MpvHandle;
                (lib.wakeup)(h);
                (lib.terminate_destroy)(h);
            });
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_macos_hdr_profile(
    lib: &LibMpv,
    handle: MpvHandle,
    renderer: &MacEmbeddedRenderer,
    window: &WebviewWindow,
    hdr_format: Option<&str>,
    passthrough: bool,
) {
    if passthrough {
        if let Some(kind) = hdr_format {
            let low = kind.to_lowercase();
            let _ = lib.set_prop_str(handle, "target-prim", "bt.2020");
            if low.contains("hlg") {
                let _ = lib.set_prop_str(handle, "target-trc", "hlg");
            } else {
                let _ = lib.set_prop_str(handle, "target-trc", "pq");
            }
            renderer.set_hdr_mode(window, Some(kind), true);
            return;
        }
    }
    // SDR video or user selected SDR tone-mapping preview
    let _ = lib.set_prop_str(handle, "target-prim", "display-p3");
    let _ = lib.set_prop_str(handle, "target-trc", "auto");
    let _ = lib.set_prop_str(handle, "tone-mapping", "spline");
    renderer.set_hdr_mode(window, None, false);
}

#[cfg(target_os = "macos")]
fn init_mpv_instance_macos(lib: &LibMpv) -> Result<MpvHandle, String> {
    let handle = unsafe { (lib.create)() };
    if handle.is_null() {
        return Err("mpv_create() 返回空指针".to_string());
    }

    // Embedded libmpv Render API — renders directly inside our CAOpenGLLayer!
    lib.set_option_str(handle, "vo", "libmpv")?;
    let _ = lib.set_option_str(handle, "hwdec", "videotoolbox");
    let _ = lib.set_option_str(handle, "video-timing-offset", "0");
    let _ = lib.set_option_str(handle, "idle", "yes");
    let _ = lib.set_option_str(handle, "keep-open", "yes");
    let _ = lib.set_option_str(handle, "osc", "no");
    let _ = lib.set_option_str(handle, "osd-level", "0");
    let _ = lib.set_option_str(handle, "input-default-bindings", "no");
    let _ = lib.set_option_str(handle, "input-vo-keyboard", "no");
    let _ = lib.set_option_str(handle, "audio-display", "no");
    let _ = lib.set_option_str(handle, "video-sync", "audio");
    let _ = lib.set_option_str(handle, "tone-mapping", "spline");
    let _ = lib.set_option_str(handle, "hdr-compute-peak", "yes");

    // 100GB large-file ultra-smooth scrubbing optimizations
    let _ = lib.set_option_str(handle, "hr-seek", "yes");
    let _ = lib.set_option_str(handle, "hr-seek-framedrop", "yes");
    let _ = lib.set_option_str(handle, "cache", "yes");
    let _ = lib.set_option_str(handle, "demuxer-max-bytes", "256MiB");
    let _ = lib.set_option_str(handle, "demuxer-max-back-bytes", "128MiB");
    let _ = lib.set_option_str(handle, "demuxer-readahead-secs", "10");

    let rc = unsafe { (lib.initialize)(handle) };
    if rc < 0 {
        unsafe { (lib.terminate_destroy)(handle) };
        return Err(format!("mpv_initialize 失败: {}", lib.err_to_string(rc)));
    }

    Ok(handle)
}

#[cfg(not(target_os = "macos"))]
fn init_mpv_instance_wid(lib: &LibMpv, wid: i64) -> Result<MpvHandle, String> {
    let handle = unsafe { (lib.create)() };
    if handle.is_null() {
        return Err("mpv_create() 返回空指针".to_string());
    }

    lib.set_option_i64(handle, "wid", wid)?;
    let _ = lib.set_option_str(handle, "idle", "yes");
    let _ = lib.set_option_str(handle, "keep-open", "yes");
    let _ = lib.set_option_str(handle, "osc", "no");
    let _ = lib.set_option_str(handle, "osd-level", "0");
    let _ = lib.set_option_str(handle, "input-default-bindings", "no");
    let _ = lib.set_option_str(handle, "input-vo-keyboard", "no");
    let _ = lib.set_option_str(handle, "cursor-autohide", "no");
    let _ = lib.set_option_str(handle, "audio-display", "no");
    let _ = lib.set_option_str(handle, "video-sync", "audio");

    let _ = lib.set_option_str(handle, "vo", "gpu-next");
    let _ = lib.set_option_str(handle, "gpu-api", "d3d11");
    let _ = lib.set_option_str(handle, "hwdec", "auto-safe");
    let _ = lib.set_option_str(handle, "target-colorspace-hint", "yes");
    let _ = lib.set_option_str(handle, "tone-mapping", "spline");
    let _ = lib.set_option_str(handle, "hdr-compute-peak", "yes");

    let _ = lib.set_option_str(handle, "hr-seek", "yes");
    let _ = lib.set_option_str(handle, "hr-seek-framedrop", "yes");
    let _ = lib.set_option_str(handle, "cache", "yes");
    let _ = lib.set_option_str(handle, "demuxer-max-bytes", "256MiB");
    let _ = lib.set_option_str(handle, "demuxer-max-back-bytes", "128MiB");
    let _ = lib.set_option_str(handle, "demuxer-readahead-secs", "10");

    let rc = unsafe { (lib.initialize)(handle) };
    if rc < 0 {
        unsafe { (lib.terminate_destroy)(handle) };
        return Err(format!("mpv_initialize 失败: {}", lib.err_to_string(rc)));
    }

    Ok(handle)
}

fn spawn_event_loop(
    app: AppHandle,
    lib: Arc<LibMpv>,
    handle_addr: usize,
    shutdown: Arc<AtomicBool>,
    state: Arc<Mutex<PlayerStateEvent>>,
) {
    std::thread::spawn(move || {
        let handle = handle_addr as MpvHandle;
        let mut last_emit = Instant::now() - Duration::from_secs(1);
        let mut dirty = false;

        while !shutdown.load(Ordering::Relaxed) {
            let ev_ptr = unsafe { (lib.wait_event)(handle, 0.05) };
            if ev_ptr.is_null() {
                continue;
            }
            let ev = unsafe { &*ev_ptr };
            match ev.event_id {
                MPV_EVENT_SHUTDOWN => break,
                MPV_EVENT_NONE => {
                    if dirty && last_emit.elapsed() >= Duration::from_millis(33) {
                        let snap = state.lock().clone();
                        let _ = app.emit("mpv-state", snap);
                        last_emit = Instant::now();
                        dirty = false;
                    }
                }
                MPV_EVENT_FILE_LOADED => {
                    let _ = app.emit("mpv-file-loaded", ());
                    dirty = true;
                }
                MPV_EVENT_END_FILE => {
                    dirty = true;
                }
                MPV_EVENT_PROPERTY_CHANGE => {
                    if !ev.data.is_null() {
                        let prop = unsafe { &*(ev.data as *const MpvEventProperty) };
                        if !prop.name.is_null() && !prop.data.is_null() {
                            let name = unsafe { CStr::from_ptr(prop.name).to_string_lossy() };
                            let mut st = state.lock();
                            let mut immediate = false;
                            match (name.as_ref(), prop.format) {
                                ("time-pos", MPV_FORMAT_DOUBLE) => {
                                    st.time_pos = unsafe { *(prop.data as *const f64) };
                                    dirty = true;
                                }
                                ("duration", MPV_FORMAT_DOUBLE) => {
                                    st.duration = unsafe { *(prop.data as *const f64) };
                                    immediate = true;
                                }
                                ("pause", MPV_FORMAT_FLAG) => {
                                    st.paused = unsafe { *(prop.data as *const c_int) } != 0;
                                    immediate = true;
                                }
                                ("volume", MPV_FORMAT_DOUBLE) => {
                                    st.volume = unsafe { *(prop.data as *const f64) };
                                    immediate = true;
                                }
                                ("speed", MPV_FORMAT_DOUBLE) => {
                                    st.speed = unsafe { *(prop.data as *const f64) };
                                    immediate = true;
                                }
                                ("aid", MPV_FORMAT_INT64) => {
                                    st.aid = unsafe { *(prop.data as *const i64) };
                                    immediate = true;
                                }
                                ("sid", MPV_FORMAT_INT64) => {
                                    st.sid = unsafe { *(prop.data as *const i64) };
                                    immediate = true;
                                }
                                ("sid", _) => {
                                    // When sid is "no", mpv emits MPV_FORMAT_NONE
                                    st.sid = 0;
                                    immediate = true;
                                }
                                ("eof-reached", MPV_FORMAT_FLAG) => {
                                    st.eof_reached = unsafe { *(prop.data as *const c_int) } != 0;
                                    immediate = true;
                                }
                                _ => {}
                            }
                            if immediate || (dirty && last_emit.elapsed() >= Duration::from_millis(33))
                            {
                                let snap = st.clone();
                                drop(st);
                                let _ = app.emit("mpv-state", snap);
                                last_emit = Instant::now();
                                dirty = false;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });
}
