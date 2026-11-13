// src/app.rs - Application constants and shared types
use std::sync::{Arc, Mutex};
use crate::config::AppConfig;

/// Primary Chatwork URL
pub const CHATWORK_URL: &str = "https://www.chatwork.com";

/// KDDI/Enterprise Chatwork URL
#[allow(dead_code)]
pub const KDDI_URL: &str = "https://kcw.kddi.ne.jp";

/// App name displayed in title bar / tray
pub const APP_NAME: &str = "THK-Chat";

/// App version
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// User-Agent string mimicking the desktop app
pub const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ",
    "AppleWebKit/537.36 (KHTML, like Gecko) ",
    "Chrome/128.0.0.0 Safari/537.36 Chatwork/2.25.8"
);

/// Minimum zoom level
pub const ZOOM_MIN: f64 = 0.5;
/// Maximum zoom level
pub const ZOOM_MAX: f64 = 1.5;
/// Zoom increment step
pub const ZOOM_STEP: f64 = 0.1;

/// Shared application state
#[derive(Debug, Default)]
pub struct AppState {
    pub config: AppConfig,
    pub unread_count: u32,
    #[allow(dead_code)]
    pub is_logged_in: bool,
}

#[allow(dead_code)]
pub type SharedState = Arc<Mutex<AppState>>;

/// IPC message types sent between WebView and Rust host
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum IpcMessage {
    ShowNotification {
        #[serde(default)]
        title: String,
        #[serde(default)]
        body: String,
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        target: Option<String>,
        #[serde(default)]
        icon: Option<String>,
    },
    SetBadgeCount(u32),
    GoBack,
    GoForward,
    Reload,
    SetZoomFactor(f64),
    CheckForUpdates,
    DownloadUpdate,
    InstallUpdate,
    UpdateUiReady,
    Logout,
    WriteLogError(String),
    SetAppIcon(String),
}
