// src/tray.rs - System tray icon and menu using tray-icon
use muda::{Menu, MenuItem, MenuId, PredefinedMenuItem};
use tray_icon::{TrayIcon, TrayIconBuilder, Icon};

pub mod tray_ids {
    pub const TRAY_SHOW: &str = "tray_show";
    pub const TRAY_QUIT: &str = "tray_quit";
    pub const TRAY_ZOOM_IN: &str = "tray_zoom_in";
    pub const TRAY_ZOOM_OUT: &str = "tray_zoom_out";
    pub const TRAY_ZOOM_RESET: &str = "tray_zoom_reset";
}

/// Build the tray context menu
pub fn build_tray_menu() -> Menu {
    let menu = Menu::new();

    let title_item = MenuItem::new(crate::app::APP_NAME, false, None);
    menu.append(&title_item).unwrap();
    menu.append(&PredefinedMenuItem::separator()).unwrap();

    menu.append(&MenuItem::with_id(MenuId::new(tray_ids::TRAY_SHOW), "Show Window", true, None)).unwrap();
    menu.append(&PredefinedMenuItem::separator()).unwrap();

    menu.append(&MenuItem::with_id(MenuId::new(tray_ids::TRAY_ZOOM_IN), "Zoom In", true, None)).unwrap();
    menu.append(&MenuItem::with_id(MenuId::new(tray_ids::TRAY_ZOOM_OUT), "Zoom Out", true, None)).unwrap();
    menu.append(&MenuItem::with_id(MenuId::new(tray_ids::TRAY_ZOOM_RESET), "Reset Zoom", true, None)).unwrap();
    menu.append(&PredefinedMenuItem::separator()).unwrap();

    menu.append(&MenuItem::with_id(MenuId::new(tray_ids::TRAY_QUIT), "Quit", true, None)).unwrap();

    menu
}

/// Build the system tray icon
pub fn build_tray(icon_rgba: Vec<u8>, icon_width: u32, icon_height: u32) -> Option<TrayIcon> {
    let icon = Icon::from_rgba(icon_rgba, icon_width, icon_height).ok()?;
    let menu = build_tray_menu();

    TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(crate::app::APP_NAME)
        .with_icon(icon)
        .build()
        .ok()
}
