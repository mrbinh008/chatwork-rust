// GitHub Releases updater. Renderer messages never supply URLs or install paths.
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, process::{Command, Stdio}, time::{Duration, SystemTime, UNIX_EPOCH}};

pub const REPOSITORY: &str = "mrbinh008/chatwork-rust";
const MAX_PACKAGE: u64 = 1_073_741_824;

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub phase: &'static str,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: String,
    pub release_url: Option<String>,
    pub progress: u8,
    pub message: String,
    pub open: bool,
}
impl Default for Status {
    fn default() -> Self {
        Self { phase: "idle", current_version: crate::app::APP_VERSION.into(), version: None,
            notes: String::new(), release_url: None, progress: 0, message: String::new(), open: false }
    }
}
#[derive(Debug, Clone)]
pub struct Offer { pub version: String, pub notes: String, pub release_url: String, asset: Asset }
#[derive(Debug, Clone)]
pub struct Staged { pub directory: PathBuf, pub version: String, pub digest: String }
#[derive(Debug)]
pub enum Event { Checked(Result<Option<Offer>, String>), Progress(u8), Downloaded(Result<Staged, String>) }
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)] draft: bool,
    #[serde(default)] prerelease: bool,
    #[serde(default)] body: Option<String>,
    html_url: String,
    assets: Vec<Asset>,
}
#[derive(Debug, Clone, Deserialize)]
struct Asset { name: String, browser_download_url: String, size: u64, digest: Option<String> }
#[derive(Clone, Copy)]
pub enum Platform { WindowsX64, Mac }
fn platform() -> Result<Platform, String> {
    if cfg!(all(windows, target_arch = "x86_64")) { Ok(Platform::WindowsX64) }
    else if cfg!(target_os = "macos") { Ok(Platform::Mac) }
    else { Err("Chưa hỗ trợ cập nhật tự động trên nền tảng này.".into()) }
}
fn version(value: &str) -> Option<(u64, u64, u64)> {
    let value = value.strip_prefix('v').unwrap_or(value);
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty() || !p.bytes().all(|c| c.is_ascii_digit()) || (p.len() > 1 && p.starts_with('0'))) { return None; }
    Some((parts[0].parse().ok()?, parts[1].parse().ok()?, parts[2].parse().ok()?))
}
fn parse_release(json: &[u8], current: &str, platform: Platform) -> Result<Option<Offer>, String> {
    let release: Release = serde_json::from_slice(json).map_err(|_| "GitHub trả về dữ liệu phiên bản không hợp lệ.")?;
    if release.draft || release.prerelease { return Ok(None); }
    let latest = version(&release.tag_name).ok_or("Tag release phải có dạng vX.Y.Z.")?;
    if latest <= version(current).ok_or("Phiên bản hiện tại không hợp lệ.")? { return Ok(None); }
    let normalized = format!("{}.{}.{}", latest.0, latest.1, latest.2);
    let suffix = match platform { Platform::WindowsX64 => "Windows-x64.zip", Platform::Mac => "macOS-Universal.tar.gz" };
    let name = format!("THK-Chat-v{normalized}-{suffix}");
    let asset = release.assets.into_iter().find(|a| a.name == name)
        .ok_or_else(|| format!("Release {normalized} chưa có gói {suffix}. Vui lòng kiểm tra lại sau."))?;
    let prefix = format!("https://github.com/{REPOSITORY}/releases/download/{}/", release.tag_name);
    if asset.browser_download_url != format!("{prefix}{name}") || release.html_url != format!("https://github.com/{REPOSITORY}/releases/tag/{}", release.tag_name) {
        return Err("Đường dẫn cập nhật không thuộc GitHub Releases của THK-Chat.".into());
    }
    if asset.size == 0 || asset.size > MAX_PACKAGE { return Err("Kích thước gói cập nhật không hợp lệ.".into()); }
    let digest = asset.digest.as_deref().and_then(|d| d.strip_prefix("sha256:")).unwrap_or("");
    if digest.len() != 64 || !digest.bytes().all(|c| c.is_ascii_hexdigit()) { return Err("Asset release chưa có SHA-256 hợp lệ. Hãy upload lại gói trên GitHub Releases.".into()); }
    Ok(Some(Offer { version: normalized, notes: release.body.unwrap_or_default().chars().take(16_000).collect(), release_url: release.html_url, asset }))
}

pub struct Controller { pub status: Status, offer: Option<Offer>, staged: Option<Staged>, busy: bool }
impl Controller {
    pub fn new() -> Self { Self { status: Status::default(), offer: None, staged: None, busy: false } }
    pub fn check(&mut self, interactive: bool, proxy: tao::event_loop::EventLoopProxy<crate::UserEvent>) {
        self.status.open = interactive;
        if self.busy { return; }
        if self.staged.is_some() { self.status.phase = "ready"; return; }
        self.busy = true; self.status.phase = "checking"; self.status.message.clear();
        std::thread::spawn(move || { let _ = proxy.send_event(crate::UserEvent::Updater(Event::Checked(fetch_latest()))); });
    }
    pub fn download(&mut self, proxy: tao::event_loop::EventLoopProxy<crate::UserEvent>) {
        self.status.open = true;
        if self.busy || self.staged.is_some() { return; }
        let Some(offer) = self.offer.clone() else { return; };
        self.busy = true; self.status.phase = "downloading"; self.status.progress = 0; self.status.message.clear();
        std::thread::spawn(move || {
            let result = stage(&offer, |p| { let _ = proxy.send_event(crate::UserEvent::Updater(Event::Progress(p))); });
            let _ = proxy.send_event(crate::UserEvent::Updater(Event::Downloaded(result)));
        });
    }
    pub fn handle(&mut self, event: Event) {
        self.status.open = false;
        match event {
            Event::Progress(p) => self.status.progress = p,
            Event::Checked(result) => {
                self.busy = false;
                match result {
                    Ok(Some(offer)) => {
                        self.status.phase = "available"; self.status.version = Some(offer.version.clone());
                        self.status.notes = offer.notes.clone(); self.status.release_url = Some(offer.release_url.clone()); self.offer = Some(offer);
                    }
                    Ok(None) => { self.status.phase = "current"; self.offer = None; self.status.version = None; }
                    Err(error) => self.fail(error),
                }
            }
            Event::Downloaded(result) => {
                self.busy = false;
                match result {
                    Ok(staged) => { self.staged = Some(staged); self.status.phase = "ready"; self.status.progress = 100; }
                    Err(error) => self.fail(error),
                }
            }
        }
    }
    pub fn fail(&mut self, error: String) { tracing::warn!("Updater: {}", error); self.status.phase = "error"; self.status.message = error; self.busy = false; }
    pub fn install(&mut self) -> Result<(), String> {
        if self.status.phase != "ready" || self.busy { return Err("Bản cập nhật chưa sẵn sàng hoặc đang được cài đặt.".into()); }
        let staged = self.staged.as_ref().ok_or("Chưa có gói cập nhật đã xác minh.")?;
        let mut cmd = helper(staged, "Install")?;
        #[cfg(windows)] cmd.arg("-ParentPid").arg(std::process::id().to_string()).arg("-Restart");
        #[cfg(target_os = "macos")] cmd.arg(std::process::id().to_string()).arg("restart");
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        cmd.spawn().map_err(|e| format!("Không khởi động được trình cập nhật: {e}"))?;
        self.status.phase = "installing"; self.busy = true; Ok(())
    }
    pub fn previous_result(&mut self) {
        let Ok(path) = result_file() else { return; };
        let Ok(bytes) = fs::read(&path) else { return; };
        let _ = fs::remove_file(&path);
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
        if let Ok(result) = serde_json::from_slice::<serde_json::Value>(bytes) {
            if result["status"] == "error" {
                self.fail(result["message"].as_str().unwrap_or("Cập nhật chưa hoàn tất; phiên bản trước đã được giữ lại.").to_string());
                self.status.open = true;
            }
        }
    }
}
fn command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000); }
    command
}
fn curl() -> Command {
    let mut cmd = command(if cfg!(windows) { "C:\\Windows\\System32\\curl.exe" } else { "/usr/bin/curl" });
    cmd.args(["--silent", "--show-error", "--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "15", "--user-agent", concat!("THK-Chat/", env!("CARGO_PKG_VERSION"))]);
    cmd
}
fn fetch_latest() -> Result<Option<Offer>, String> {
    let platform = platform()?;
    let output = curl().args(["--max-time", "30", "--max-filesize", "1048576", "--header", "Accept: application/vnd.github+json", "--header", "X-GitHub-Api-Version: 2022-11-28", &format!("https://api.github.com/repos/{REPOSITORY}/releases/latest")])
        .output().map_err(|e| format!("Không kết nối được GitHub: {e}"))?;
    if !output.status.success() { return Err("Không đọc được GitHub Releases. Kiểm tra mạng và bảo đảm repository/release đã được công khai.".into()); }
    if output.stdout.len() > 1_048_576 { return Err("Dữ liệu GitHub Releases quá lớn.".into()); }
    parse_release(&output.stdout, crate::app::APP_VERSION, platform)
}
fn updates_dir() -> Result<PathBuf, String> {
    let directory = crate::config::AppConfig::config_path().parent().ok_or("Không tìm thấy thư mục cấu hình.")?.join("updates");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    std::path::absolute(directory).map_err(|e| e.to_string())
}
fn result_file() -> Result<PathBuf, String> { Ok(updates_dir()?.join("last-result.json")) }
fn stage(offer: &Offer, progress: impl Fn(u8)) -> Result<Staged, String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let directory = updates_dir()?.join(format!("{}-{stamp}", offer.version));
    fs::create_dir(&directory).map_err(|e| e.to_string())?;
    let archive = directory.join("package.part");
    let mut child = curl().args(["--max-time", "900", "--max-filesize", &offer.asset.size.to_string(), "--output"])
        .arg(&archive).arg(&offer.asset.browser_download_url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Không tải được bản cập nhật: {e}"))?;
    let mut last = 255;
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() { break; }
        let bytes = fs::metadata(&archive).map(|m| m.len()).unwrap_or(0);
        let percent = ((bytes.saturating_mul(100) / offer.asset.size).min(99)) as u8;
        if percent != last { progress(percent); last = percent; }
        std::thread::sleep(Duration::from_millis(250));
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() || fs::metadata(&archive).map(|m| m.len()).unwrap_or(0) != offer.asset.size {
        let _ = fs::remove_file(&archive); return Err("Tải bản cập nhật chưa hoàn tất. Vui lòng thử lại.".into());
    }
    fs::rename(&archive, directory.join("package.download")).map_err(|e| e.to_string())?;
    let staged = Staged { directory, version: offer.version.clone(), digest: offer.asset.digest.as_deref().unwrap_or("").trim_start_matches("sha256:").to_ascii_lowercase() };
    let output = helper(&staged, "Prepare")?.output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(format!("Không xác minh được gói cập nhật: {}", String::from_utf8_lossy(&output.stderr).chars().take(1400).collect::<String>())); }
    progress(100); Ok(staged)
}
fn install_directory() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")] {
        let bundle = exe.ancestors().nth(3).ok_or("Không tìm thấy app bundle.")?;
        if bundle.extension().and_then(|s| s.to_str()) != Some("app") { return Err("Hãy chạy bản THK-Chat.app trong Applications để cập nhật.".into()); }
        Ok(bundle.to_path_buf())
    }
    #[cfg(not(target_os = "macos"))] {
        if exe.file_name().and_then(|s| s.to_str()) != Some("THK-Chat.exe") { return Err("Hãy chạy bản đóng gói THK-Chat.exe để cập nhật.".into()); }
        Ok(exe.parent().ok_or("Không tìm thấy thư mục app.")?.to_path_buf())
    }
}
fn helper(staged: &Staged, mode: &str) -> Result<Command, String> {
    #[cfg(target_os = "macos")] {
        let path = staged.directory.join("update.sh");
        fs::write(&path, include_str!("../ota/macos-update.sh")).map_err(|e| e.to_string())?;
        let mut cmd = command("/bin/sh");
        cmd.arg(path).arg(mode).arg(&staged.directory).arg(install_directory()?).arg(&staged.version).arg(&staged.digest).arg(result_file()?);
        Ok(cmd)
    }
    #[cfg(not(target_os = "macos"))] {
        let path = staged.directory.join("update.ps1");
        fs::write(&path, include_str!("../ota/windows-update.ps1")).map_err(|e| e.to_string())?;
        let mut cmd = command("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(path)
            .arg("-Mode").arg(mode).arg("-WorkDir").arg(&staged.directory).arg("-InstallDir").arg(install_directory()?)
            .arg("-Version").arg(&staged.version).arg("-ExpectedHash").arg(&staged.digest).arg("-ResultFile").arg(result_file()?);
        Ok(cmd)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, suffix: &str) -> serde_json::Value {
        let name = format!("THK-Chat-{tag}-{suffix}");
        serde_json::json!({"tag_name":tag,"html_url":format!("https://github.com/{REPOSITORY}/releases/tag/{tag}"),"assets":[{"name":name,"browser_download_url":format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"),"size":100,"digest":format!("sha256:{}","a".repeat(64))}]})
    }
    #[test] fn versions_are_numeric_and_never_downgrade() {
        assert!(version("v2.10.0") > version("2.9.9"));
        for invalid in ["v2.0", "2.0.0-beta", "2.00.0", "../../2.0.0"] { assert!(version(invalid).is_none()); }
        for current in ["2.27.0", "3.0.0"] { assert!(parse_release(&serde_json::to_vec(&release("v2.27.0", "Windows-x64.zip")).unwrap(), current, Platform::WindowsX64).unwrap().is_none()); }
    }
    #[test] fn selects_exact_platform_asset_and_requires_integrity() {
        let mut value = release("v2.27.0", "Windows-x64.zip");
        assert!(parse_release(&serde_json::to_vec(&value).unwrap(), "2.26.0", Platform::WindowsX64).unwrap().is_some());
        assert!(parse_release(&serde_json::to_vec(&value).unwrap(), "2.26.0", Platform::Mac).is_err());
        value["assets"][0]["digest"] = serde_json::Value::Null;
        assert!(parse_release(&serde_json::to_vec(&value).unwrap(), "2.26.0", Platform::WindowsX64).is_err());
    }
    #[test] fn refuses_prereleases_and_foreign_downloads() {
        let mut value = release("v2.27.0", "macOS-Universal.tar.gz");
        value["prerelease"] = true.into();
        assert!(parse_release(&serde_json::to_vec(&value).unwrap(), "2.26.0", Platform::Mac).unwrap().is_none());
        value["prerelease"] = false.into(); value["assets"][0]["browser_download_url"] = "https://github.com/other/project/file.tar.gz".into();
        assert!(parse_release(&serde_json::to_vec(&value).unwrap(), "2.26.0", Platform::Mac).is_err());
    }
}
