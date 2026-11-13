// src/config.rs - Persistent app configuration (replaces electron-store)
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Window geometry settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowParams {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
    pub fullscreen: bool,
}

impl Default for WindowParams {
    fn default() -> Self {
        Self {
            width: 1200,
            height: 800,
            x: 0,
            y: 0,
            maximized: false,
            fullscreen: false,
        }
    }
}

/// A browser tab entry (Chatwork supports multiple service tabs)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabEntry {
    pub service: String,
    pub url: String,
    pub label: Option<String>,
}

impl Default for TabEntry {
    fn default() -> Self {
        Self {
            service: "chatwork".to_string(),
            url: crate::app::CHATWORK_URL.to_string(),
            label: Some("Chatwork".to_string()),
        }
    }
}

/// Proxy authentication info
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxyCredential {
    pub username: String,
    pub password: String,
}

/// Full application settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub window_params: WindowParams,
    pub tabs: Vec<TabEntry>,
    pub zoom_factor: f64,
    pub local_language: Option<String>,
    pub show_header: bool,
    pub show_footer: bool,
    pub open_on_login: bool,
    pub save_credential: bool,
    pub proxy_credential: Option<ProxyCredential>,
    pub download_dir: Option<String>,
    #[serde(default)]
    pub app_icon: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            window_params: WindowParams::default(),
            tabs: vec![TabEntry::default()],
            zoom_factor: 1.0,
            local_language: None,
            show_header: true,
            show_footer: true,
            open_on_login: false,
            save_credential: false,
            proxy_credential: None,
            download_dir: None,
            app_icon: None,
        }
    }
}

impl AppConfig {
    /// Returns the config file path: %APPDATA%\Chatwork\config.json
    pub fn config_path() -> PathBuf {
        // Keep local smoke tests independent of a running user's instance/config.
        if let Some(directory) = std::env::var_os("THK_CHAT_CONFIG_DIR")
            .map(PathBuf::from).filter(|directory| directory.is_absolute()) {
            return directory.join("config.json");
        }
        let base = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."));
        base.join("Chatwork").join("config.json")
    }

    /// Load config from disk, returning defaults on first run
    pub fn load() -> Self {
        let path = Self::config_path();
        if let Ok(data) = std::fs::read_to_string(&path) {
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            Self::default()
        }
    }

    /// Persist config to disk
    pub fn save(&self) {
        let path = Self::config_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            let _ = std::fs::write(&path, json);
        }
    }
}
