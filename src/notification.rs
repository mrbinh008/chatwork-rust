// src/notification.rs - Desktop notifications
use tracing::{info, warn};
use tao::event_loop::EventLoopProxy;
use crate::UserEvent;

fn get_icon_paths_for_variant(variant: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let mut icon_path = std::env::current_exe().unwrap_or_default();
    icon_path.pop();
    let assets = icon_path.join("assets");
    let lower = variant.to_ascii_lowercase();
    if lower.contains("sig") {
        (assets.join("thk_signature.ico"), assets.join("thk_signature.png"))
    } else if lower.contains("dog") {
        (assets.join("thk_dog.ico"), assets.join("thk_dog.png"))
    } else {
        (assets.join("thk.ico"), assets.join("thk.png"))
    }
}

pub fn get_icon_string_for_variant(variant: &str) -> String {
    let (ico, png) = get_icon_paths_for_variant(variant);
    if png.exists() {
        png.to_string_lossy().to_string()
    } else if ico.exists() {
        ico.to_string_lossy().to_string()
    } else {
        let mut icon_path = std::env::current_exe().unwrap_or_default();
        icon_path.pop();
        let fallback_ico = icon_path.join("assets").join("thk.ico");
        let fallback_png = icon_path.join("assets").join("thk.png");
        if fallback_png.exists() {
            fallback_png.to_string_lossy().to_string()
        } else if fallback_ico.exists() {
            fallback_ico.to_string_lossy().to_string()
        } else {
            std::env::current_exe().unwrap_or_default().to_string_lossy().to_string()
        }
    }
}

pub fn update_app_icon_registry(variant: &str) {
    #[cfg(windows)]
    unsafe {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::System::Registry::*;

        let subkey: Vec<u16> = OsStr::new("Software\\Classes\\AppUserModelId\\THK")
            .encode_wide().chain(Some(0)).collect();
        let mut hkey: HKEY = std::ptr::null_mut();
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_WRITE, &mut hkey) == 0 && !hkey.is_null() {
            let icon_str = get_icon_string_for_variant(variant);
            let icon_uri: Vec<u16> = OsStr::new(&icon_str).encode_wide().chain(Some(0)).collect();
            let icon_key: Vec<u16> = OsStr::new("IconUri").encode_wide().chain(Some(0)).collect();
            let _ = RegSetValueExW(
                hkey,
                icon_key.as_ptr(),
                0,
                REG_SZ,
                icon_uri.as_ptr() as *const u8,
                (icon_uri.len() * 2) as u32,
            );
            let _ = RegCloseKey(hkey);
            info!("Updated Windows notification registry IconUri for variant '{}' -> {}", variant, icon_str);
        }
    }
}

/// Register AppUserModelID so Windows Toast UI displays "THK" and the app icon
#[allow(dead_code)]
pub fn register_app_user_model_id() {
    register_app_user_model_id_for_variant("original");
}

pub fn register_app_user_model_id_for_variant(variant: &str) {
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
            let icon_str = get_icon_string_for_variant(variant);
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
    app_icon: Option<&str>,
) {
    info!("Notification: {} - {} (unread: {}, icon: {:?}, app_icon: {:?})", title, body, unread_count, icon, app_icon);

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

    let icon_to_use = resolve_notification_icon(icon, app_icon);

    #[cfg(windows)]
    {
        use winrt_notification::{Duration, IconCrop, Toast};
        let build = |app_id: &str, with_avatar: bool| {
            let mut toast = Toast::new(app_id).title(&safe_title).text1(&safe_body)
                .add_button("Mở THK-Chat", "open").duration(Duration::Short);
            if with_avatar && !icon_to_use.is_empty() {
                toast = toast.icon(std::path::Path::new(&icon_to_use), IconCrop::Circular, "Avatar");
            }
            let activate_proxy = proxy.clone(); let activate_id = id.clone(); let activate_target = target.clone();
            toast.on_activated(move |action| {
                let response = action.map(notify_rust::NotificationResponse::Action)
                    .unwrap_or(notify_rust::NotificationResponse::Default);
                if let Some(proxy) = &activate_proxy {
                    let _ = proxy.send_event(UserEvent::NotificationInteraction {
                        id:activate_id.clone(), target:activate_target.clone(), activated:is_notification_activation(&response),
                    });
                }
                Ok(())
            }).on_dismissed({
                let proxy = proxy.clone(); let id = id.clone(); let target = target.clone();
                move |_| {
                    if let Some(proxy) = &proxy {
                        let _ = proxy.send_event(UserEvent::NotificationInteraction { id:id.clone(), target:target.clone(), activated:false });
                    }
                    Ok(())
                }
            })
        };
        if let Err(error) = build("THK", true).show() {
            warn!("Notification with avatar failed ({:?}), retrying without image", error);
            if let Err(error) = build(Toast::POWERSHELL_APP_ID, false).show() {
                warn!("Failed to show notification: {:?}", error);
            }
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

fn resolve_notification_icon(icon: Option<&str>, app_icon: Option<&str>) -> String {
    if let Some(ic) = icon {
        let trimmed = ic.trim();
        if !trimmed.is_empty() {
            #[cfg(windows)]
            {
                if trimmed.starts_with("https://") {
                    if let Some(path) = cache_notification_avatar(trimmed) { return path.to_string_lossy().into_owned(); }
                } else if std::path::Path::new(trimmed).is_file() { return trimmed.to_string(); }
            }
            #[cfg(not(windows))]
            { return trimmed.to_string(); }
        }
    }

    let variant = app_icon.unwrap_or("original");
    let (ico, png) = get_icon_paths_for_variant(variant);
    if png.exists() {
        png.to_string_lossy().to_string()
    } else if ico.exists() {
        ico.to_string_lossy().to_string()
    } else {
        let mut icon_path = std::env::current_exe().unwrap_or_default();
        icon_path.pop();
        let fallback_ico = icon_path.join("assets").join("thk.ico");
        if fallback_ico.exists() {
            fallback_ico.to_string_lossy().to_string()
        } else {
            String::new()
        }
    }
}

#[cfg(any(windows, test))]
fn is_avatar_url(address: &str) -> bool {
    let Ok(uri) = address.parse::<wry::http::Uri>() else { return false; };
    let Some(host) = uri.host().map(str::to_ascii_lowercase) else { return false; };
    uri.scheme_str() == Some("https") && ["chatwork.com", "kcw.kddi.ne.jp", "kcw.kddi.com"]
        .iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}
#[cfg(any(windows, test))]
fn avatar_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { Some("png") }
    else if bytes.starts_with(&[0xff,0xd8,0xff]) { Some("jpg") }
    else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { Some("gif") }
    else { None }
}
#[cfg(windows)]
fn cache_notification_avatar(address: &str) -> Option<std::path::PathBuf> {
    use std::{fs, hash::{Hash, Hasher}, os::windows::process::CommandExt, process::{Command, Stdio},
        sync::atomic::{AtomicU64, Ordering}, time::Duration};
    if address.len() > 8192 || !is_avatar_url(address) { return None; }
    let directory = dirs::cache_dir()?.join("THK-Chat").join("notification-avatars");
    fs::create_dir_all(&directory).ok()?;
    let mut hash = std::collections::hash_map::DefaultHasher::new(); address.hash(&mut hash);
    let stem = format!("{:016x}", hash.finish());
    for extension in ["png", "jpg", "gif"] {
        let path = directory.join(format!("{stem}.{extension}"));
        if fs::metadata(&path).ok().and_then(|metadata| metadata.modified().ok())
            .and_then(|modified| modified.elapsed().ok()).is_some_and(|age| age < Duration::from_secs(86400)) {
            return Some(path);
        }
    }
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let pending = directory.join(format!("{stem}-{}-{}.part", std::process::id(), SEQUENCE.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let status = Command::new("C:\\Windows\\System32\\curl.exe").creation_flags(0x0800_0000)
            .args(["--silent", "--fail", "--location", "--proto", "=https", "--proto-redir", "=https",
                "--connect-timeout", "2", "--max-time", "3", "--max-filesize", "1048576", "--output"])
            .arg(&pending).arg(address).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().ok()?;
        if !status.success() || fs::metadata(&pending).ok()?.len() > 1_048_576 { return None; }
        let bytes = fs::read(&pending).ok()?;
        let extension = avatar_image_extension(&bytes)?;
        let path = directory.join(format!("{stem}.{extension}"));
        fs::rename(&pending, &path).ok()?;
        // Keep files for notification history, and expire only this cache's old images.
        for entry in fs::read_dir(&directory).ok()?.flatten() {
            let expired = entry.metadata().ok().filter(|metadata| metadata.is_file())
                .and_then(|metadata| metadata.modified().ok()).and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age > Duration::from_secs(7 * 86400));
            if expired {
                let _ = fs::remove_file(entry.path());
            }
        }
        Some(path)
    })();
    let _ = fs::remove_file(&pending);
    result
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
    fn avatars_only_load_from_chatwork_https_hosts() {
        assert!(is_avatar_url("https://appdata.chatwork.com/avatar/123.png"));
        assert!(is_avatar_url("https://kcw.kddi.ne.jp/avatar/123"));
        for address in ["https://chatwork.com.evil.test/a.png", "https://evilchatwork.com/a.png", "http://appdata.chatwork.com/a.png", "file:///C:/avatar.png"] {
            assert!(!is_avatar_url(address));
        }
    }
    #[test]
    fn downloaded_avatar_formats_are_recognized() {
        assert_eq!(avatar_image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(avatar_image_extension(&[0xff,0xd8,0xff,0xe0]), Some("jpg"));
        assert_eq!(avatar_image_extension(b"GIF89a"), Some("gif"));
        assert_eq!(avatar_image_extension(b"<html>Login</html>"), None);
        assert_eq!(avatar_image_extension(b""), None);
    }

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
