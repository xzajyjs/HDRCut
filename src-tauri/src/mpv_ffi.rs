#![allow(non_camel_case_types, dead_code)]

use libloading::Library;
use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::Arc;

use crate::bins::find_libmpv_candidates;

pub const MPV_FORMAT_NONE: c_int = 0;
pub const MPV_FORMAT_STRING: c_int = 1;
pub const MPV_FORMAT_OSD_STRING: c_int = 2;
pub const MPV_FORMAT_FLAG: c_int = 3;
pub const MPV_FORMAT_INT64: c_int = 4;
pub const MPV_FORMAT_DOUBLE: c_int = 5;

pub const MPV_EVENT_NONE: c_int = 0;
pub const MPV_EVENT_SHUTDOWN: c_int = 1;
pub const MPV_EVENT_END_FILE: c_int = 7;
pub const MPV_EVENT_FILE_LOADED: c_int = 8;
pub const MPV_EVENT_SEEK: c_int = 20;
pub const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

// Render API constants (mpv/render.h & mpv/render_gl.h)
pub const MPV_RENDER_PARAM_INVALID: c_int = 0;
pub const MPV_RENDER_PARAM_API_TYPE: c_int = 1;
pub const MPV_RENDER_PARAM_OPENGL_INIT_PARAMS: c_int = 2;
pub const MPV_RENDER_PARAM_OPENGL_FBO: c_int = 3;
pub const MPV_RENDER_PARAM_FLIP_Y: c_int = 4;
pub const MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME: c_int = 12;

pub const MPV_RENDER_UPDATE_FRAME: u64 = 1 << 0;

#[repr(C)]
pub struct MpvEvent {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventProperty {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvRenderParam {
    pub param_type: c_int,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvOpenGLInitParams {
    pub get_proc_address:
        Option<unsafe extern "C" fn(ctx: *mut c_void, name: *const c_char) -> *mut c_void>,
    pub get_proc_address_ctx: *mut c_void,
}

#[repr(C)]
pub struct MpvOpenGLFbo {
    pub fbo: c_int,
    pub w: c_int,
    pub h: c_int,
    pub internal_format: c_int,
}

pub type MpvHandle = *mut c_void;
pub type MpvRenderContext = *mut c_void;
pub type MpvRenderUpdateFn = unsafe extern "C" fn(cb_ctx: *mut c_void);

type FnMpvCreate = unsafe extern "C" fn() -> MpvHandle;
type FnMpvInitialize = unsafe extern "C" fn(ctx: MpvHandle) -> c_int;
type FnMpvTerminateDestroy = unsafe extern "C" fn(ctx: MpvHandle);
type FnMpvSetOption = unsafe extern "C" fn(
    ctx: MpvHandle,
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
) -> c_int;
type FnMpvSetOptionString =
    unsafe extern "C" fn(ctx: MpvHandle, name: *const c_char, data: *const c_char) -> c_int;
type FnMpvSetProperty = unsafe extern "C" fn(
    ctx: MpvHandle,
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
) -> c_int;
type FnMpvSetPropertyString =
    unsafe extern "C" fn(ctx: MpvHandle, name: *const c_char, data: *const c_char) -> c_int;
type FnMpvGetProperty = unsafe extern "C" fn(
    ctx: MpvHandle,
    name: *const c_char,
    format: c_int,
    data: *mut c_void,
) -> c_int;
type FnMpvGetPropertyString =
    unsafe extern "C" fn(ctx: MpvHandle, name: *const c_char) -> *mut c_char;
type FnMpvCommand =
    unsafe extern "C" fn(ctx: MpvHandle, args: *const *const c_char) -> c_int;
type FnMpvCommandAsync =
    unsafe extern "C" fn(ctx: MpvHandle, reply_userdata: u64, args: *const *const c_char) -> c_int;
type FnMpvObserveProperty = unsafe extern "C" fn(
    ctx: MpvHandle,
    reply_userdata: u64,
    name: *const c_char,
    format: c_int,
) -> c_int;
type FnMpvWaitEvent = unsafe extern "C" fn(ctx: MpvHandle, timeout: c_double) -> *mut MpvEvent;
type FnMpvWakeup = unsafe extern "C" fn(ctx: MpvHandle);
type FnMpvFree = unsafe extern "C" fn(data: *mut c_void);
type FnMpvErrorString = unsafe extern "C" fn(error: c_int) -> *const c_char;

// Render API function pointer types
type FnMpvRenderContextCreate = unsafe extern "C" fn(
    res: *mut MpvRenderContext,
    mpv: MpvHandle,
    params: *mut MpvRenderParam,
) -> c_int;
type FnMpvRenderContextSetUpdateCallback = unsafe extern "C" fn(
    ctx: MpvRenderContext,
    callback: Option<MpvRenderUpdateFn>,
    callback_ctx: *mut c_void,
);
type FnMpvRenderContextUpdate = unsafe extern "C" fn(ctx: MpvRenderContext) -> u64;
type FnMpvRenderContextRender =
    unsafe extern "C" fn(ctx: MpvRenderContext, params: *mut MpvRenderParam) -> c_int;
type FnMpvRenderContextReportSwap = unsafe extern "C" fn(ctx: MpvRenderContext);
type FnMpvRenderContextFree = unsafe extern "C" fn(ctx: MpvRenderContext);

/// Dynamically loaded libmpv function table — zero compile-time C library dependencies,
/// enabling clean cross-compilation from macOS to Windows!
pub struct LibMpv {
    _lib: Library,
    pub loaded_path: PathBuf,
    pub create: FnMpvCreate,
    pub initialize: FnMpvInitialize,
    pub terminate_destroy: FnMpvTerminateDestroy,
    pub set_option: FnMpvSetOption,
    pub set_option_string: FnMpvSetOptionString,
    pub set_property: FnMpvSetProperty,
    pub set_property_string: FnMpvSetPropertyString,
    pub get_property: FnMpvGetProperty,
    pub get_property_string: FnMpvGetPropertyString,
    pub command: FnMpvCommand,
    pub command_async: FnMpvCommandAsync,
    pub observe_property: FnMpvObserveProperty,
    pub wait_event: FnMpvWaitEvent,
    pub wakeup: FnMpvWakeup,
    pub free: FnMpvFree,
    pub error_string: FnMpvErrorString,
    pub render_context_create: FnMpvRenderContextCreate,
    pub render_context_set_update_callback: FnMpvRenderContextSetUpdateCallback,
    pub render_context_update: FnMpvRenderContextUpdate,
    pub render_context_render: FnMpvRenderContextRender,
    pub render_context_report_swap: FnMpvRenderContextReportSwap,
    pub render_context_free: FnMpvRenderContextFree,
}

unsafe impl Send for LibMpv {}
unsafe impl Sync for LibMpv {}

impl LibMpv {
    pub fn load() -> Result<Arc<Self>, String> {
        let candidates = find_libmpv_candidates();
        let mut last_err = String::new();

        for path in candidates {
            let load_res = unsafe { Library::new(&path) };
            match load_res {
                Ok(lib) => {
                    unsafe {
                        let create = *lib
                            .get::<FnMpvCreate>(b"mpv_create\0")
                            .map_err(|e| e.to_string())?;
                        let initialize = *lib
                            .get::<FnMpvInitialize>(b"mpv_initialize\0")
                            .map_err(|e| e.to_string())?;
                        let terminate_destroy = *lib
                            .get::<FnMpvTerminateDestroy>(b"mpv_terminate_destroy\0")
                            .map_err(|e| e.to_string())?;
                        let set_option = *lib
                            .get::<FnMpvSetOption>(b"mpv_set_option\0")
                            .map_err(|e| e.to_string())?;
                        let set_option_string = *lib
                            .get::<FnMpvSetOptionString>(b"mpv_set_option_string\0")
                            .map_err(|e| e.to_string())?;
                        let set_property = *lib
                            .get::<FnMpvSetProperty>(b"mpv_set_property\0")
                            .map_err(|e| e.to_string())?;
                        let set_property_string = *lib
                            .get::<FnMpvSetPropertyString>(b"mpv_set_property_string\0")
                            .map_err(|e| e.to_string())?;
                        let get_property = *lib
                            .get::<FnMpvGetProperty>(b"mpv_get_property\0")
                            .map_err(|e| e.to_string())?;
                        let get_property_string = *lib
                            .get::<FnMpvGetPropertyString>(b"mpv_get_property_string\0")
                            .map_err(|e| e.to_string())?;
                        let command = *lib
                            .get::<FnMpvCommand>(b"mpv_command\0")
                            .map_err(|e| e.to_string())?;
                        let command_async = *lib
                            .get::<FnMpvCommandAsync>(b"mpv_command_async\0")
                            .map_err(|e| e.to_string())?;
                        let observe_property = *lib
                            .get::<FnMpvObserveProperty>(b"mpv_observe_property\0")
                            .map_err(|e| e.to_string())?;
                        let wait_event = *lib
                            .get::<FnMpvWaitEvent>(b"mpv_wait_event\0")
                            .map_err(|e| e.to_string())?;
                        let wakeup = *lib
                            .get::<FnMpvWakeup>(b"mpv_wakeup\0")
                            .map_err(|e| e.to_string())?;
                        let free = *lib
                            .get::<FnMpvFree>(b"mpv_free\0")
                            .map_err(|e| e.to_string())?;
                        let error_string = *lib
                            .get::<FnMpvErrorString>(b"mpv_error_string\0")
                            .map_err(|e| e.to_string())?;
                        let render_context_create = *lib
                            .get::<FnMpvRenderContextCreate>(b"mpv_render_context_create\0")
                            .map_err(|e| e.to_string())?;
                        let render_context_set_update_callback = *lib
                            .get::<FnMpvRenderContextSetUpdateCallback>(
                                b"mpv_render_context_set_update_callback\0",
                            )
                            .map_err(|e| e.to_string())?;
                        let render_context_update = *lib
                            .get::<FnMpvRenderContextUpdate>(b"mpv_render_context_update\0")
                            .map_err(|e| e.to_string())?;
                        let render_context_render = *lib
                            .get::<FnMpvRenderContextRender>(b"mpv_render_context_render\0")
                            .map_err(|e| e.to_string())?;
                        let render_context_report_swap = *lib
                            .get::<FnMpvRenderContextReportSwap>(
                                b"mpv_render_context_report_swap\0",
                            )
                            .map_err(|e| e.to_string())?;
                        let render_context_free = *lib
                            .get::<FnMpvRenderContextFree>(b"mpv_render_context_free\0")
                            .map_err(|e| e.to_string())?;

                        return Ok(Arc::new(Self {
                            _lib: lib,
                            loaded_path: path,
                            create,
                            initialize,
                            terminate_destroy,
                            set_option,
                            set_option_string,
                            set_property,
                            set_property_string,
                            get_property,
                            get_property_string,
                            command,
                            command_async,
                            observe_property,
                            wait_event,
                            wakeup,
                            free,
                            error_string,
                            render_context_create,
                            render_context_set_update_callback,
                            render_context_update,
                            render_context_render,
                            render_context_report_swap,
                            render_context_free,
                        }));
                    }
                }
                Err(e) => {
                    last_err = format!("{}: {e}", path.display());
                }
            }
        }

        Err(format!(
            "无法加载 libmpv 动态库 (请确认已安装 mpv 或打包 libmpv)。最后错误: {last_err}"
        ))
    }

    pub fn err_to_string(&self, code: c_int) -> String {
        unsafe {
            let ptr = (self.error_string)(code);
            if ptr.is_null() {
                format!("mpv error {code}")
            } else {
                CStr::from_ptr(ptr).to_string_lossy().to_string()
            }
        }
    }

    pub fn set_option_str(&self, ctx: MpvHandle, name: &str, val: &str) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let c_val = CString::new(val).map_err(|e| e.to_string())?;
        let rc = unsafe { (self.set_option_string)(ctx, c_name.as_ptr(), c_val.as_ptr()) };
        if rc < 0 {
            Err(format!(
                "mpv_set_option_string({name}={val}) failed: {}",
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn set_option_i64(&self, ctx: MpvHandle, name: &str, mut val: i64) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let rc = unsafe {
            (self.set_option)(
                ctx,
                c_name.as_ptr(),
                MPV_FORMAT_INT64,
                (&mut val as *mut i64).cast::<c_void>(),
            )
        };
        if rc < 0 {
            Err(format!(
                "mpv_set_option({name}={val}) failed: {}",
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn set_prop_str(&self, ctx: MpvHandle, name: &str, val: &str) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let c_val = CString::new(val).map_err(|e| e.to_string())?;
        let rc = unsafe { (self.set_property_string)(ctx, c_name.as_ptr(), c_val.as_ptr()) };
        if rc < 0 {
            Err(format!(
                "mpv_set_property_string({name}={val}) failed: {}",
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn set_prop_flag(&self, ctx: MpvHandle, name: &str, val: bool) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let mut flag: c_int = if val { 1 } else { 0 };
        let rc = unsafe {
            (self.set_property)(
                ctx,
                c_name.as_ptr(),
                MPV_FORMAT_FLAG,
                (&mut flag as *mut c_int).cast::<c_void>(),
            )
        };
        if rc < 0 {
            Err(format!(
                "mpv_set_property({name}) failed: {}",
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn set_prop_f64(&self, ctx: MpvHandle, name: &str, mut val: f64) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let rc = unsafe {
            (self.set_property)(
                ctx,
                c_name.as_ptr(),
                MPV_FORMAT_DOUBLE,
                (&mut val as *mut f64).cast::<c_void>(),
            )
        };
        if rc < 0 {
            Err(format!(
                "mpv_set_property({name}) failed: {}",
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn set_prop_i64(&self, ctx: MpvHandle, name: &str, mut val: i64) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let rc = unsafe {
            (self.set_property)(
                ctx,
                c_name.as_ptr(),
                MPV_FORMAT_INT64,
                (&mut val as *mut i64).cast::<c_void>(),
            )
        };
        if rc < 0 {
            Err(format!(
                "mpv_set_property({name}) failed: {}",
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn get_prop_flag(&self, ctx: MpvHandle, name: &str) -> Option<bool> {
        let c_name = CString::new(name).ok()?;
        let mut val: c_int = 0;
        let rc = unsafe {
            (self.get_property)(
                ctx,
                c_name.as_ptr(),
                MPV_FORMAT_FLAG,
                (&mut val as *mut c_int).cast::<c_void>(),
            )
        };
        if rc >= 0 { Some(val != 0) } else { None }
    }

    pub fn run_command(&self, ctx: MpvHandle, args: &[&str]) -> Result<(), String> {
        let c_args: Vec<CString> = args
            .iter()
            .map(|a| CString::new(*a).map_err(|e| e.to_string()))
            .collect::<Result<_, _>>()?;
        let mut ptrs: Vec<*const c_char> = c_args.iter().map(|s| s.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let rc = unsafe { (self.command)(ctx, ptrs.as_ptr()) };
        if rc < 0 {
            Err(format!(
                "mpv_command({:?}) failed: {}",
                args,
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn run_command_async(&self, ctx: MpvHandle, args: &[&str]) -> Result<(), String> {
        let c_args: Vec<CString> = args
            .iter()
            .map(|a| CString::new(*a).map_err(|e| e.to_string()))
            .collect::<Result<_, _>>()?;
        let mut ptrs: Vec<*const c_char> = c_args.iter().map(|s| s.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let rc = unsafe { (self.command_async)(ctx, 0, ptrs.as_ptr()) };
        if rc < 0 {
            Err(format!(
                "mpv_command_async({:?}) failed: {}",
                args,
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }

    pub fn observe(&self, ctx: MpvHandle, id: u64, name: &str, format: c_int) -> Result<(), String> {
        let c_name = CString::new(name).map_err(|e| e.to_string())?;
        let rc = unsafe { (self.observe_property)(ctx, id, c_name.as_ptr(), format) };
        if rc < 0 {
            Err(format!(
                "mpv_observe_property({name}) failed: {}",
                self.err_to_string(rc)
            ))
        } else {
            Ok(())
        }
    }
}
