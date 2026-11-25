use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::WebviewWindow;

/// Native child video surface hosted inside the Tauri window:
/// - macOS: Child NSView (hitTest passthrough -> clicks & drag-drop reach React cleanly!)
/// - Windows: Child HWND (WS_CHILD | WS_CLIPSIBLINGS, HTTRANSPARENT hit test)
pub struct NativeVideoView {
    /// Raw pointer value passed to libmpv `wid` option (NSView* on macOS, HWND on Windows)
    pub wid: i64,
    #[cfg(target_os = "macos")]
    parent_view: usize,
    #[cfg(target_os = "macos")]
    child_view: usize,
    #[cfg(target_os = "windows")]
    child_hwnd: isize,
}

unsafe impl Send for NativeVideoView {}
unsafe impl Sync for NativeVideoView {}

#[cfg(target_os = "macos")]
mod mac_impl {
    use super::*;
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{class, msg_send, sel};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use std::ffi::c_void;
    use std::sync::OnceLock;

    static VIEW_CLASS: OnceLock<&'static AnyClass> = OnceLock::new();

    extern "C" fn hit_test_passthrough(
        _this: *mut AnyObject,
        _cmd: Sel,
        _point: NSPoint,
    ) -> *mut AnyObject {
        std::ptr::null_mut()
    }

    fn get_passthrough_view_class() -> &'static AnyClass {
        VIEW_CLASS.get_or_init(|| {
            if let Some(existing) = AnyClass::get(c"HDRCutMpvPassthroughView") {
                return existing;
            }
            let superclass = class!(NSView);
            let mut builder = ClassBuilder::new(c"HDRCutMpvPassthroughView", superclass)
                .expect("Failed to create HDRCutMpvPassthroughView class");
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

    pub fn create_view(window: &WebviewWindow) -> Result<NativeVideoView, String> {
        let handle = window
            .window_handle()
            .map_err(|e| format!("获取原生窗口句柄失败: {e}"))?;
        let parent_ptr = match handle.as_raw() {
            RawWindowHandle::AppKit(h) => h.ns_view.as_ptr() as *mut AnyObject,
            _ => return Err("非 AppKit 窗口句柄".to_string()),
        };

        unsafe {
            let cls = get_passthrough_view_class();
            let view: *mut AnyObject = msg_send![cls, alloc];
            let init_rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1.0, 1.0));
            let view: *mut AnyObject = msg_send![view, initWithFrame: init_rect];
            if view.is_null() {
                return Err("创建 NSView 失败".to_string());
            }

            // Enable Core Animation layer backing so mpv macvk can attach CAMetalLayer directly
            let _: () = msg_send![view, setWantsLayer: Bool::YES];
            // Start hidden until a video is loaded and React reports viewport bounds
            let _: () = msg_send![view, setHidden: Bool::YES];
            // Add above WKWebView inside the window's content view
            let _: () = msg_send![parent_ptr, addSubview: view];

            let wid = view as *mut c_void as usize as i64;
            Ok(NativeVideoView {
                wid,
                parent_view: parent_ptr as usize,
                child_view: view as usize,
            })
        }
    }

    pub fn update_bounds(
        view: &NativeVideoView,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        _scale_factor: f64,
        visible: bool,
    ) {
        unsafe {
            let parent = view.parent_view as *mut AnyObject;
            let child = view.child_view as *mut AnyObject;
            if parent.is_null() || child.is_null() {
                return;
            }

            if !visible || width < 2.0 || height < 2.0 {
                let _: () = msg_send![child, setHidden: Bool::YES];
                return;
            }

            let parent_bounds: NSRect = msg_send![parent, bounds];
            let is_flipped: Bool = msg_send![parent, isFlipped];
            let cocoa_y = if is_flipped.as_bool() {
                y
            } else {
                parent_bounds.size.height - y - height
            };

            let rect = NSRect::new(NSPoint::new(x, cocoa_y), NSSize::new(width, height));
            let _: () = msg_send![child, setFrame: rect];
            let _: () = msg_send![child, setHidden: Bool::NO];
        }
    }

    pub fn destroy_view(view: &NativeVideoView) {
        unsafe {
            let child = view.child_view as *mut AnyObject;
            if !child.is_null() {
                let _: () = msg_send![child, removeFromSuperview];
                let _: () = msg_send![child, release];
            }
        }
    }
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::*;
    use std::sync::Once;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{CreateSolidBrush, HBRUSH};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, SetWindowPos, ShowWindow,
        CS_HREDRAW, CS_VREDRAW, HTTRANSPARENT, HWND_TOP, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_HIDE,
        WM_NCHITTEST, WNDCLASSW, WS_CHILD, WS_CLIPSIBLINGS,
    };

    static REGISTER_CLASS: Once = Once::new();

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn wnd_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_NCHITTEST {
            return HTTRANSPARENT as LRESULT;
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    pub fn create_view(window: &WebviewWindow) -> Result<NativeVideoView, String> {
        let handle = window
            .window_handle()
            .map_err(|e| format!("获取原生窗口句柄失败: {e}"))?;
        let parent_hwnd: HWND = match handle.as_raw() {
            RawWindowHandle::Win32(h) => h.hwnd.get() as HWND,
            _ => return Err("非 Win32 窗口句柄".to_string()),
        };

        let class_name = wide("HDRCutMpvViewClass");
        unsafe {
            let hinstance = GetModuleHandleW(std::ptr::null());
            REGISTER_CLASS.call_once(|| {
                let black_brush: HBRUSH = CreateSolidBrush(0x00000000);
                let wc = WNDCLASSW {
                    style: CS_HREDRAW | CS_VREDRAW,
                    lpfnWndProc: Some(wnd_proc),
                    cbClsExtra: 0,
                    cbWndExtra: 0,
                    hInstance: hinstance,
                    hIcon: std::ptr::null_mut(),
                    hCursor: std::ptr::null_mut(),
                    hbrBackground: black_brush,
                    lpszMenuName: std::ptr::null(),
                    lpszClassName: class_name.as_ptr(),
                };
                RegisterClassW(&wc);
            });

            let child = CreateWindowExW(
                0,
                class_name.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_CLIPSIBLINGS,
                0,
                0,
                1,
                1,
                parent_hwnd,
                std::ptr::null_mut(),
                hinstance,
                std::ptr::null(),
            );
            if child.is_null() {
                return Err("创建 Windows 子窗口 HWND 失败".to_string());
            }

            ShowWindow(child, SW_HIDE);
            Ok(NativeVideoView {
                wid: child as isize as i64,
                child_hwnd: child as isize,
            })
        }
    }

    pub fn update_bounds(
        view: &NativeVideoView,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: f64,
        visible: bool,
    ) {
        unsafe {
            let hwnd = view.child_hwnd as HWND;
            if hwnd.is_null() {
                return;
            }
            if !visible || width < 2.0 || height < 2.0 {
                ShowWindow(hwnd, SW_HIDE);
                return;
            }
            let px = (x * scale_factor).round() as i32;
            let py = (y * scale_factor).round() as i32;
            let pw = (width * scale_factor).round() as i32;
            let ph = (height * scale_factor).round() as i32;

            SetWindowPos(
                hwnd,
                HWND_TOP,
                px,
                py,
                pw,
                ph,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
        }
    }

    pub fn destroy_view(view: &NativeVideoView) {
        unsafe {
            let hwnd = view.child_hwnd as HWND;
            if !hwnd.is_null() {
                DestroyWindow(hwnd);
            }
        }
    }
}

impl NativeVideoView {
    pub fn create(window: &WebviewWindow) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            mac_impl::create_view(window)
        }
        #[cfg(target_os = "windows")]
        {
            win_impl::create_view(window)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = window;
            Err("当前平台暂不支持原生视频视图".to_string())
        }
    }

    pub fn set_bounds(
        &self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        scale_factor: f64,
        visible: bool,
    ) {
        #[cfg(target_os = "macos")]
        mac_impl::update_bounds(self, x, y, width, height, scale_factor, visible);

        #[cfg(target_os = "windows")]
        win_impl::update_bounds(self, x, y, width, height, scale_factor, visible);

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = (x, y, width, height, scale_factor, visible);
        }
    }

    pub fn destroy(&self) {
        #[cfg(target_os = "macos")]
        mac_impl::destroy_view(self);

        #[cfg(target_os = "windows")]
        win_impl::destroy_view(self);
    }
}
