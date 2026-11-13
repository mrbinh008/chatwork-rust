// src/main.rs - Chatwork Desktop App (Rust reimplementation)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod config;
mod downloads;
mod menu;
mod notification;
mod save_dialog;
mod single_instance;
mod taskbar;
mod tray;
mod updater;

use app::{APP_NAME, APP_VERSION, CHATWORK_URL, USER_AGENT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP};
use config::{AppConfig, WindowParams};
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoop, EventLoopBuilder},
    window::{Icon, Window, WindowBuilder},
};
#[cfg(windows)]
use tao::platform::windows::WindowExtWindows;
use wry::{WebView, WebViewBuilder};
use tracing::{info, warn, error};
use tracing_subscriber::EnvFilter;
use std::sync::{Arc, Mutex};

#[allow(dead_code)]
#[derive(Debug)]
enum UserEvent {
    ShowNotification { title: String, body: String, id: Option<String>, target: Option<String>, icon: Option<String> },
    NotificationInteraction { id: Option<String>, target: Option<String>, activated: bool },
    SetBadge(u32),
    Navigate(String),
    StartDownload(String),
    Reload,
    ZoomIn,
    ZoomOut,
    ZoomReset,
    Quit,
    ShowWindow,
    HideWindow,
    SaveConfig,
    CheckUpdates(bool),
    DownloadUpdate,
    InstallUpdate,
    UpdateUiReady,
    Updater(updater::Event),
}

fn main() {
    let config_path = AppConfig::config_path();
    let mut instance = match single_instance::Instance::acquire(config_path.parent().expect("Config directory missing")) {
        Ok(single_instance::Launch::Primary(instance)) => instance,
        Ok(single_instance::Launch::Secondary) => return,
        Err(error) => { eprintln!("Cannot acquire THK-Chat instance lock: {error}"); return; }
    };
    // Automatically detect or configure WebView2 Runtime environment (Windows only)
    #[cfg(windows)]
    ensure_webview2_env();

    // Register AppUserModelId so Windows Toast displays "THK" & icon
    #[cfg(windows)]
    notification::register_app_user_model_id();

    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info"))
        )
        .init();

    info!("Starting {} v{}", APP_NAME, APP_VERSION);

    // Load persisted config
    let config = AppConfig::load();
    info!("Config loaded: zoom={}, tabs={}", config.zoom_factor, config.tabs.len());

    // Create event loop
    let event_loop: EventLoop<UserEvent> = EventLoopBuilder::with_user_event().build();
    let proxy = event_loop.create_proxy();
    {
        let focus_proxy = proxy.clone();
        instance.listen(move || { let _ = focus_proxy.send_event(UserEvent::ShowWindow); });
    }
    eprintln!("[DEBUG 6] event_loop created");

    // ── Build main window ────────────────────────────────────────────────────
    let wp = &config.window_params;
    let window = WindowBuilder::new()
        .with_title(APP_NAME)
        .with_inner_size(LogicalSize::new(wp.width, wp.height))
        .with_min_inner_size(LogicalSize::new(400u32, 300u32))
        .with_position(LogicalPosition::new(wp.x, wp.y))
        .with_maximized(wp.maximized)
        .with_window_icon(load_icon())
        .build(&event_loop)
        .expect("Failed to create window");

    // Initialize application menu bar
    let app_menu = menu::build_menu_bar();
    #[cfg(windows)]
    unsafe {
        let _ = app_menu.init_for_hwnd(window.hwnd() as _);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app_menu.init_for_nsapp();
    }

    // ── Build WebView ────────────────────────────────────────────────────────
    let initial_url = config.tabs.first()
        .map(|t| t.url.as_str())
        .unwrap_or(CHATWORK_URL)
        .to_string();

    let zoom = config.zoom_factor;

    let mut download_manager = downloads::DownloadManager::new(config.download_dir.as_deref());
    let save_dialog = save_dialog::SaveDialog::new(&window);
    let dismissed_downloads = std::rc::Rc::new(std::cell::RefCell::new(std::collections::HashSet::<String>::new()));
    let webview = match WebViewBuilder::new()
        .with_url(&initial_url)
        .with_user_agent(USER_AGENT)
        .with_hotkeys_zoom(false)
        .with_background_color((255, 255, 255, 255))
        .with_devtools(true)
        .with_initialization_script(&build_init_script(zoom))
        .with_ipc_handler({
            let proxy = proxy.clone();
            move |req: wry::http::Request<String>| handle_ipc_message(req.body(), &proxy)
        })
        .with_download_started_handler({
            let proxy = proxy.clone();
            let dismissed = dismissed_downloads.clone();
            move |url, path| {
                dismissed.borrow_mut().remove(&url);
                match download_manager.destination(path).and_then(|suggested| save_dialog.choose(&suggested)) {
                    Ok(Some(destination)) => {
                        download_manager.remember_destination(&destination);
                        info!("Downloading file to {}", destination.display());
                        *path = destination;
                        true
                    }
                    Ok(None) => { dismissed.borrow_mut().insert(url); false }
                    Err(error) => {
                        dismissed.borrow_mut().insert(url);
                        warn!("Cannot prepare download: {}", error);
                        let _ = proxy.send_event(UserEvent::ShowNotification { title: "Không tải được file".into(), body: error.to_string(), id: None, target: None, icon: None });
                        false
                    }
                }
            }
        })
        .with_download_completed_handler({
            let proxy = proxy.clone();
            let dismissed = dismissed_downloads.clone();
            move |url, path, success| {
                if dismissed.borrow_mut().remove(&url) && !success { return; }
                let body = if success { path.map(|path| format!("Đã lưu: {}", path.display())).unwrap_or_else(|| "File đã tải xong vào thư mục tải xuống.".into()) }
                    else { "Tải file thất bại hoặc đã bị hủy. Vui lòng thử lại.".into() };
                let _ = proxy.send_event(UserEvent::ShowNotification { title: if success { "Đã tải file".into() } else { "Không tải được file".into() }, body, id: None, target: None, icon: None });
            }
        })
        .with_navigation_handler(|url: String| is_allowed_url(&url))
        .with_new_window_req_handler({
            let proxy = proxy.clone();
            move |url: String, _features| {
                if is_message_link(&url) {
                    info!("Intercepted message link in new window request: {}", url);
                    let _ = proxy.send_event(UserEvent::Navigate(url));
                    wry::NewWindowResponse::Deny
                } else if downloads::is_download_url(&url) {
                    let _ = proxy.send_event(UserEvent::StartDownload(url));
                    wry::NewWindowResponse::Deny
                } else if !is_chatwork_url(&url) {
                    let _ = open::that(&url);
                    wry::NewWindowResponse::Deny
                } else {
                    wry::NewWindowResponse::Allow
                }
            }
        })
        .build(&window)
    {
        Ok(wv) => {
            info!("WebView successfully created");
            wv
        },
        Err(e) => {
            error!("Failed to create WebView: {:?}", e);
            handle_webview_failure(&e);
            return;
        }
    };

    // ── Shared state ─────────────────────────────────────────────────────────
    let state = Arc::new(Mutex::new(app::AppState {
        config,
        ..Default::default()
    }));

    // ── Taskbar Manager (Overlay badges) ──────────────────────────────────────
    let mut taskbar_mgr = taskbar::TaskbarManager::new();

    // ── System Tray ──────────────────────────────────────────────────────────
    let (rgba, w, h) = load_tray_icon_rgba();
    let tray = tray::build_tray(rgba, w, h);

    // ── Event loop ───────────────────────────────────────────────────────────
    let state_clone = state.clone();
    let proxy_clone = proxy.clone();
    let mut update_controller = updater::Controller::new();
    {
        let update_proxy = proxy.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(15));
            loop {
                if update_proxy.send_event(UserEvent::CheckUpdates(false)).is_err() { break; }
                std::thread::sleep(std::time::Duration::from_secs(6 * 60 * 60));
            }
        });
    }

    event_loop.run(move |event, _, control_flow| {
        let _keep_instance_lock = &instance;
        *control_flow = ControlFlow::Wait;

        match event {
            // ── Window events ──────────────────────────────────────────────
            Event::WindowEvent { event, window_id, .. } if window_id == window.id() => {
                match event {
                    WindowEvent::CloseRequested => {
                        window.set_visible(false);
                        info!("Window minimized to tray");
                    }
                    WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                        save_window_params(&window, &state_clone);
                    }
                    WindowEvent::Focused(focused) => {
                        if focused {
                            let mut s = state_clone.lock().unwrap();
                            if s.unread_count > 0 {
                                s.unread_count = 0;
                            }
                        }
                    }
                    _ => {}
                }
            }

            // ── Menu and Tray events ───────────────────────────────────────
            Event::MainEventsCleared => {
                // Check muda menu events
                while let Ok(menu_event) = muda::MenuEvent::receiver().try_recv() {
                    handle_menu_event(&menu_event.id.0, &window, &webview, &state_clone, &proxy_clone, control_flow);
                }

                // Check tray icon events
                while let Ok(tray_event) = tray_icon::TrayIconEvent::receiver().try_recv() {
                    match tray_event {
                        tray_icon::TrayIconEvent::Click {
                            button: tray_icon::MouseButton::Left,
                            ..
                        } => {
                            window.set_visible(true);
                            window.set_minimized(false);
                            window.set_focus();
                        }
                        _ => {}
                    }
                }
            }

            // ── Custom user events ─────────────────────────────────────────
            Event::UserEvent(evt) => {
                handle_user_event(evt, &window, &webview, &state_clone, &proxy_clone, &mut taskbar_mgr, tray.as_ref(), &mut update_controller, control_flow);
            }

            // ── Loop start ─────────────────────────────────────────────────
            Event::NewEvents(StartCause::Init) => {
                info!("Event loop started");
                window.set_visible(true);
            }

            _ => {}
        }
    });
}

// ── Helper functions ──────────────────────────────────────────────────────────

#[inline(never)]
fn embedded_text(bytes: &'static [u8]) -> &'static str {
    std::str::from_utf8(bytes).expect("Embedded UI assets must be valid UTF-8")
}

#[cfg(test)]
mod ui_asset_tests {
    #[test]
    fn initialization_contains_complete_valid_ui_sources() {
        let script=super::build_init_script(1.0);
        let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        for name in ["injected.js","toolkit.js","room-folders.js","downloads.js","files.js","file-preview.js","update-ui.js"] {
            let source=std::fs::read_to_string(root.join(name)).unwrap().replace("__ZOOM__","1").replace("__VERSION__",crate::app::APP_VERSION);
            assert!(script.contains(&source),"Embedded script differs from source: {name}");
        }
        let css=std::fs::read_to_string(root.join("ui.css")).unwrap();
        assert!(script.contains(&serde_json::to_string(&css).unwrap()));
    }
}

fn build_init_script(zoom: f64) -> String {
    let css = serde_json::to_string(embedded_text(include_bytes!("ui.css"))).expect("UI CSS is serializable");
    let brand_icon = serde_json::to_string(include_str!("../assets/branding/icon.svg")).expect("Brand icon is serializable");
    let script = format!("window.__thk_ui_css = {}; window.__thk_brand_icon_svg = {};\n{}\n{}\n{}\n{}\n{}\n{}\n{}", css, brand_icon,
        embedded_text(include_bytes!("injected.js")), embedded_text(include_bytes!("toolkit.js")),
        embedded_text(include_bytes!("room-folders.js")),
        embedded_text(include_bytes!("downloads.js")), embedded_text(include_bytes!("files.js")),
        embedded_text(include_bytes!("file-preview.js")), embedded_text(include_bytes!("update-ui.js")));
    script
        .replace("__ZOOM__", &zoom.to_string())
        .replace("__VERSION__", APP_VERSION)
}

fn handle_ipc_message(msg: &str, proxy: &tao::event_loop::EventLoopProxy<UserEvent>) {
    match serde_json::from_str::<app::IpcMessage>(msg) {
        Ok(ipc_msg) => {
            info!("IPC message: {:?}", ipc_msg);
            match ipc_msg {
                app::IpcMessage::ShowNotification { title, body, id, target, icon } => {
                    let _ = proxy.send_event(UserEvent::ShowNotification { title, body, id, target, icon });
                }
                app::IpcMessage::SetBadgeCount(n) => {
                    let _ = proxy.send_event(UserEvent::SetBadge(n));
                }
                app::IpcMessage::GoBack => {
                    let _ = proxy.send_event(UserEvent::Reload);
                }
                app::IpcMessage::Logout => {
                    let _ = proxy.send_event(UserEvent::Navigate(CHATWORK_URL.to_string()));
                }
                app::IpcMessage::WriteLogError(msg) => {
                    error!("Renderer error: {}", msg);
                }
                app::IpcMessage::CheckForUpdates => { let _ = proxy.send_event(UserEvent::CheckUpdates(true)); }
                app::IpcMessage::DownloadUpdate => { let _ = proxy.send_event(UserEvent::DownloadUpdate); }
                app::IpcMessage::InstallUpdate => { let _ = proxy.send_event(UserEvent::InstallUpdate); }
                app::IpcMessage::UpdateUiReady => { let _ = proxy.send_event(UserEvent::UpdateUiReady); }
                _ => {}
            }
        }
        Err(e) => {
            warn!("Failed to parse IPC message '{}': {}", msg, e);
        }
    }
}

fn handle_menu_event(
    id: &str,
    window: &Window,
    webview: &WebView,
    state: &Arc<Mutex<app::AppState>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    control_flow: &mut ControlFlow,
) {
    use menu::ids::*;
    use tray::tray_ids::*;

    match id {
        FILE_QUIT | TRAY_QUIT => {
            save_config_now(state);
            *control_flow = ControlFlow::Exit;
        }
        FILE_CLOSE_WINDOW => {
            window.set_visible(false);
        }
        TRAY_SHOW => {
            window.set_visible(true);
            window.set_minimized(false);
            window.set_focus();
        }
        VIEW_ZOOM_IN | TRAY_ZOOM_IN => {
            let zoom = zoom_adjust(state, ZOOM_STEP);
            apply_zoom(webview, zoom);
        }
        VIEW_ZOOM_OUT | TRAY_ZOOM_OUT => {
            let zoom = zoom_adjust(state, -ZOOM_STEP);
            apply_zoom(webview, zoom);
        }
        VIEW_ZOOM_RESET | TRAY_ZOOM_RESET => {
            zoom_set(state, 1.0);
            apply_zoom(webview, 1.0);
        }
        VIEW_RELOAD => {
            let _ = webview.evaluate_script("window.location.reload()");
        }
        VIEW_DEVTOOLS => {
            webview.open_devtools();
        }
        VIEW_TOGGLE_HEADER => {
            let show = {
                let mut s = state.lock().unwrap();
                s.config.show_header = !s.config.show_header;
                s.config.show_header
            };
            let script = format!(
                "document.querySelector('header')?.style.display = '{}';",
                if show { "block" } else { "none" }
            );
            let _ = webview.evaluate_script(&script);
        }
        VIEW_TOGGLE_FOOTER => {
            let show = {
                let mut s = state.lock().unwrap();
                s.config.show_footer = !s.config.show_footer;
                s.config.show_footer
            };
            let script = format!(
                "document.querySelector('footer')?.style.display = '{}';",
                if show { "block" } else { "none" }
            );
            let _ = webview.evaluate_script(&script);
        }
        GO_BACK => {
            let _ = webview.evaluate_script("history.back()");
        }
        GO_FORWARD => {
            let _ = webview.evaluate_script("history.forward()");
        }
        WIN_MINIMIZE => {
            window.set_minimized(true);
        }
        WIN_MAXIMIZE => {
            window.set_maximized(!window.is_maximized());
        }
        HELP_ABOUT => {
            show_about_dialog();
        }
        HELP_CHECK_UPDATES => {
            let _ = proxy.send_event(UserEvent::CheckUpdates(true));
        }
        HELP_SUPPORT => {
            let _ = open::that("https://support-en.chatwork.com/hc/en-us");
        }
        _ => {}
    }
}

fn handle_user_event(
    event: UserEvent,
    window: &Window,
    webview: &WebView,
    state: &Arc<Mutex<app::AppState>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    taskbar_mgr: &mut taskbar::TaskbarManager,
    tray: Option<&tray_icon::TrayIcon>,
    updater: &mut updater::Controller,
    control_flow: &mut ControlFlow,
) {
    match event {
        UserEvent::CheckUpdates(interactive) => {
            updater.check(interactive, proxy.clone());
            publish_update_status(updater, webview);
        }
        UserEvent::DownloadUpdate => {
            updater.download(proxy.clone());
            publish_update_status(updater, webview);
        }
        UserEvent::Updater(event) => {
            updater.handle(event);
            publish_update_status(updater, webview);
        }
        UserEvent::UpdateUiReady => {
            updater.previous_result();
            publish_update_status(updater, webview);
        }
        UserEvent::InstallUpdate => {
            match updater.install() {
                Ok(()) => { save_config_now(state); *control_flow = ControlFlow::Exit; }
                Err(error) => updater.fail(error),
            }
            publish_update_status(updater, webview);
        }
        UserEvent::ShowNotification { title, body, id, target, icon } => {
            let unread = state.lock().unwrap().unread_count;
            let notification_proxy = proxy.clone();
            std::thread::spawn(move || {
                notification::show_notification(&title, &body, Some(notification_proxy), unread, id, target, icon.as_deref());
            });
            #[cfg(windows)]
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::FlashWindow(
                    window.hwnd() as _,
                    1,
                );
            }
        }
        UserEvent::SetBadge(count) => {
            {
                let mut s = state.lock().unwrap();
                s.unread_count = count;
            }
            update_window_title(window, count);
            taskbar_mgr.set_badge(window, count);
            if let Some(t) = tray {
                let tooltip = if count > 0 {
                    format!("[{}] {}", count, APP_NAME)
                } else {
                    APP_NAME.to_string()
                };
                let _ = t.set_tooltip(Some(tooltip));
            }
        }
        UserEvent::StartDownload(url) => {
            let url = serde_json::to_string(&url).expect("Download URL is serializable");
            let _ = webview.evaluate_script(&format!("window.__thk_startDownload && window.__thk_startDownload({url});"));
        }
        UserEvent::Navigate(url) => {
            let target = serde_json::to_string(&url).expect("URL is serializable");
            let script = format!(
                "if (!window.__thk_navigateToMessage || !window.__thk_navigateToMessage({0})) window.location.href = {0};",
                target
            );
            let _ = webview.evaluate_script(&script);
        }
        UserEvent::NotificationInteraction { id, target, activated } => {
            if activated {
                window.set_visible(true);
                window.set_minimized(false);
                window.set_focus();
            }
            if let Some(id) = id {
                let id = serde_json::to_string(&id).expect("Notification ID is serializable");
                let target = serde_json::to_string(&target).expect("Notification target is serializable");
                let script = if activated {
                    format!("if (!window.__thk_notificationClicked?.({id}) && {target}) window.__thk_navigateToMessage?.({target});")
                } else {
                    format!("window.__thk_notificationClosed?.({id});")
                };
                let _ = webview.evaluate_script(&script);
            }
        }
        UserEvent::Reload => {
            let _ = webview.evaluate_script("window.location.reload()");
        }
        UserEvent::ZoomIn => {
            let zoom = zoom_adjust(state, ZOOM_STEP);
            apply_zoom(webview, zoom);
        }
        UserEvent::ZoomOut => {
            let zoom = zoom_adjust(state, -ZOOM_STEP);
            apply_zoom(webview, zoom);
        }
        UserEvent::ZoomReset => {
            zoom_set(state, 1.0);
            apply_zoom(webview, 1.0);
        }
        UserEvent::ShowWindow => {
            window.set_visible(true);
            window.set_minimized(false);
            window.set_focus();
        }
        UserEvent::HideWindow => {
            window.set_visible(false);
        }
        UserEvent::SaveConfig => {
            save_config_now(state);
        }
        UserEvent::Quit => {
            save_config_now(state);
            *control_flow = ControlFlow::Exit;
        }
    }
}

fn publish_update_status(updater: &mut updater::Controller, webview: &WebView) {
    if let Ok(status) = serde_json::to_string(&updater.status) {
        let _ = webview.evaluate_script(&format!("window.__thk_updateState?.({status});"));
    }
    updater.status.open = false;
}

fn is_allowed_url(url: &str) -> bool {
    let lower = url.to_lowercase();

    // 1. Internal browser schemes
    if lower.starts_with("about:")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("javascript:")
    {
        return true;
    }

    // 2. Chatwork and KDDI domains (all subdomains: auth, oauth, www, app, api, etc.)
    if lower.contains("chatwork.com")
        || lower.contains("kcw.kddi.ne.jp")
        || lower.contains("kcw.kddi.com")
    {
        return true;
    }

    // 3. SSO and OAuth authentication providers
    if lower.contains("auth0.com")
        || lower.contains("google.com")
        || lower.contains("gstatic.com")
        || lower.contains("apple.com")
        || lower.contains("appleid.apple.com")
        || lower.contains("microsoft.com")
        || lower.contains("microsoftonline.com")
        || lower.contains("live.com")
        || lower.contains("twitter.com")
        || lower.contains("x.com")
        || lower.contains("linkedin.com")
    {
        return true;
    }

    // 4. External links: open in external browser and do not navigate within Chatwork window
    info!("Intercepted external navigation to default browser: {}", url);
    let _ = open::that(url);
    false
}

fn is_message_link(url: &str) -> bool {
    let lower = url.to_lowercase();
    (lower.contains("chatwork.com") || lower.contains("kcw.kddi.ne.jp") || lower.contains("kcw.kddi.com"))
        && (lower.contains("#!rid") || lower.contains("#_rid"))
}

fn is_chatwork_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("chatwork.com")
        || lower.contains("kcw.kddi.ne.jp")
        || lower.contains("kcw.kddi.com")
        || lower.contains("auth0.com")
}

fn apply_zoom(webview: &WebView, zoom: f64) {
    let script = format!("document.documentElement.style.zoom = '{}';", zoom);
    let _ = webview.evaluate_script(&script);
    info!("Zoom set to {:.1}", zoom);
}

fn zoom_adjust(state: &Arc<Mutex<app::AppState>>, delta: f64) -> f64 {
    let mut s = state.lock().unwrap();
    let new_zoom = (s.config.zoom_factor + delta).clamp(ZOOM_MIN, ZOOM_MAX);
    let new_zoom = (new_zoom * 10.0).round() / 10.0;
    s.config.zoom_factor = new_zoom;
    new_zoom
}

fn zoom_set(state: &Arc<Mutex<app::AppState>>, zoom: f64) {
    let mut s = state.lock().unwrap();
    s.config.zoom_factor = zoom;
}

fn update_window_title(window: &Window, unread: u32) {
    if unread > 0 {
        window.set_title(&format!(
            "[{}] {}",
            notification::format_badge_count(unread),
            APP_NAME
        ));
    } else {
        window.set_title(APP_NAME);
    }
}

fn save_window_params(window: &Window, state: &Arc<Mutex<app::AppState>>) {
    let size: LogicalSize<u32> = window.inner_size().to_logical(window.scale_factor());
    let pos = window.outer_position().ok().map(|p| p.to_logical::<i32>(window.scale_factor()));

    let mut s = state.lock().unwrap();
    s.config.window_params = WindowParams {
        width: size.width,
        height: size.height,
        x: pos.map(|p| p.x).unwrap_or(0),
        y: pos.map(|p| p.y).unwrap_or(0),
        maximized: window.is_maximized(),
        fullscreen: window.fullscreen().is_some(),
    };
}

fn save_config_now(state: &Arc<Mutex<app::AppState>>) {
    let config = {
        let s = state.lock().unwrap();
        s.config.clone()
    };
    config.save();
    info!("Config saved");
}

fn show_about_dialog() {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let title: Vec<u16> = OsStr::new("About THK-Chat")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let msg: Vec<u16> = OsStr::new(&format!(
            "THK-Chat Desktop App\nTeam Communication Client\nVersion {}\n\nPowered by Rust & WebView2",
            APP_VERSION
        ))
        .encode_wide()
        .chain(Some(0))
        .collect();

        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                std::ptr::null_mut(),
                msg.as_ptr(),
                title.as_ptr(),
                windows_sys::Win32::UI::WindowsAndMessaging::MB_OK | windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONINFORMATION,
            );
        }
    }
    #[cfg(target_os = "macos")]
    {
        use objc::{msg_send, sel, sel_impl};
        use objc::runtime::Class;
        unsafe {
            if let Some(cls) = Class::get("NSApplication") {
                let app: *mut objc::runtime::Object = msg_send![cls, sharedApplication];
                if !app.is_null() {
                    let nil: *mut objc::runtime::Object = std::ptr::null_mut();
                    let () = msg_send![app, orderFrontStandardAboutPanel: nil];
                }
            }
        }
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        info!("THK-Chat Desktop App v{}", APP_VERSION);
    }
}

fn load_icon() -> Option<Icon> {
    const RGBA: &[u8] = include_bytes!("../assets/thk_32.rgba");
    Icon::from_rgba(RGBA.to_vec(), 32, 32).ok()
}

fn load_tray_icon_rgba() -> (Vec<u8>, u32, u32) {
    const RGBA: &[u8] = include_bytes!("../assets/thk_16.rgba");
    (RGBA.to_vec(), 16, 16)
}

#[cfg(windows)]
fn ensure_webview2_env() {
    #[cfg(windows)]
    {
        // 1. Isolate user data folder into %APPDATA%\Chatwork\WebView2Data
        if std::env::var("WEBVIEW2_USER_DATA_FOLDER").is_err() {
            let base = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
            let user_data_dir = base.join("Chatwork").join("WebView2Data");
            let _ = std::fs::create_dir_all(&user_data_dir);
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", user_data_dir);
        }

        // Prevent black screen issues and background throttling when minimized
        if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGS").is_err() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGS",
                "--disable-features=CalculateNativeWinOcclusion,msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding",
            );
        }

        // 2. Check if runtime folder is already specified
        if std::env::var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER").is_ok() {
            return;
        }

        // 3. Search common locations for WebView2 or Edge installation
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".to_string());
        let program_files = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".to_string());
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| String::new());

        let mut candidate_bases = vec![
            format!(r"{}\Microsoft\EdgeWebView\Application", program_files_x86),
            format!(r"{}\Microsoft\EdgeWebView\Application", program_files),
            format!(r"{}\Microsoft\Edge\Application", program_files_x86),
            format!(r"{}\Microsoft\Edge\Application", program_files),
        ];
        if !local_app_data.is_empty() {
            candidate_bases.push(format!(r"{}\Microsoft\EdgeWebView\Application", local_app_data));
        }

        for base in candidate_bases {
            let path = std::path::Path::new(&base);
            if !path.exists() {
                continue;
            }

            if let Ok(entries) = std::fs::read_dir(path) {
                let mut versions: Vec<std::path::PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        p.is_dir()
                            && (p.join("msedgewebview2.exe").exists() || p.join("msedge.exe").exists())
                    })
                    .collect();

                versions.sort_by(|a, b| b.cmp(a));

                if let Some(newest) = versions.first() {
                    info!("Auto-detected WebView2 runtime at: {:?}", newest);
                    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", newest);
                    return;
                }
            }
        }
    }
}

fn handle_webview_failure(err: &wry::Error) {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let title: Vec<u16> = OsStr::new("Chatwork - Lỗi khởi tạo WebView2")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let msg: Vec<u16> = OsStr::new(&format!(
            "Không thể khởi tạo Microsoft Edge WebView2 Runtime:\n\n{:?}\n\nỨng dụng Chatwork Desktop cần WebView2 Runtime để hoạt động.\nBạn có muốn mở trang tải WebView2 chính thức của Microsoft không?",
            err
        ))
        .encode_wide()
        .chain(Some(0))
        .collect();

        unsafe {
            let res = windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                std::ptr::null_mut(),
                msg.as_ptr(),
                title.as_ptr(),
                windows_sys::Win32::UI::WindowsAndMessaging::MB_YESNO | windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONERROR,
            );
            if res == windows_sys::Win32::UI::WindowsAndMessaging::IDYES {
                let _ = open::that("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            }
        }
    }
    #[cfg(not(windows))]
    {
        error!("WebView initialization failure: {:?}", err);
    }
}
