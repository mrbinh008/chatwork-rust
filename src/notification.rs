// src/notification.rs - Desktop notifications
use tracing::{info, warn};
use tao::event_loop::EventLoopProxy;
use crate::UserEvent;

/// Register AppUserModelID so Windows Toast UI displays "THK" and the app icon
#[allow(dead_code)]
pub fn register_app_user_model_id() {
    #[cfg(windows)]
    unsafe {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        // 1. Explicitly associate current process with "THK" AUMID
        let app_id_wide: Vec<u16> = OsStr::new("THK")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let _ = windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(app_id_wide.as_ptr());

        // 2. Ensure HKCU\Software\Classes\AppUserModelId\THK exists
        let subkey: Vec<u16> = OsStr::new("Software\\Classes\\AppUserModelId\\THK")
            .encode_wide()
            .chain(Some(0))
            .collect();

        let mut hkey: HKEY = std::ptr::null_mut();
        let status = RegCreateKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            std::ptr::null_mut(),
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            std::ptr::null_mut(),
            &mut hkey,
            std::ptr::null_mut(),
        );

        if status == 0 && !hkey.is_null() {
            let display_name: Vec<u16> = OsStr::new(crate::app::APP_NAME)
                .encode_wide()
                .chain(Some(0))
                .collect();
            let name_key: Vec<u16> = OsStr::new("DisplayName")
                .encode_wide()
                .chain(Some(0))
                .collect();
            let _ = RegSetValueExW(
                hkey,
                name_key.as_ptr(),
                0,
                REG_SZ,
                display_name.as_ptr() as *const u8,
                (display_name.len() * 2) as u32,
            );

            // IconUri
            let mut icon_path = std::env::current_exe().unwrap_or_default();
            icon_path.pop();
            let ico = icon_path.join("assets").join("thk.ico");
            let fallback_ico = icon_path.join("assets").join("chatwork.ico");
            let icon_str = if ico.exists() {
                ico.to_string_lossy().to_string()
            } else if fallback_ico.exists() {
                fallback_ico.to_string_lossy().to_string()
            } else {
                std::env::current_exe().unwrap_or_default().to_string_lossy().to_string()
            };

            let icon_uri: Vec<u16> = OsStr::new(&icon_str)
                .encode_wide()
                .chain(Some(0))
                .collect();
            let icon_key: Vec<u16> = OsStr::new("IconUri")
                .encode_wide()
                .chain(Some(0))
                .collect();
            let _ = RegSetValueExW(
                hkey,
                icon_key.as_ptr(),
                0,
                REG_SZ,
                icon_uri.as_ptr() as *const u8,
                (icon_uri.len() * 2) as u32,
            );

            let show_key: Vec<u16> = OsStr::new("ShowInSettings")
                .encode_wide()
                .chain(Some(0))
                .collect();
            let show_val: u32 = 1;
            let _ = RegSetValueExW(
                hkey,
                show_key.as_ptr(),
                0,
                REG_DWORD,
                &show_val as *const u32 as *const u8,
                4,
            );

            let _ = RegCloseKey(hkey);
        }
    }
}

/// Show a desktop notification
pub fn show_notification(
    title: &str,
    body: &str,
    proxy: Option<EventLoopProxy<UserEvent>>,
    unread_count: u32,
    id: Option<String>,
    target: Option<String>,
    icon: Option<&str>,
) {
    info!("Notification: {} - {} (unread: {}, icon: {:?})", title, body, unread_count, icon);

    let display_title = if title.trim().is_empty() {
        if unread_count > 0 {
            format!("[{}] {}", unread_count, crate::app::APP_NAME)
        } else {
            crate::app::APP_NAME.to_string()
        }
    } else if unread_count > 0 && !title.starts_with('[') {
        format!("[{}] {}", unread_count, title)
    } else {
        title.to_string()
    };
    let safe_title: String = display_title.chars().take(100).collect();
    let safe_body: String = body.chars().take(500).collect();

    let icon_to_use = resolve_notification_icon(icon);

    #[cfg(windows)]
    {
        let mut noti = notify_rust::Notification::new();
        noti.app_id("THK")
            .appname(crate::app::APP_NAME)
            .summary(&safe_title)
            .body(&safe_body)
            .action("open", "Mở THK-Chat")
            .timeout(notify_rust::Timeout::Milliseconds(5000));

        if !icon_to_use.is_empty() {
            noti.icon(&icon_to_use);
        }

        let show_result = noti.show();
        let handle = match show_result {
            Ok(h) => Ok(h),
            Err(e) => {
                warn!("Notification with app_id THK failed ({:?}), retrying with fallback...", e);
                let mut fallback_noti = notify_rust::Notification::new();
                fallback_noti
                    .appname(crate::app::APP_NAME)
                    .summary(&safe_title)
                    .body(&safe_body)
                    .action("open", "Mở THK-Chat")
                    .timeout(notify_rust::Timeout::Milliseconds(5000));
                if !icon_to_use.is_empty() {
                    fallback_noti.icon(&icon_to_use);
                }
                fallback_noti.show()
            }
        };

        match handle {
            Ok(h) => {
                info!("Notification shown successfully: {}", safe_title);
                if let Some(proxy) = proxy {
                    std::thread::spawn(move || {
                        let _ = h.wait_for_response(move |response: &notify_rust::NotificationResponse| {
                            let _ = proxy.send_event(UserEvent::NotificationInteraction {
                                id,
                                target,
                                activated: is_notification_activation(response),
                            });
                        });
                    });
                }
            }
            Err(e) => warn!("Failed to show notification: {}", e),
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mut noti = notify_rust::Notification::new();
        noti.appname(crate::app::APP_NAME)
            .summary(&safe_title)
            .body(&safe_body);

        if !icon_to_use.is_empty() {
            noti.icon(&icon_to_use);
        }

        match noti.show() {
            Ok(h) => {
                info!("macOS notification shown successfully: {}", safe_title);
                if let Some(proxy) = proxy {
                    std::thread::spawn(move || {
                        let _ = h.wait_for_response(move |response: &notify_rust::NotificationResponse| {
                            let _ = proxy.send_event(UserEvent::NotificationInteraction {
                                id,
                                target,
                                activated: is_notification_activation(response),
                            });
                        });
                    });
                }
            }
            Err(e) => warn!("Failed to show macOS notification: {}", e),
        }
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let mut noti = notify_rust::Notification::new();
        noti.appname(crate::app::APP_NAME)
            .summary(&safe_title)
            .body(&safe_body);
        if !icon_to_use.is_empty() {
            noti.icon(&icon_to_use);
        }
        let _ = noti.show();
    }
}

fn resolve_notification_icon(icon: Option<&str>) -> String {
    if let Some(ic) = icon {
        let trimmed = ic.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    let mut icon_path = std::env::current_exe().unwrap_or_default();
    icon_path.pop();
    let ico = icon_path.join("assets").join("thk.ico");
    let fallback_ico = icon_path.join("assets").join("chatwork.ico");
    if ico.exists() {
        ico.to_string_lossy().to_string()
    } else if fallback_ico.exists() {
        fallback_ico.to_string_lossy().to_string()
    } else {
        String::new()
    }
}

fn is_notification_activation(response: &notify_rust::NotificationResponse) -> bool {
    matches!(response, notify_rust::NotificationResponse::Default)
        || matches!(response, notify_rust::NotificationResponse::Action(action) if action == "open" || action == "default")
}

/// Format unread count for badge/title display
pub fn format_badge_count(count: u32) -> String {
    if count == 0 {
        String::new()
    } else if count > 99 {
        "99+".to_string()
    } else {
        count.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_click_and_open_action_activate_notification() {
        use notify_rust::NotificationResponse as Response;
        assert!(is_notification_activation(&Response::Default));
        assert!(is_notification_activation(&Response::Action("open".into())));
        assert!(is_notification_activation(&Response::Action("default".into())));
    }

    #[test]
    fn closing_or_expiring_does_not_activate_notification() {
        use notify_rust::{CloseReason, NotificationResponse as Response};
        for reason in [CloseReason::Dismissed, CloseReason::Expired, CloseReason::CloseAction] {
            assert!(!is_notification_activation(&Response::Closed(reason)));
        }
        assert!(!is_notification_activation(&Response::Action("other".into())));
    }
}
