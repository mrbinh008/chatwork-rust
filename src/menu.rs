// src/menu.rs - Application menu bar using muda
use muda::{Menu, MenuItem, PredefinedMenuItem, Submenu, MenuId};

pub mod ids {
    pub const FILE_NEW_WINDOW: &str = "file_new_window";
    pub const FILE_CLOSE_WINDOW: &str = "file_close_window";
    pub const FILE_QUIT: &str = "file_quit";

    pub const VIEW_ZOOM_IN: &str = "view_zoom_in";
    pub const VIEW_ZOOM_OUT: &str = "view_zoom_out";
    pub const VIEW_ZOOM_RESET: &str = "view_zoom_reset";
    pub const VIEW_TOGGLE_HEADER: &str = "view_toggle_header";
    pub const VIEW_TOGGLE_FOOTER: &str = "view_toggle_footer";
    pub const VIEW_RELOAD: &str = "view_reload";
    pub const VIEW_DEVTOOLS: &str = "view_devtools";

    pub const GO_BACK: &str = "go_back";
    pub const GO_FORWARD: &str = "go_forward";

    pub const WIN_MINIMIZE: &str = "win_minimize";
    pub const WIN_MAXIMIZE: &str = "win_maximize";

    pub const HELP_ABOUT: &str = "help_about";
    pub const HELP_CHECK_UPDATES: &str = "help_check_updates";
    pub const HELP_SUPPORT: &str = "help_support";
}

/// Build the full application menu bar
pub fn build_menu_bar() -> Menu {
    let menu = Menu::new();

    // --- File ---
    let file_menu = Submenu::new("File", true);
    file_menu.append(&MenuItem::with_id(MenuId::new(ids::FILE_NEW_WINDOW), "New Window\tCtrl+N", true, None)).unwrap();
    file_menu.append(&PredefinedMenuItem::separator()).unwrap();
    file_menu.append(&MenuItem::with_id(MenuId::new(ids::FILE_CLOSE_WINDOW), "Close Window\tCtrl+W", true, None)).unwrap();
    file_menu.append(&PredefinedMenuItem::separator()).unwrap();
    file_menu.append(&MenuItem::with_id(MenuId::new(ids::FILE_QUIT), "Quit\tCtrl+Q", true, None)).unwrap();
    menu.append(&file_menu).unwrap();

    // --- Edit ---
    let edit_menu = Submenu::new("Edit", true);
    edit_menu.append(&PredefinedMenuItem::undo(None)).unwrap();
    edit_menu.append(&PredefinedMenuItem::redo(None)).unwrap();
    edit_menu.append(&PredefinedMenuItem::separator()).unwrap();
    edit_menu.append(&PredefinedMenuItem::cut(None)).unwrap();
    edit_menu.append(&PredefinedMenuItem::copy(None)).unwrap();
    edit_menu.append(&PredefinedMenuItem::paste(None)).unwrap();
    edit_menu.append(&PredefinedMenuItem::select_all(None)).unwrap();
    menu.append(&edit_menu).unwrap();

    // --- View ---
    let view_menu = Submenu::new("View", true);
    view_menu.append(&MenuItem::with_id(MenuId::new(ids::VIEW_ZOOM_IN), "Zoom In\tCtrl++", true, None)).unwrap();
    view_menu.append(&MenuItem::with_id(MenuId::new(ids::VIEW_ZOOM_OUT), "Zoom Out\tCtrl+-", true, None)).unwrap();
    view_menu.append(&MenuItem::with_id(MenuId::new(ids::VIEW_ZOOM_RESET), "Reset Zoom\tCtrl+0", true, None)).unwrap();
    view_menu.append(&PredefinedMenuItem::separator()).unwrap();
    view_menu.append(&MenuItem::with_id(MenuId::new(ids::VIEW_TOGGLE_HEADER), "Toggle Header", true, None)).unwrap();
    view_menu.append(&MenuItem::with_id(MenuId::new(ids::VIEW_TOGGLE_FOOTER), "Toggle Footer", true, None)).unwrap();
    view_menu.append(&PredefinedMenuItem::separator()).unwrap();
    view_menu.append(&MenuItem::with_id(MenuId::new(ids::VIEW_RELOAD), "Reload\tCtrl+R", true, None)).unwrap();
    view_menu.append(&PredefinedMenuItem::separator()).unwrap();
    view_menu.append(&MenuItem::with_id(MenuId::new(ids::VIEW_DEVTOOLS), "Developer Tools\tCtrl+Shift+I", true, None)).unwrap();
    menu.append(&view_menu).unwrap();

    // --- Go ---
    let go_menu = Submenu::new("Go", true);
    go_menu.append(&MenuItem::with_id(MenuId::new(ids::GO_BACK), "Back\tAlt+Left", true, None)).unwrap();
    go_menu.append(&MenuItem::with_id(MenuId::new(ids::GO_FORWARD), "Forward\tAlt+Right", true, None)).unwrap();
    menu.append(&go_menu).unwrap();

    // --- Window ---
    let win_menu = Submenu::new("Window", true);
    win_menu.append(&MenuItem::with_id(MenuId::new(ids::WIN_MINIMIZE), "Minimize", true, None)).unwrap();
    win_menu.append(&MenuItem::with_id(MenuId::new(ids::WIN_MAXIMIZE), "Maximize", true, None)).unwrap();
    menu.append(&win_menu).unwrap();

    // --- Help ---
    let help_menu = Submenu::new("Help", true);
    help_menu.append(&MenuItem::with_id(MenuId::new(ids::HELP_CHECK_UPDATES), "Check for Updates...", true, None)).unwrap();
    help_menu.append(&PredefinedMenuItem::separator()).unwrap();
    help_menu.append(&MenuItem::with_id(MenuId::new(ids::HELP_SUPPORT), "Support", true, None)).unwrap();
    help_menu.append(&PredefinedMenuItem::separator()).unwrap();
    help_menu.append(&MenuItem::with_id(MenuId::new(ids::HELP_ABOUT), "About THK-Chat", true, None)).unwrap();
    menu.append(&help_menu).unwrap();

    menu
}
