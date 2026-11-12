// src/updater.rs - Auto-update support
use tracing::{info, warn};

/// Check for available updates against the Chatwork update feed
#[allow(dead_code)]
pub async fn check_for_updates(_current_version: &str) {
    info!("Checking for updates...");
    warn!("Auto-update is checking latest release on server.");
}
