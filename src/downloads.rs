use std::{collections::HashSet, io, path::{Path, PathBuf}};

pub fn is_download_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("blob:") || lower.starts_with("data:") { return true; }
    let Ok(uri) = url.split('#').next().unwrap_or(url).parse::<wry::http::Uri>() else { return false; };
    if !matches!(uri.scheme_str(), Some("http" | "https")) { return false; }
    let host = uri.host().unwrap_or("").to_ascii_lowercase();
    let internal = ["chatwork.com", "kcw.kddi.ne.jp", "kcw.kddi.com"].iter().any(|domain| host == *domain || host.ends_with(&format!(".{domain}")));
    internal && uri.path().to_ascii_lowercase().split('/').any(|part| matches!(part, "download" | "download_file.php" | "download.php"))
}

pub struct DownloadManager { directory: PathBuf, reserved: HashSet<PathBuf> }
impl DownloadManager {
    pub fn new(configured: Option<&str>) -> Self {
        let directory = configured.filter(|value| !value.trim().is_empty()).map(PathBuf::from)
            .or_else(dirs::download_dir).or_else(|| dirs::home_dir().map(|home| home.join("Downloads")))
            .unwrap_or_else(|| PathBuf::from("downloads"));
        Self { directory, reserved: HashSet::new() }
    }
    pub fn destination(&self, suggested: &Path) -> io::Result<PathBuf> {
        let directory = if self.directory.is_absolute() { self.directory.clone() } else { std::env::current_dir()?.join(&self.directory) };
        std::fs::create_dir_all(&directory)?;
        let directory = directory.canonicalize()?;
        let filename = clean_filename(suggested.file_name().unwrap_or_default().to_string_lossy().as_ref());
        let name = Path::new(&filename);
        let stem = name.file_stem().unwrap_or_default().to_string_lossy();
        let extension = name.extension().map(|ext| format!(".{}", ext.to_string_lossy())).unwrap_or_default();
        for number in 0..10_000 {
            let path = directory.join(if number == 0 { filename.clone() } else { format!("{stem} ({number}){extension}") });
            let key = if cfg!(windows) { PathBuf::from(path.to_string_lossy().to_lowercase()) } else { path.clone() };
            if !path.exists() && !self.reserved.contains(&key) { return Ok(path); }
        }
        Err(io::Error::new(io::ErrorKind::AlreadyExists, "Too many files with the same name"))
    }
    pub fn remember_destination(&mut self, path: &Path) {
        if let Some(parent) = path.parent() { self.directory = parent.to_path_buf(); }
        let key = if cfg!(windows) { PathBuf::from(path.to_string_lossy().to_lowercase()) } else { path.to_path_buf() };
        self.reserved.insert(key);
    }
}
fn clean_filename(name: &str) -> String {
    let name: String = name.chars().map(|ch| if ch.is_control() || "<>:\"/\\|?*".contains(ch) { '_' } else { ch }).collect();
    let name = name.trim().trim_end_matches('.');
    let name = if name.is_empty() { "download" } else { name };
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if reserved { format!("_{name}") } else { name.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn detects_downloads_without_treating_external_pages_as_files() {
        assert!(is_download_url("blob:https://www.chatwork.com/uuid"));
        assert!(is_download_url("data:text/plain,hello"));
        assert!(is_download_url("https://www.chatwork.com/gateway/download_file.php?file_id=123"));
        assert!(is_download_url("https://appdata.chatwork.com/files/123/download"));
        assert!(!is_download_url("https://example.com/?url=chatwork.com/download"));
        assert!(!is_download_url("https://chatwork.com.evil.test/download"));
        assert!(!is_download_url("https://www.chatwork.com/#!rid123-456"));
    }
    #[test] fn filenames_are_portable_and_cannot_escape_the_download_folder() {
        assert_eq!(clean_filename("../../file.txt"), ".._.._file.txt");
        assert_eq!(clean_filename("CON.txt"), "_CON.txt");
        assert_eq!(clean_filename(""), "download");
        assert_eq!(clean_filename("Nội dung?.txt"), "Nội dung_.txt");
    }
    #[test] fn destinations_are_absolute_and_never_reuse_existing_or_inflight_names() {
        let root = std::env::current_dir().unwrap().join("target").join(format!("download-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("report.txt"), "existing").unwrap();
        let mut manager = DownloadManager::new(root.to_str());
        let first = manager.destination(Path::new("report.txt")).unwrap();
        manager.remember_destination(&first);
        let second = manager.destination(Path::new("report.txt")).unwrap();
        assert!(first.is_absolute()); assert_ne!(first, second);
        assert_eq!(first.file_name().unwrap(), "report (1).txt");
        assert_eq!(std::fs::read_to_string(root.join("report.txt")).unwrap(), "existing");
        std::fs::remove_file(root.join("report.txt")).unwrap(); std::fs::remove_dir(root).unwrap();
    }
}
