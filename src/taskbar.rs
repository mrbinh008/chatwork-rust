// src/taskbar.rs - Taskbar and Dock badge management
use tao::window::Window;

#[cfg(windows)]
use tao::platform::windows::WindowExtWindows;

#[cfg(windows)]
const BADGE_1: &[u8] = include_bytes!("../assets/notification/badge-1.png");
#[cfg(windows)]
const BADGE_2: &[u8] = include_bytes!("../assets/notification/badge-2.png");
#[cfg(windows)]
const BADGE_3: &[u8] = include_bytes!("../assets/notification/badge-3.png");
#[cfg(windows)]
const BADGE_4: &[u8] = include_bytes!("../assets/notification/badge-4.png");
#[cfg(windows)]
const BADGE_5: &[u8] = include_bytes!("../assets/notification/badge-5.png");
#[cfg(windows)]
const BADGE_6: &[u8] = include_bytes!("../assets/notification/badge-6.png");
#[cfg(windows)]
const BADGE_7: &[u8] = include_bytes!("../assets/notification/badge-7.png");
#[cfg(windows)]
const BADGE_8: &[u8] = include_bytes!("../assets/notification/badge-8.png");
#[cfg(windows)]
const BADGE_9: &[u8] = include_bytes!("../assets/notification/badge-9.png");
#[cfg(windows)]
const BADGE_10: &[u8] = include_bytes!("../assets/notification/badge-10.png");

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct ITaskbarList3Vtbl {
    pub QueryInterface: unsafe extern "system" fn(this: *mut std::ffi::c_void, riid: *const windows_sys::core::GUID, ppvObject: *mut *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub AddRef: unsafe extern "system" fn(this: *mut std::ffi::c_void) -> u32,
    pub Release: unsafe extern "system" fn(this: *mut std::ffi::c_void) -> u32,
    pub HrInit: unsafe extern "system" fn(this: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub AddTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub DeleteTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub ActivateTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub SetActiveAlt: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub MarkFullscreenWindow: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, fFullscreen: i32) -> windows_sys::core::HRESULT,
    pub SetProgressValue: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, ullCompleted: u64, ullTotal: u64) -> windows_sys::core::HRESULT,
    pub SetProgressState: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, tbpFlags: i32) -> windows_sys::core::HRESULT,
    pub RegisterTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwndTab: *mut std::ffi::c_void, hwndMDI: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub UnregisterTab: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwndTab: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub SetTabOrder: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwndTab: *mut std::ffi::c_void, hwndInsertBefore: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub SetTabActive: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwndTab: *mut std::ffi::c_void, hwndMDI: *mut std::ffi::c_void, dwReserved: u32) -> windows_sys::core::HRESULT,
    pub ThumbBarAddButtons: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, cButtons: u32, pButton: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub ThumbBarUpdateButtons: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, cButtons: u32, pButton: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub ThumbBarSetImageList: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, himl: *mut std::ffi::c_void) -> windows_sys::core::HRESULT,
    pub SetOverlayIcon: unsafe extern "system" fn(this: *mut std::ffi::c_void, hwnd: *mut std::ffi::c_void, hIcon: *mut std::ffi::c_void, pszDescription: *const u16) -> windows_sys::core::HRESULT,
}

#[cfg(windows)]
const CLSID_TASKBAR_LIST: windows_sys::core::GUID = windows_sys::core::GUID::from_u128(0x56fdf344_fd6d_11d0_958a_006097c9a090);
#[cfg(windows)]
const IID_ITASKBAR_LIST3: windows_sys::core::GUID = windows_sys::core::GUID::from_u128(0xea1afb91_9e28_4b86_90e9_9e9f8a5eefaf);

pub struct TaskbarManager {
    #[cfg(windows)]
    taskbar_ptr: *mut *const ITaskbarList3Vtbl,
    #[cfg(windows)]
    current_hicon: *mut std::ffi::c_void,
}

impl TaskbarManager {
    pub fn new() -> Self {
        #[cfg(windows)]
        {
            unsafe {
                windows_sys::Win32::System::Com::CoInitialize(std::ptr::null_mut());

                let mut ppv: *mut std::ffi::c_void = std::ptr::null_mut();
                let hr = windows_sys::Win32::System::Com::CoCreateInstance(
                    &CLSID_TASKBAR_LIST,
                    std::ptr::null_mut(),
                    windows_sys::Win32::System::Com::CLSCTX_INPROC_SERVER,
                    &IID_ITASKBAR_LIST3,
                    &mut ppv,
                );
                if hr == 0 && !ppv.is_null() {
                    let tbl = ppv as *mut *const ITaskbarList3Vtbl;
                    let _ = ((*(*tbl)).HrInit)(ppv);
                    return Self {
                        taskbar_ptr: tbl,
                        current_hicon: std::ptr::null_mut(),
                    };
                }
            }
            Self {
                taskbar_ptr: std::ptr::null_mut(),
                current_hicon: std::ptr::null_mut(),
            }
        }
        #[cfg(not(windows))]
        {
            Self {}
        }
    }

    pub fn set_badge(&mut self, window: &Window, count: u32) {
        #[cfg(windows)]
        unsafe {
            let hwnd = window.hwnd() as *mut std::ffi::c_void;
            if self.taskbar_ptr.is_null() || hwnd.is_null() {
                return;
            }

            // Clean up previous HICON if any
            if !self.current_hicon.is_null() {
                let _ = windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon(self.current_hicon);
                self.current_hicon = std::ptr::null_mut();
            }

            let tbl = self.taskbar_ptr;
            if count == 0 {
                let _ = ((*(*tbl)).SetOverlayIcon)(tbl as _, hwnd, std::ptr::null_mut(), std::ptr::null());
            } else {
                let bytes: &[u8] = match count {
                    1 => BADGE_1,
                    2 => BADGE_2,
                    3 => BADGE_3,
                    4 => BADGE_4,
                    5 => BADGE_5,
                    6 => BADGE_6,
                    7 => BADGE_7,
                    8 => BADGE_8,
                    9 => BADGE_9,
                    _ => BADGE_10,
                };

                let hicon = windows_sys::Win32::UI::WindowsAndMessaging::CreateIconFromResourceEx(
                    bytes.as_ptr() as *mut u8,
                    bytes.len() as u32,
                    1,
                    0x00030000,
                    16,
                    16,
                    windows_sys::Win32::UI::WindowsAndMessaging::LR_DEFAULTCOLOR,
                );

                if !hicon.is_null() {
                    self.current_hicon = hicon;
                    let desc: Vec<u16> = format!("{} unread", count)
                        .encode_utf16()
                        .chain(Some(0))
                        .collect();
                    let _ = ((*(*tbl)).SetOverlayIcon)(tbl as _, hwnd, hicon, desc.as_ptr());
                }
            }
        }

        #[cfg(target_os = "macos")]
        {
            let _ = window;
            set_macos_dock_badge(count);
        }

        #[cfg(all(not(windows), not(target_os = "macos")))]
        {
            let _ = (window, count);
        }
    }
}

#[cfg(target_os = "macos")]
fn set_macos_dock_badge(count: u32) {
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Class;
    use std::ffi::CString;

    unsafe {
        if let Some(cls) = Class::get("NSApplication") {
            let app: *mut objc::runtime::Object = msg_send![cls, sharedApplication];
            if !app.is_null() {
                let dock_tile: *mut objc::runtime::Object = msg_send![app, dockTile];
                if !dock_tile.is_null() {
                    if count == 0 {
                        let nil: *mut objc::runtime::Object = std::ptr::null_mut();
                        let () = msg_send![dock_tile, setBadgeLabel: nil];
                    } else {
                        let label_str = crate::notification::format_badge_count(count);
                        if let Some(str_cls) = Class::get("NSString") {
                            let c_str = CString::new(label_str).unwrap_or_default();
                            let ns_str: *mut objc::runtime::Object = msg_send![str_cls, stringWithUTF8String: c_str.as_ptr()];
                            let () = msg_send![dock_tile, setBadgeLabel: ns_str];
                        }
                    }
                }
            }
        }
    }
}

impl Drop for TaskbarManager {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            if !self.current_hicon.is_null() {
                let _ = windows_sys::Win32::UI::WindowsAndMessaging::DestroyIcon(self.current_hicon);
                self.current_hicon = std::ptr::null_mut();
            }
            if !self.taskbar_ptr.is_null() {
                let _ = ((*(*self.taskbar_ptr)).Release)(self.taskbar_ptr as _);
                self.taskbar_ptr = std::ptr::null_mut();
            }
        }
    }
}
