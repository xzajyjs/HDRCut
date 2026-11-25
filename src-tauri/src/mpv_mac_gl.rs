#![cfg(target_os = "macos")]

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use parking_lot::Mutex;
use std::ffi::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::WebviewWindow;

use crate::mpv_ffi::{
    LibMpv, MpvHandle, MpvOpenGLFbo, MpvOpenGLInitParams, MpvRenderContext, MpvRenderParam,
    MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, MPV_RENDER_PARAM_FLIP_Y,
    MPV_RENDER_PARAM_INVALID, MPV_RENDER_PARAM_OPENGL_FBO, MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
    MPV_RENDER_UPDATE_FRAME,
};

// CGL / OpenGL constants
const K_CGL_PFA_DOUBLE_BUFFER: u32 = 5;
const K_CGL_PFA_COLOR_SIZE: u32 = 8;
const K_CGL_PFA_COLOR_FLOAT: u32 = 58;
const K_CGL_PFA_ACCELERATED: u32 = 73;
const K_CGL_PFA_ALLOW_OFFLINE_RENDERERS: u32 = 96;
const K_CGL_PFA_OPENGL_PROFILE: u32 = 99;
const K_CGL_OGLP_VERSION_3_2_CORE: u32 = 0x3200;

const GL_FRAMEBUFFER_BINDING: u32 = 0x8CA6;
const GL_VIEWPORT: u32 = 0x0BA2;
const GL_RGBA16F: c_int = 0x881A;
const GL_RGBA8: c_int = 0x8058;

#[link(name = "OpenGL", kind = "framework")]
extern "C" {
    fn CGLChoosePixelFormat(
        attribs: *const u32,
        pix: *mut *mut c_void,
        npix: *mut i32,
    ) -> i32;
    fn CGLCreateContext(
        pix: *mut c_void,
        share: *mut c_void,
        ctx: *mut *mut c_void,
    ) -> i32;
    fn CGLRetainPixelFormat(pix: *mut c_void) -> *mut c_void;
    fn CGLReleasePixelFormat(pix: *mut c_void);
    fn CGLRetainContext(ctx: *mut c_void) -> *mut c_void;
    fn CGLReleaseContext(ctx: *mut c_void);
    fn CGLSetCurrentContext(ctx: *mut c_void) -> i32;
    fn CGLLockContext(ctx: *mut c_void) -> i32;
    fn CGLUnlockContext(ctx: *mut c_void) -> i32;
    fn glGetIntegerv(pname: u32, params: *mut i32);
    fn glFlush();
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    static kCGColorSpaceITUR_2100_PQ: *const c_void;
    static kCGColorSpaceITUR_2100_HLG: *const c_void;
    static kCGColorSpaceDisplayP3: *const c_void;
    fn CGColorSpaceCreateWithName(name: *const c_void) -> *mut c_void;
    fn CGColorSpaceRelease(space: *mut c_void);
}

#[link(name = "QuartzCore", kind = "framework")]
extern "C" {}

extern "C" {
    static _dispatch_main_q: c_void;
    fn dispatch_async_f(
        queue: *const c_void,
        context: *mut c_void,
        work: extern "C" fn(*mut c_void),
    );
}

static GL_FRAMEWORK_HANDLE: OnceLock<usize> = OnceLock::new();
static ACTIVE_RENDERER: Mutex<Option<Arc<MacRenderState>>> = Mutex::new(None);
static PASSTHROUGH_VIEW_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
static GL_LAYER_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();

unsafe extern "C" fn get_gl_proc_address(_ctx: *mut c_void, name: *const c_char) -> *mut c_void {
    let handle = *GL_FRAMEWORK_HANDLE.get_or_init(|| {
        let p = c"/System/Library/Frameworks/OpenGL.framework/OpenGL".as_ptr();
        libc::dlopen(p, libc::RTLD_LAZY | libc::RTLD_LOCAL) as usize
    }) as *mut c_void;
    if handle.is_null() {
        return std::ptr::null_mut();
    }
    libc::dlsym(handle, name)
}

pub struct MacRenderState {
    lib: Arc<LibMpv>,
    cgl_pix: usize,
    cgl_ctx: usize,
    is_float_fbo: bool,
    render_ctx: AtomicUsize,
    parent_view: usize,
    webview: usize,
    child_view: usize,
    gl_layer: usize,
    shutting_down: AtomicBool,
    pending_redraw: AtomicBool,
    render_lock: Mutex<()>,
}

unsafe impl Send for MacRenderState {}
unsafe impl Sync for MacRenderState {}

extern "C" fn hit_test_passthrough(
    _this: *mut AnyObject,
    _cmd: Sel,
    _point: NSPoint,
) -> *mut AnyObject {
    std::ptr::null_mut()
}

extern "C" fn layer_copy_pixel_format(
    _this: *mut AnyObject,
    _cmd: Sel,
    _mask: u32,
) -> *mut c_void {
    let guard = ACTIVE_RENDERER.lock();
    if let Some(st) = guard.as_ref() {
        if st.cgl_pix != 0 {
            return unsafe { CGLRetainPixelFormat(st.cgl_pix as *mut c_void) };
        }
    }
    std::ptr::null_mut()
}

extern "C" fn layer_copy_cgl_context(
    _this: *mut AnyObject,
    _cmd: Sel,
    _pf: *mut c_void,
) -> *mut c_void {
    let guard = ACTIVE_RENDERER.lock();
    if let Some(st) = guard.as_ref() {
        if st.cgl_ctx != 0 {
            return unsafe { CGLRetainContext(st.cgl_ctx as *mut c_void) };
        }
    }
    std::ptr::null_mut()
}

extern "C" fn layer_can_draw(
    _this: *mut AnyObject,
    _cmd: Sel,
    _ctx: *mut c_void,
    _pf: *mut c_void,
    _t: f64,
    _ts: *const c_void,
) -> Bool {
    let guard = ACTIVE_RENDERER.lock();
    if let Some(st) = guard.as_ref() {
        if !st.shutting_down.load(Ordering::Acquire) && st.render_ctx.load(Ordering::Acquire) != 0 {
            return Bool::YES;
        }
    }
    Bool::NO
}

extern "C" fn layer_draw(
    this: *mut AnyObject,
    _cmd: Sel,
    cgl_ctx: *mut c_void,
    _pf: *mut c_void,
    _t: f64,
    _ts: *const c_void,
) {
    let st = {
        let guard = ACTIVE_RENDERER.lock();
        guard.clone()
    };
    let Some(st) = st else { return };
    if st.shutting_down.load(Ordering::Acquire) {
        return;
    }
    let Some(_rlock) = st.render_lock.try_lock() else {
        return;
    };
    let rctx = st.render_ctx.load(Ordering::Acquire) as MpvRenderContext;
    if rctx.is_null() || cgl_ctx.is_null() {
        return;
    }

    unsafe {
        CGLLockContext(cgl_ctx);
        CGLSetCurrentContext(cgl_ctx);

        let mut fbo: i32 = 0;
        glGetIntegerv(GL_FRAMEBUFFER_BINDING, &mut fbo);

        let bounds: NSRect = msg_send![this, bounds];
        let scale: f64 = msg_send![this, contentsScale];
        let s = if scale > 0.0 { scale } else { 1.0 };
        let bw = (bounds.size.width * s).round() as i32;
        let bh = (bounds.size.height * s).round() as i32;

        let (w, h) = if bw > 1 && bh > 1 {
            (bw, bh)
        } else {
            let mut vp: [i32; 4] = [0; 4];
            glGetIntegerv(GL_VIEWPORT, vp.as_mut_ptr());
            (vp[2].max(1), vp[3].max(1))
        };

        let mut gl_fbo = MpvOpenGLFbo {
            fbo,
            w,
            h,
            internal_format: if st.is_float_fbo { GL_RGBA16F } else { GL_RGBA8 },
        };
        let mut flip_y: c_int = 1;
        let mut block_target: c_int = 0;

        let mut params = [
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_OPENGL_FBO,
                data: (&mut gl_fbo as *mut MpvOpenGLFbo).cast::<c_void>(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_FLIP_Y,
                data: (&mut flip_y as *mut c_int).cast::<c_void>(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME,
                data: (&mut block_target as *mut c_int).cast::<c_void>(),
            },
            MpvRenderParam {
                param_type: MPV_RENDER_PARAM_INVALID,
                data: std::ptr::null_mut(),
            },
        ];

        (st.lib.render_context_render)(rctx, params.as_mut_ptr());
        glFlush();
        (st.lib.render_context_report_swap)(rctx);

        CGLUnlockContext(cgl_ctx);
    }
}

extern "C" fn main_thread_redraw_trampoline(_ctx: *mut c_void) {
    let st = {
        let guard = ACTIVE_RENDERER.lock();
        guard.clone()
    };
    let Some(st) = st else { return };
    st.pending_redraw.store(false, Ordering::Release);

    if st.shutting_down.load(Ordering::Acquire) {
        return;
    }

    let rctx = st.render_ctx.load(Ordering::Acquire) as MpvRenderContext;
    if rctx.is_null() {
        return;
    }

    let flags = unsafe { (st.lib.render_context_update)(rctx) };
    if (flags & MPV_RENDER_UPDATE_FRAME) != 0 && st.gl_layer != 0 {
        unsafe {
            let layer = st.gl_layer as *mut AnyObject;
            let _: () = msg_send![layer, setNeedsDisplay];
        }
    }
}

unsafe extern "C" fn mpv_render_update_cb(_cb_ctx: *mut c_void) {
    let st = {
        let guard = ACTIVE_RENDERER.lock();
        guard.clone()
    };
    let Some(st) = st else { return };
    if st.shutting_down.load(Ordering::Acquire) {
        return;
    }
    // Coalesce rapid frame notifications onto the AppKit main queue
    if !st.pending_redraw.swap(true, Ordering::AcqRel) {
        dispatch_async_f(
            &_dispatch_main_q as *const c_void,
            std::ptr::null_mut(),
            main_thread_redraw_trampoline,
        );
    }
}

fn get_passthrough_view_class() -> &'static AnyClass {
    PASSTHROUGH_VIEW_CLASS.get_or_init(|| {
        if let Some(existing) = AnyClass::get(c"HDRCutMpvPassthroughView") {
            return existing;
        }
        let mut builder = ClassBuilder::new(c"HDRCutMpvPassthroughView", class!(NSView))
            .expect("Failed to create HDRCutMpvPassthroughView");
        unsafe {
            builder.add_method(
                sel!(hitTest:),
                hit_test_passthrough
                    as extern "C" fn(*mut AnyObject, Sel, NSPoint) -> *mut AnyObject,
            );
        }
        builder.register()
    })
}

fn get_gl_layer_class() -> &'static AnyClass {
    GL_LAYER_CLASS.get_or_init(|| {
        if let Some(existing) = AnyClass::get(c"HDRCutOpenGLLayer") {
            return existing;
        }
        let superclass = AnyClass::get(c"CAOpenGLLayer")
            .expect("CAOpenGLLayer class not found in QuartzCore");
        let mut builder = ClassBuilder::new(c"HDRCutOpenGLLayer", superclass)
            .expect("Failed to create HDRCutOpenGLLayer");
        unsafe {
            builder.add_method(
                sel!(copyCGLPixelFormatForDisplayMask:),
                layer_copy_pixel_format as extern "C" fn(*mut AnyObject, Sel, u32) -> *mut c_void,
            );
            builder.add_method(
                sel!(copyCGLContextForPixelFormat:),
                layer_copy_cgl_context
                    as extern "C" fn(*mut AnyObject, Sel, *mut c_void) -> *mut c_void,
            );
            builder.add_method(
                sel!(canDrawInCGLContext:pixelFormat:forLayerTime:displayTime:),
                layer_can_draw
                    as extern "C" fn(
                        *mut AnyObject,
                        Sel,
                        *mut c_void,
                        *mut c_void,
                        f64,
                        *const c_void,
                    ) -> Bool,
            );
            builder.add_method(
                sel!(drawInCGLContext:pixelFormat:forLayerTime:displayTime:),
                layer_draw
                    as extern "C" fn(
                        *mut AnyObject,
                        Sel,
                        *mut c_void,
                        *mut c_void,
                        f64,
                        *const c_void,
                    ),
            );
        }
        builder.register()
    })
}

pub struct MacEmbeddedRenderer {
    state: Arc<MacRenderState>,
}

impl MacEmbeddedRenderer {
    /// Creates an embedded CAOpenGLLayer inside the Tauri window's content NSView
    /// and binds libmpv's OpenGL render context directly to it (16-bit float EDR HDR!).
    /// MUST be called from a background/async thread (dispatches AppKit creation to main thread).
    pub fn create(
        window: &WebviewWindow,
        lib: Arc<LibMpv>,
        mpv_handle: MpvHandle,
    ) -> Result<Self, String> {
        // 1. Choose 64-bit float OpenGL 3.2 Core pixel format for true 10-bit/16-bit EDR HDR
        let mut cgl_pix: *mut c_void = std::ptr::null_mut();
        let mut npix: i32 = 0;
        let mut is_float_fbo = true;

        let float_attribs: [u32; 10] = [
            K_CGL_PFA_OPENGL_PROFILE,
            K_CGL_OGLP_VERSION_3_2_CORE,
            K_CGL_PFA_ACCELERATED,
            K_CGL_PFA_DOUBLE_BUFFER,
            K_CGL_PFA_ALLOW_OFFLINE_RENDERERS,
            K_CGL_PFA_COLOR_FLOAT,
            K_CGL_PFA_COLOR_SIZE,
            64,
            0,
            0,
        ];

        let err = unsafe { CGLChoosePixelFormat(float_attribs.as_ptr(), &mut cgl_pix, &mut npix) };
        if err != 0 || cgl_pix.is_null() {
            is_float_fbo = false;
            let fallback_attribs: [u32; 7] = [
                K_CGL_PFA_OPENGL_PROFILE,
                K_CGL_OGLP_VERSION_3_2_CORE,
                K_CGL_PFA_ACCELERATED,
                K_CGL_PFA_DOUBLE_BUFFER,
                K_CGL_PFA_ALLOW_OFFLINE_RENDERERS,
                0,
                0,
            ];
            let err2 =
                unsafe { CGLChoosePixelFormat(fallback_attribs.as_ptr(), &mut cgl_pix, &mut npix) };
            if err2 != 0 || cgl_pix.is_null() {
                return Err(format!("CGLChoosePixelFormat 失败: {err2}"));
            }
        }

        let mut cgl_ctx: *mut c_void = std::ptr::null_mut();
        let ctx_err = unsafe { CGLCreateContext(cgl_pix, std::ptr::null_mut(), &mut cgl_ctx) };
        if ctx_err != 0 || cgl_ctx.is_null() {
            unsafe { CGLReleasePixelFormat(cgl_pix) };
            return Err(format!("CGLCreateContext 失败: {ctx_err}"));
        }

        // 2. Bind CGL context and initialize libmpv OpenGL Render Context
        let mut rctx: MpvRenderContext = std::ptr::null_mut();
        let create_rc = unsafe {
            CGLLockContext(cgl_ctx);
            CGLSetCurrentContext(cgl_ctx);

            let api_type = c"opengl";
            let mut gl_init = MpvOpenGLInitParams {
                get_proc_address: Some(get_gl_proc_address),
                get_proc_address_ctx: std::ptr::null_mut(),
            };
            let mut params = [
                MpvRenderParam {
                    param_type: MPV_RENDER_PARAM_API_TYPE,
                    data: api_type.as_ptr() as *mut c_void,
                },
                MpvRenderParam {
                    param_type: MPV_RENDER_PARAM_OPENGL_INIT_PARAMS,
                    data: (&mut gl_init as *mut MpvOpenGLInitParams).cast::<c_void>(),
                },
                MpvRenderParam {
                    param_type: MPV_RENDER_PARAM_INVALID,
                    data: std::ptr::null_mut(),
                },
            ];
            let rc = (lib.render_context_create)(&mut rctx, mpv_handle, params.as_mut_ptr());

            CGLSetCurrentContext(std::ptr::null_mut());
            CGLUnlockContext(cgl_ctx);
            rc
        };

        if create_rc < 0 || rctx.is_null() {
            unsafe {
                CGLReleaseContext(cgl_ctx);
                CGLReleasePixelFormat(cgl_pix);
            }
            return Err(format!(
                "mpv_render_context_create 失败: {}",
                lib.err_to_string(create_rc)
            ));
        }

        // 3. Create layer-hosting child NSView + HDRCutOpenGLLayer attached to WKWebView's superview
        let (tx, rx) = std::sync::mpsc::channel::<Result<(usize, usize, usize, usize), String>>();
        let scale = window.scale_factor().unwrap_or(2.0);
        window
            .with_webview(move |webview| {
                let wv_ptr = webview.inner() as *mut AnyObject;
                let res = create_cocoa_layer_view(wv_ptr, scale);
                let _ = tx.send(res);
            })
            .map_err(|e| format!("主线程创建视频层失败: {e}"))?;

        let (parent_view, webview_ptr, child_view, gl_layer) = rx
            .recv()
            .map_err(|_| "创建视频层主线程通道断开".to_string())??;

        let state = Arc::new(MacRenderState {
            lib: lib.clone(),
            cgl_pix: cgl_pix as usize,
            cgl_ctx: cgl_ctx as usize,
            is_float_fbo,
            render_ctx: AtomicUsize::new(rctx as usize),
            parent_view,
            webview: webview_ptr,
            child_view,
            gl_layer,
            shutting_down: AtomicBool::new(false),
            pending_redraw: AtomicBool::new(false),
            render_lock: Mutex::new(()),
        });

        *ACTIVE_RENDERER.lock() = Some(state.clone());

        // 4. Hook libmpv frame-ready update callback
        unsafe {
            (lib.render_context_set_update_callback)(
                rctx,
                Some(mpv_render_update_cb),
                std::ptr::null_mut(),
            );
        }

        Ok(Self { state })
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
        let st = self.state.clone();
        let _ = window.run_on_main_thread(move || {
            if st.shutting_down.load(Ordering::Acquire) {
                return;
            }
            unsafe {
                let parent = st.parent_view as *mut AnyObject;
                let wv = st.webview as *mut AnyObject;
                let child = st.child_view as *mut AnyObject;
                let layer = st.gl_layer as *mut AnyObject;
                if parent.is_null() || wv.is_null() || child.is_null() || layer.is_null() {
                    return;
                }

                if !visible || width < 2.0 || height < 2.0 {
                    let _: () = msg_send![child, setHidden: Bool::YES];
                    return;
                }

                // Anchor directly to the WKWebView frame and CSS viewport_height (`window.innerHeight`).
                // In bottom-up Cocoa coordinates, the bottom of the CSS viewport always aligns with
                // `wv_frame.origin.y`, regardless of macOS titlebar / contentLayoutRect / fullscreen!
                let wv_frame: NSRect = msg_send![wv, frame];
                let ref_height = if viewport_height > 0.0 {
                    viewport_height
                } else {
                    wv_frame.size.height
                };
                let is_flipped: Bool = msg_send![parent, isFlipped];
                let cocoa_x = wv_frame.origin.x + x;
                let cocoa_y = if is_flipped.as_bool() {
                    let top_inset = (wv_frame.size.height - ref_height).max(0.0);
                    wv_frame.origin.y + top_inset + y
                } else {
                    wv_frame.origin.y + (ref_height - y - height)
                };

                let rect = NSRect::new(NSPoint::new(cocoa_x, cocoa_y), NSSize::new(width, height));
                if std::env::var_os("HDRCUT_DEBUG_BOUNDS").is_some() {
                    let parent_bounds: NSRect = msg_send![parent, bounds];
                    let win: *mut AnyObject = msg_send![parent, window];
                    let layout_rect: NSRect = if !win.is_null() {
                        msg_send![win, contentLayoutRect]
                    } else {
                        NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0))
                    };
                    eprintln!(
                        "[HDRCUT_BOUNDS] css=({x:.1},{y:.1},{width:.1},{height:.1}) vp_h={viewport_height:.1} | parent_bounds=({:.1},{:.1},{:.1},{:.1}) flipped={} | wv_frame=({:.1},{:.1},{:.1},{:.1}) | layout=({:.1},{:.1},{:.1},{:.1}) => child_rect=({:.1},{:.1},{:.1},{:.1})",
                        parent_bounds.origin.x, parent_bounds.origin.y, parent_bounds.size.width, parent_bounds.size.height,
                        is_flipped.as_bool(),
                        wv_frame.origin.x, wv_frame.origin.y, wv_frame.size.width, wv_frame.size.height,
                        layout_rect.origin.x, layout_rect.origin.y, layout_rect.size.width, layout_rect.size.height,
                        rect.origin.x, rect.origin.y, rect.size.width, rect.size.height
                    );
                }
                // Disable implicit Core Animation timing so resizing tracks the viewport 1:1 with zero lag,
                // and let `child setFrame:` drive its hosted layer frame (never overwrite layer.frame origin to 0,0!).
                if let Some(catx) = AnyClass::get(c"CATransaction") {
                    let _: () = msg_send![catx, begin];
                    let _: () = msg_send![catx, setDisableActions: Bool::YES];
                }
                let _: () = msg_send![child, setFrame: rect];
                if scale_factor > 0.0 {
                    let _: () = msg_send![layer, setContentsScale: scale_factor];
                }
                let _: () = msg_send![child, setHidden: Bool::NO];
                let _: () = msg_send![layer, setNeedsDisplay];
                if let Some(catx) = AnyClass::get(c"CATransaction") {
                    let _: () = msg_send![catx, commit];
                }
            }
        });
    }

    /// Configures macOS Core Animation EDR (Extended Dynamic Range) & ColorSpace
    /// for true HDR10 PQ / HLG passthrough or SDR tone-mapping.
    pub fn set_hdr_mode(&self, window: &WebviewWindow, hdr_kind: Option<&str>, passthrough: bool) {
        let st = self.state.clone();
        let kind = hdr_kind.map(|s| s.to_lowercase());
        let _ = window.run_on_main_thread(move || {
            if st.shutting_down.load(Ordering::Acquire) || st.gl_layer == 0 {
                return;
            }
            unsafe {
                let layer = st.gl_layer as *mut AnyObject;
                let enable_edr = passthrough && kind.is_some();
                let _: () = msg_send![
                    layer,
                    setWantsExtendedDynamicRangeContent: if enable_edr { Bool::YES } else { Bool::NO }
                ];

                let cs_name = if enable_edr {
                    if kind.as_deref().unwrap_or("").contains("hlg") {
                        kCGColorSpaceITUR_2100_HLG
                    } else {
                        kCGColorSpaceITUR_2100_PQ
                    }
                } else {
                    kCGColorSpaceDisplayP3
                };

                let cs = CGColorSpaceCreateWithName(cs_name);
                if !cs.is_null() {
                    let _: () = msg_send![layer, setColorspace: cs];
                    CGColorSpaceRelease(cs);
                }
                let _: () = msg_send![layer, setNeedsDisplay];
            }
        });
    }

    pub fn shutdown(&self) {
        self.state.shutting_down.store(true, Ordering::SeqCst);

        // Detach active global reference first
        {
            let mut active = ACTIVE_RENDERER.lock();
            if active
                .as_ref()
                .map(|a| Arc::ptr_eq(a, &self.state))
                .unwrap_or(false)
            {
                *active = None;
            }
        }

        // Destroy mpv render context safely under GL context lock
        let _rlock = self.state.render_lock.lock();
        let rctx = self.state.render_ctx.swap(0, Ordering::SeqCst) as MpvRenderContext;
        let cgl_ctx = self.state.cgl_ctx as *mut c_void;
        let cgl_pix = self.state.cgl_pix as *mut c_void;

        if !rctx.is_null() {
            unsafe {
                (self.state.lib.render_context_set_update_callback)(rctx, None, std::ptr::null_mut());
                if !cgl_ctx.is_null() {
                    CGLLockContext(cgl_ctx);
                    CGLSetCurrentContext(cgl_ctx);
                    (self.state.lib.render_context_free)(rctx);
                    CGLSetCurrentContext(std::ptr::null_mut());
                    CGLUnlockContext(cgl_ctx);
                } else {
                    (self.state.lib.render_context_free)(rctx);
                }
            }
        }

        // Remove child NSView asynchronously on the main queue (never blocks!)
        let child_addr = self.state.child_view;
        let layer_addr = self.state.gl_layer;
        if child_addr != 0 {
            extern "C" fn remove_view_cb(ptr: *mut c_void) {
                let packed = unsafe { Box::from_raw(ptr as *mut (usize, usize)) };
                let (child_addr, layer_addr) = *packed;
                unsafe {
                    let child = child_addr as *mut AnyObject;
                    if !child.is_null() {
                        let _: () = msg_send![child, setHidden: Bool::YES];
                        let _: () = msg_send![child, removeFromSuperview];
                        let _: () = msg_send![child, release];
                    }
                    let layer = layer_addr as *mut AnyObject;
                    if !layer.is_null() {
                        let _: () = msg_send![layer, release];
                    }
                }
            }
            let boxed = Box::into_raw(Box::new((child_addr, layer_addr))) as *mut c_void;
            unsafe {
                dispatch_async_f(&_dispatch_main_q as *const c_void, boxed, remove_view_cb);
            }
        }

        unsafe {
            if !cgl_ctx.is_null() {
                CGLReleaseContext(cgl_ctx);
            }
            if !cgl_pix.is_null() {
                CGLReleasePixelFormat(cgl_pix);
            }
        }
    }
}

fn create_cocoa_layer_view(
    wv_ptr: *mut AnyObject,
    scale: f64,
) -> Result<(usize, usize, usize, usize), String> {
    if wv_ptr.is_null() {
        return Err("WKWebView 指针为空".to_string());
    }

    unsafe {
        let parent_ptr: *mut AnyObject = msg_send![wv_ptr, superview];
        if parent_ptr.is_null() {
            return Err("WKWebView superview 为空".to_string());
        }

        let layer_cls = get_gl_layer_class();
        let layer: *mut AnyObject = msg_send![layer_cls, alloc];
        let layer: *mut AnyObject = msg_send![layer, init];
        if layer.is_null() {
            return Err("创建 HDRCutOpenGLLayer 失败".to_string());
        }

        let _: () = msg_send![layer, setAsynchronous: Bool::NO];
        let _: () = msg_send![layer, setOpaque: Bool::YES];
        let _: () = msg_send![layer, setNeedsDisplayOnBoundsChange: Bool::YES];
        let _: () = msg_send![layer, setWantsExtendedDynamicRangeContent: Bool::NO];
        let _: () = msg_send![layer, setContentsScale: scale];

        let view_cls = get_passthrough_view_class();
        let view: *mut AnyObject = msg_send![view_cls, alloc];
        let init_rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
        let view: *mut AnyObject = msg_send![view, initWithFrame: init_rect];
        if view.is_null() {
            let _: () = msg_send![layer, release];
            return Err("创建嵌入式 NSView 失败".to_string());
        }

        // Layer-hosting NSView: setLayer BEFORE setWantsLayer:YES
        let _: () = msg_send![view, setLayer: layer];
        let _: () = msg_send![view, setWantsLayer: Bool::YES];
        let _: () = msg_send![view, setHidden: Bool::YES];
        // Add directly above WKWebView inside its exact superview (NSWindowAbove = 1)
        let _: () = msg_send![parent_ptr, addSubview: view, positioned: 1isize, relativeTo: wv_ptr];

        Ok((
            parent_ptr as usize,
            wv_ptr as usize,
            view as usize,
            layer as usize,
        ))
    }
}
