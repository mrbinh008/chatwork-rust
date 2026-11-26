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
    event_loop::{ControlFlow, EventLoop, EventLoopBuilder, EventLoopWindowTarget},
    window::{Icon, Window, WindowBuilder},
};
#[cfg(windows)]
use tao::platform::windows::WindowExtWindows;
use wry::{WebView, WebViewBuilder};
use tracing::{info, warn, error};
use tracing_subscriber::EnvFilter;
use std::sync::{Arc, Mutex};

struct MiniAppPopup {
    // Drop webview before window so WebView2 detaches cleanly before HWND destruction.
    webview: WebView,
    window: Window,
}

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
    SetAppIcon(String),
    OpenMiniApp { url: String, title: Option<String> },
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

    // Load persisted config
    let config = AppConfig::load();
    let initial_icon_variant = normalize_icon_variant(config.app_icon.as_deref().unwrap_or("original"));

    // Register AppUserModelId so Windows Toast displays "THK" & icon matching active variant
    #[cfg(windows)]
    notification::register_app_user_model_id_for_variant(initial_icon_variant);

    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info"))
        )
        .init();

    info!("Starting {} v{}", APP_NAME, APP_VERSION);
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
        .with_window_icon(load_icon_for_variant(initial_icon_variant))
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
    let (rgba, w, h) = load_tray_icon_rgba_for_variant(initial_icon_variant);
    let tray = tray::build_tray(rgba, w, h);

    // ── Event loop ───────────────────────────────────────────────────────────
    let state_clone = state.clone();
    let proxy_clone = proxy.clone();
    let mut update_controller = updater::Controller::new();
    let mut mini_app_popup: Option<MiniAppPopup> = None;
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

    event_loop.run(move |event, event_loop_target, control_flow| {
        let _keep_instance_lock = &instance;
        *control_flow = ControlFlow::Wait;

        match event {
            // ── Main window events ─────────────────────────────────────────
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

            // ── Mini app popup window events ───────────────────────────────
            Event::WindowEvent { event, window_id, .. }
                if mini_app_popup.as_ref().is_some_and(|p| p.window.id() == window_id) =>
            {
                if let WindowEvent::CloseRequested = event {
                    info!("Closing mini app popup window");
                    mini_app_popup = None;
                }
            }

            // ── Menu and Tray events ───────────────────────────────────────
            Event::MainEventsCleared => {
                // Check muda menu events
                while let Ok(menu_event) = muda::MenuEvent::receiver().try_recv() {
                    handle_menu_event(&menu_event.id.0, &window, &webview, &mut mini_app_popup, &state_clone, &proxy_clone, control_flow);
                }

                // Check tray icon events
                while let Ok(tray_event) = tray_icon::TrayIconEvent::receiver().try_recv() {
                    match tray_event {
                        tray_icon::TrayIconEvent::Click {
                            button: tray_icon::MouseButton::Left,
                            ..
                        } => {
                            present_window(&window);
                        }
                        _ => {}
                    }
                }
            }

            // ── Custom user events ─────────────────────────────────────────
            Event::UserEvent(evt) => {
                handle_user_event(evt, &window, &webview, &mut mini_app_popup, event_loop_target, &state_clone, &proxy_clone, &mut taskbar_mgr, tray.as_ref(), &mut update_controller, control_flow);
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
    let brand_icons = serde_json::json!({
        "original": include_str!("../assets/branding/icon.svg"),
        "thk-signature": include_str!("../assets/branding/icon-signature.svg"),
        "dog": include_str!("../assets/branding/icon-dog.svg"),
    });
    let brand_icons_json = serde_json::to_string(&brand_icons).expect("Brand icons serializable");
    let script = format!("window.__thk_ui_css = {}; window.__thk_brand_icons = {}; window.__thk_brand_icon_svg = {};\n{}\n{}\n{}\n{}\n{}\n{}\n{}", css, brand_icons_json, brand_icon,
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
                app::IpcMessage::SetAppIcon(variant) => { let _ = proxy.send_event(UserEvent::SetAppIcon(variant)); }
                app::IpcMessage::OpenMiniApp { url, title } => {
                    let _ = proxy.send_event(UserEvent::OpenMiniApp { url, title });
                }
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
    mini_app_popup: &mut Option<MiniAppPopup>,
    state: &Arc<Mutex<app::AppState>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    control_flow: &mut ControlFlow,
) {
    use menu::ids::*;
    use tray::tray_ids::*;

    match id {
        FILE_QUIT | TRAY_QUIT => {
            *mini_app_popup = None;
            save_config_now(state);
            *control_flow = ControlFlow::Exit;
        }
        FILE_CLOSE_WINDOW => {
            window.set_visible(false);
        }
        TRAY_SHOW => {
            present_window(window);
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
        APP_SETTINGS => {
            let _ = webview.evaluate_script("window.__thkToolkit?.openSettings?.();");
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
    mini_app_popup: &mut Option<MiniAppPopup>,
    event_loop_target: &EventLoopWindowTarget<UserEvent>,
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
                Ok(()) => { *mini_app_popup = None; save_config_now(state); *control_flow = ControlFlow::Exit; }
                Err(error) => updater.fail(error),
            }
            publish_update_status(updater, webview);
        }
        UserEvent::ShowNotification { title, body, id, target, icon } => {
            let (unread, app_icon) = {
                let s = state.lock().unwrap();
                (s.unread_count, s.config.app_icon.clone())
            };
            let notification_proxy = proxy.clone();
            std::thread::spawn(move || {
                notification::show_notification(
                    &title,
                    &body,
                    Some(notification_proxy),
                    unread,
                    id,
                    target,
                    icon.as_deref(),
                    app_icon.as_deref(),
                );
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
                present_window(window);
            }
            if let Some(script) = build_notification_interaction_script(id.as_deref(), target.as_deref(), activated) {
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
            present_window(window);
        }
        UserEvent::HideWindow => {
            window.set_visible(false);
        }
        UserEvent::SaveConfig => {
            save_config_now(state);
        }
        UserEvent::SetAppIcon(variant) => {
            let normalized = normalize_icon_variant(&variant);
            info!("Changing app icon to variant: {}", normalized);
            {
                let mut s = state.lock().unwrap();
                s.config.app_icon = Some(normalized.to_string());
            }
            save_config_now(state);
            #[cfg(windows)]
            notification::update_app_icon_registry(normalized);
            if let Some(w_icon) = load_icon_for_variant(normalized) {
                window.set_window_icon(Some(w_icon));
            }
            if let Some(popup) = mini_app_popup.as_ref() {
                if let Some(p_icon) = load_icon_for_variant(normalized) {
                    popup.window.set_window_icon(Some(p_icon));
                }
            }
            if let Some(t) = tray {
                let (rgba, w, h) = load_tray_icon_rgba_for_variant(normalized);
                if let Ok(t_icon) = tray_icon::Icon::from_rgba(rgba, w, h) {
                    let _ = t.set_icon(Some(t_icon));
                }
            }
        }
        UserEvent::OpenMiniApp { url, title } => {
            open_mini_app_popup(window, webview, mini_app_popup, event_loop_target, state, proxy, &url, title.as_deref());
        }
        UserEvent::Quit => {
            *mini_app_popup = None;
            save_config_now(state);
            *control_flow = ControlFlow::Exit;
        }
    }
}

fn present_window(window: &Window) {
    window.set_visible(true);
    window.set_minimized(false);
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
        };
        let hwnd = window.hwnd() as _;
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        } else {
            ShowWindow(hwnd, SW_SHOW);
        }
        SetForegroundWindow(hwnd);
    }
    #[cfg(target_os = "macos")]
    unsafe {
        use objc::runtime::{Class, Object, YES};
        use objc::{msg_send, sel, sel_impl};
        if let Some(cls) = Class::get("NSApplication") {
            let app: *mut Object = msg_send![cls, sharedApplication];
            if !app.is_null() {
                let nil: *mut Object = std::ptr::null_mut();
                let _: () = msg_send![app, unhide: nil];
                let _: () = msg_send![app, activateIgnoringOtherApps: YES];
            }
        }
    }
    window.set_focus();
}

fn open_mini_app_popup(
    main_window: &Window,
    main_webview: &WebView,
    mini_app_popup: &mut Option<MiniAppPopup>,
    event_loop_target: &EventLoopWindowTarget<UserEvent>,
    state: &Arc<Mutex<app::AppState>>,
    proxy: &tao::event_loop::EventLoopProxy<UserEvent>,
    url: &str,
    title: Option<&str>,
) {
    let target_url = url.trim();
    if !is_allowed_mini_app_url(target_url) {
        warn!("Rejected unauthorized mini app URL: {}", url);
        return;
    }
    let popup_title = title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(app::ATTENDANCE_MINI_APP_TITLE);

    if let Some(popup) = mini_app_popup.as_ref() {
        popup.window.set_title(popup_title);
        present_window(&popup.window);
        if popup.webview.url().ok().is_some_and(|current| !is_allowed_mini_app_navigation(&current)) {
            let _ = popup.webview.load_url(target_url);
        }
        return;
    }

    let scale = main_window.scale_factor();
    let main_size: LogicalSize<u32> = main_window.inner_size().to_logical(scale);
    let main_pos = main_window
        .outer_position()
        .ok()
        .map(|p| p.to_logical::<i32>(scale))
        .map(|p| (p.x, p.y))
        .unwrap_or((100, 100));
    let (mon_pos, mon_size) = main_window
        .current_monitor()
        .or_else(|| main_window.primary_monitor())
        .map(|m| {
            let ms = m.scale_factor();
            let p: LogicalPosition<i32> = m.position().to_logical(ms);
            let s: LogicalSize<u32> = m.size().to_logical(ms);
            ((p.x, p.y), (s.width, s.height))
        })
        .unwrap_or(((0, 0), (1440, 900)));
    let (x, y, width, height) = compute_mini_app_bounds(
        main_pos,
        (main_size.width, main_size.height),
        mon_pos,
        mon_size,
    );

    let icon_variant = {
        let s = state.lock().unwrap();
        normalize_icon_variant(s.config.app_icon.as_deref().unwrap_or("original")).to_string()
    };

    let popup_window = match WindowBuilder::new()
        .with_title(popup_title)
        .with_inner_size(LogicalSize::new(width, height))
        .with_min_inner_size(LogicalSize::new(380u32, 540u32))
        .with_position(LogicalPosition::new(x, y))
        .with_window_icon(load_icon_for_variant(&icon_variant))
        .build(event_loop_target)
    {
        Ok(win) => win,
        Err(e) => {
            error!("Failed to create mini app popup window: {:?}", e);
            return;
        }
    };

    let nav_proxy = proxy.clone();
    let new_win_proxy = proxy.clone();
    let mut builder = WebViewBuilder::new()
        .with_url(target_url)
        .with_background_color((248, 250, 252, 255))
        .with_devtools(true)
        .with_navigation_handler(move |nav_url: String| handle_mini_app_navigation(&nav_url, &nav_proxy))
        .with_new_window_req_handler(move |new_url: String, _features| handle_mini_app_new_window(&new_url, &new_win_proxy));

    #[cfg(windows)]
    {
        use wry::{WebViewBuilderExtWindows, WebViewExtWindows};
        builder = builder.with_environment(main_webview.environment());
    }
    #[cfg(not(windows))]
    {
        let _ = main_webview;
    }

    match builder.build(&popup_window) {
        Ok(popup_webview) => {
            info!("Opened mini app popup: {}", target_url);
            present_window(&popup_window);
            *mini_app_popup = Some(MiniAppPopup {
                webview: popup_webview,
                window: popup_window,
            });
        }
        Err(e) => {
            error!("Failed to create mini app WebView: {:?}", e);
            let _ = open::that(target_url);
        }
    }
}

fn compute_mini_app_bounds(
    main_pos: (i32, i32),
    main_size: (u32, u32),
    monitor_pos: (i32, i32),
    monitor_size: (u32, u32),
) -> (i32, i32, u32, u32) {
    let max_w = monitor_size.0.saturating_sub(40).max(380).min(monitor_size.0.max(380));
    let max_h = monitor_size.1.saturating_sub(80).max(540).min(monitor_size.1.max(540));
    let width = 540u32.min(max_w);
    let height = 780u32.min(max_h);
    let ideal_x = main_pos.0 + ((main_size.0 as i32 - width as i32) / 2);
    let ideal_y = main_pos.1 + ((main_size.1 as i32 - height as i32) / 2);
    let min_x = monitor_pos.0;
    let min_y = monitor_pos.1;
    let max_x = monitor_pos.0 + (monitor_size.0 as i32 - width as i32).max(0);
    let max_y = monitor_pos.1 + (monitor_size.1 as i32 - height as i32).max(0);
    (ideal_x.clamp(min_x, max_x), ideal_y.clamp(min_y, max_y), width, height)
}

fn extract_https_host(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.len() < 8 || !trimmed[..8].eq_ignore_ascii_case("https://") {
        return None;
    }
    let rest = &trimmed[8..];
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty()
        || authority.contains('@')
        || authority.contains('\\')
        || authority.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return None;
    }
    let host = match authority.split_once(':') {
        Some((h, port)) => {
            if port.is_empty() || !port.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            h
        }
        None => authority,
    };
    if host.is_empty() || host.starts_with('.') || host.ends_with('.') || host.contains("..") {
        return None;
    }
    Some(host.to_ascii_lowercase())
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

fn is_allowed_mini_app_url(url: &str) -> bool {
    extract_https_host(url).is_some_and(|host| host == app::ATTENDANCE_MINI_APP_HOST)
}

fn is_allowed_mini_app_navigation(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    if lower.starts_with("about:")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("javascript:")
    {
        return true;
    }
    let Some(host) = extract_https_host(url) else {
        return false;
    };
    if host_matches(&host, "thk-hd-hn.vn") {
        return true;
    }
    [
        "auth0.com",
        "google.com",
        "gstatic.com",
        "googleapis.com",
        "accounts.youtube.com",
        "apple.com",
        "appleid.apple.com",
        "microsoft.com",
        "microsoftonline.com",
        "live.com",
    ]
    .iter()
    .any(|domain| host_matches(&host, domain))
}

fn is_external_openable_scheme(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:")
        || lower.starts_with("tel:")
}

fn handle_mini_app_navigation(url: &str, proxy: &tao::event_loop::EventLoopProxy<UserEvent>) -> bool {
    if is_allowed_mini_app_navigation(url) {
        return true;
    }
    if is_message_link(url) {
        let _ = proxy.send_event(UserEvent::ShowWindow);
        let _ = proxy.send_event(UserEvent::Navigate(url.to_string()));
        return false;
    }
    if is_external_openable_scheme(url) {
        info!("Mini app opening external link in default browser: {}", url);
        let _ = open::that(url);
    }
    false
}

fn handle_mini_app_new_window(url: &str, proxy: &tao::event_loop::EventLoopProxy<UserEvent>) -> wry::NewWindowResponse {
    if url.trim().eq_ignore_ascii_case("about:blank") || is_allowed_mini_app_navigation(url) {
        return wry::NewWindowResponse::Allow;
    }
    if is_message_link(url) {
        let _ = proxy.send_event(UserEvent::ShowWindow);
        let _ = proxy.send_event(UserEvent::Navigate(url.to_string()));
        return wry::NewWindowResponse::Deny;
    }
    if is_external_openable_scheme(url) {
        let _ = open::that(url);
    }
    wry::NewWindowResponse::Deny
}

#[cfg(test)]
mod mini_app_policy_tests {
    use super::*;

    #[test]
    fn mini_app_entry_url_allows_only_exact_attendance_https_host() {
        assert!(is_allowed_mini_app_url("https://attendance.thk-hd-hn.vn/"));
        assert!(is_allowed_mini_app_url("https://attendance.thk-hd-hn.vn/requests?tab=leave"));
        assert!(is_allowed_mini_app_url("HTTPS://ATTENDANCE.THK-HD-HN.VN/"));
        assert!(!is_allowed_mini_app_url("http://attendance.thk-hd-hn.vn/"));
        assert!(!is_allowed_mini_app_url("https://attendance.thk-hd-hn.vn.evil.test/"));
        assert!(!is_allowed_mini_app_url("https://attendance.thk-hd-hn.vn@evil.test/"));
        assert!(!is_allowed_mini_app_url("https://evil.test/?https://attendance.thk-hd-hn.vn/"));
        assert!(!is_allowed_mini_app_url("https://sub.attendance.thk-hd-hn.vn/"));
        assert!(!is_allowed_mini_app_url("javascript:alert(1)"));
        assert!(!is_allowed_mini_app_url("file:///attendance.thk-hd-hn.vn"));
        assert!(!is_allowed_mini_app_url(""));
    }

    #[test]
    fn mini_app_navigation_allows_thk_and_sso_but_rejects_foreign_hosts() {
        assert!(is_allowed_mini_app_navigation("https://attendance.thk-hd-hn.vn/auth/google/callback"));
        assert!(is_allowed_mini_app_navigation("https://api.thk-hd-hn.vn/v1/auth"));
        assert!(is_allowed_mini_app_navigation("https://accounts.google.com/o/oauth2/v2/auth"));
        assert!(is_allowed_mini_app_navigation("https://accounts.youtube.com/accounts/SetSID"));
        assert!(is_allowed_mini_app_navigation("about:blank"));
        assert!(!is_allowed_mini_app_navigation("https://google.com.evil.test/"));
        assert!(!is_allowed_mini_app_navigation("https://evil.test/"));
        assert!(!is_allowed_mini_app_navigation("http://attendance.thk-hd-hn.vn/"));
    }

    #[test]
    fn mini_app_bounds_center_over_main_window_and_clamp_to_small_screens() {
        assert_eq!(
            compute_mini_app_bounds((100, 50), (1200, 800), (0, 0), (1920, 1080)),
            (430, 60, 540, 780)
        );
        // Small 1366x768 laptop screen clamps height cleanly inside monitor.
        let (x, y, w, h) = compute_mini_app_bounds((0, 0), (1366, 768), (0, 0), (1366, 768));
        assert_eq!(w, 540);
        assert_eq!(h, 688);
        assert!(x >= 0 && y >= 0 && x + w as i32 <= 1366 && y + h as i32 <= 768);
    }

    #[test]
    fn ipc_message_deserializes_open_mini_app() {
        let parsed: app::IpcMessage = serde_json::from_str(
            r#"{"type":"OpenMiniApp","payload":{"url":"https://attendance.thk-hd-hn.vn/","title":"THK Quick Leave"}}"#,
        )
        .expect("OpenMiniApp IPC should parse");
        match parsed {
            app::IpcMessage::OpenMiniApp { url, title } => {
                assert_eq!(url, "https://attendance.thk-hd-hn.vn/");
                assert_eq!(title.as_deref(), Some("THK Quick Leave"));
            }
            other => panic!("Unexpected IPC variant: {:?}", other),
        }
    }
}

fn normalize_message_target(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    let rest = trimmed.strip_prefix("#!rid").or_else(|| trimmed.strip_prefix("#_rid"))?;
    let mut parts = rest.split('-');
    let room = parts.next()?;
    if room.is_empty() || !room.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    match (parts.next(), parts.next()) {
        (None, None) => Some(format!("#!rid{room}")),
        (Some(msg), None) if !msg.is_empty() && msg.chars().all(|c| c.is_ascii_digit()) => {
            Some(format!("#!rid{room}-{msg}"))
        }
        _ => None,
    }
}

fn build_notification_interaction_script(
    id: Option<&str>,
    target: Option<&str>,
    activated: bool,
) -> Option<String> {
    let clean_id = id.map(str::trim).filter(|s| !s.is_empty());
    let clean_target = normalize_message_target(target);
    if !activated {
        let id_json = serde_json::to_string(clean_id?).ok()?;
        return Some(format!("window.__thk_notificationClosed?.({id_json});"));
    }
    match (clean_id, clean_target) {
        (Some(id_str), Some(target_str)) => {
            let id_json = serde_json::to_string(id_str).ok()?;
            let target_json = serde_json::to_string(&target_str).ok()?;
            Some(format!(
                "if (!window.__thk_notificationClicked?.({id_json})) window.__thk_navigateToMessage?.({target_json});"
            ))
        }
        (Some(id_str), None) => {
            let id_json = serde_json::to_string(id_str).ok()?;
            Some(format!("window.__thk_notificationClicked?.({id_json});"))
        }
        (None, Some(target_str)) => {
            let target_json = serde_json::to_string(&target_str).ok()?;
            Some(format!("window.__thk_navigateToMessage?.({target_json});"))
        }
        (None, None) => None,
    }
}

#[cfg(test)]
mod notification_script_tests {
    use super::*;

    #[test]
    fn activation_script_invokes_click_handler_even_without_explicit_target() {
        assert_eq!(
            build_notification_interaction_script(Some("toast-1"), None, true).as_deref(),
            Some("window.__thk_notificationClicked?.(\"toast-1\");")
        );
        assert_eq!(
            build_notification_interaction_script(Some("toast-2"), Some("#_rid12-34"), true).as_deref(),
            Some("if (!window.__thk_notificationClicked?.(\"toast-2\")) window.__thk_navigateToMessage?.(\"#!rid12-34\");")
        );
        assert_eq!(
            build_notification_interaction_script(None, Some("#!rid99-100"), true).as_deref(),
            Some("window.__thk_navigateToMessage?.(\"#!rid99-100\");")
        );
        assert_eq!(
            build_notification_interaction_script(Some("toast-3"), Some("javascript:alert(1)"), true).as_deref(),
            Some("window.__thk_notificationClicked?.(\"toast-3\");")
        );
        assert_eq!(
            build_notification_interaction_script(Some("toast-4"), Some("#!rid12-34"), false).as_deref(),
            Some("window.__thk_notificationClosed?.(\"toast-4\");")
        );
        assert_eq!(build_notification_interaction_script(None, None, true), None);
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

fn normalize_icon_variant(variant: &str) -> &'static str {
    match variant.to_ascii_lowercase().as_str() {
        "thk-signature" | "signature" => "thk-signature",
        "dog" | "dog-original" | "mascot" => "dog",
        _ => "original",
    }
}

#[allow(dead_code)]
fn load_icon() -> Option<Icon> {
    load_icon_for_variant("original")
}

fn load_icon_for_variant(variant: &str) -> Option<Icon> {
    let rgba = match normalize_icon_variant(variant) {
        "thk-signature" => include_bytes!("../assets/thk_signature_32.rgba").as_slice(),
        "dog" => include_bytes!("../assets/thk_dog_32.rgba").as_slice(),
        _ => include_bytes!("../assets/thk_32.rgba").as_slice(),
    };
    Icon::from_rgba(rgba.to_vec(), 32, 32).ok()
}

#[allow(dead_code)]
fn load_tray_icon_rgba() -> (Vec<u8>, u32, u32) {
    load_tray_icon_rgba_for_variant("original")
}

fn load_tray_icon_rgba_for_variant(variant: &str) -> (Vec<u8>, u32, u32) {
    let rgba = match normalize_icon_variant(variant) {
        "thk-signature" => include_bytes!("../assets/thk_signature_16.rgba").as_slice(),
        "dog" => include_bytes!("../assets/thk_dog_16.rgba").as_slice(),
        _ => include_bytes!("../assets/thk_16.rgba").as_slice(),
    };
    (rgba.to_vec(), 16, 16)
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
