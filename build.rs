// Build native Windows icons/version resources without an external rc/windres tool.
use std::path::{Path, PathBuf};

fn word(out: &mut Vec<u8>, value: u16) { out.extend_from_slice(&value.to_le_bytes()); }
fn dword(out: &mut Vec<u8>, value: u32) { out.extend_from_slice(&value.to_le_bytes()); }
fn align(out: &mut Vec<u8>) { while out.len() % 4 != 0 { out.push(0); } }
fn wide(value: &str) -> Vec<u8> { value.encode_utf16().chain(Some(0)).flat_map(u16::to_le_bytes).collect() }
fn block(key: &str, value: &[u8], value_len: u16, kind: u16, children: &[Vec<u8>]) -> Vec<u8> {
    let mut out = vec![];
    word(&mut out, 0); word(&mut out, value_len); word(&mut out, kind);
    out.extend(wide(key)); align(&mut out); out.extend_from_slice(value); align(&mut out);
    for child in children { out.extend_from_slice(child); align(&mut out); }
    let len = u16::try_from(out.len()).expect("Version resource is too large");
    out[0..2].copy_from_slice(&len.to_le_bytes()); out
}
fn string(key: &str, value: &str) -> Vec<u8> {
    let value = wide(value); block(key, &value, (value.len() / 2) as u16, 1, &[])
}
fn version_resource() -> Vec<u8> {
    let major: u32 = env!("CARGO_PKG_VERSION_MAJOR").parse().unwrap();
    let minor: u32 = env!("CARGO_PKG_VERSION_MINOR").parse().unwrap();
    let patch: u32 = env!("CARGO_PKG_VERSION_PATCH").parse().unwrap();
    let mut fixed = vec![];
    for value in [0xfeef04bd, 0x10000, (major << 16) | minor, patch << 16,
                  (major << 16) | minor, patch << 16, 0x3f, 0, 0x40004, 1, 0, 0, 0] { dword(&mut fixed, value); }
    let version = format!("{}.0", env!("CARGO_PKG_VERSION"));
    let strings = vec![string("CompanyName", "THK Team"), string("FileDescription", "THK-Chat Desktop App"),
        string("FileVersion", &version), string("InternalName", "THK-Chat"), string("OriginalFilename", "THK-Chat.exe"),
        string("ProductName", "THK-Chat"), string("ProductVersion", &version), string("LegalCopyright", "THK Team")];
    let table = block("040904b0", &[], 0, 1, &strings);
    let info = block("StringFileInfo", &[], 0, 1, &[table]);
    let mut translation = vec![]; word(&mut translation, 0x0409); word(&mut translation, 1200);
    let vars = block("VarFileInfo", &[], 0, 1, &[block("Translation", &translation, 4, 0, &[])]);
    block("VS_VERSION_INFO", &fixed, fixed.len() as u16, 0, &[info, vars])
}
fn resource(out: &mut Vec<u8>, kind: u16, id: u16, data: &[u8]) {
    dword(out, data.len() as u32); dword(out, 32);
    word(out, 0xffff); word(out, kind); word(out, 0xffff); word(out, id);
    dword(out, 0); word(out, 0x0030); word(out, 0x0409); dword(out, 0); dword(out, 0);
    out.extend_from_slice(data); align(out);
}
fn windows_resources(output: &Path) {
    let ico = std::fs::read("assets/thk.ico").expect("Windows app icon missing");
    let u16_at = |offset| u16::from_le_bytes(ico[offset..offset + 2].try_into().unwrap());
    let u32_at = |offset| u32::from_le_bytes(ico[offset..offset + 4].try_into().unwrap());
    assert_eq!(u16_at(0), 0); assert_eq!(u16_at(2), 1);
    let count = u16_at(4);
    let mut out = vec![0; 32]; out[4] = 32;
    out[8..10].copy_from_slice(&0xffffu16.to_le_bytes());
    out[12..14].copy_from_slice(&0xffffu16.to_le_bytes());
    let mut group = vec![]; word(&mut group, 0); word(&mut group, 1); word(&mut group, count);
    for index in 0..count {
        let row = 6 + usize::from(index) * 16;
        let bytes = u32_at(row + 8) as usize; let offset = u32_at(row + 12) as usize;
        assert!(offset + bytes <= ico.len(), "Invalid ICO image range");
        group.extend_from_slice(&ico[row..row + 12]); word(&mut group, index + 1);
        resource(&mut out, 3, index + 1, &ico[offset..offset + bytes]);
    }
    resource(&mut out, 14, 1, &group); resource(&mut out, 16, 1, &version_resource());
    std::fs::write(output, out).expect("Failed to write Windows resources");
}
fn main() {
    println!("cargo:rerun-if-changed=assets/thk.ico");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") { return; }
    let out_dir = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR missing"));
    let res = out_dir.join("THK-Chat.res");
    windows_resources(&res);
    // Pass the resource file directly, so LLD does not discard an unreferenced archive.
    println!("cargo:rustc-link-arg={}", res.display());
    copy_webview2_loader(&out_dir);
}
fn copy_webview2_loader(out_dir: &Path) {
    let Some(target_dir) = out_dir.ancestors().nth(3) else { return; };
    let cargo_home = std::env::var_os("CARGO_HOME").map(PathBuf::from).or_else(||
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(|home| PathBuf::from(home).join(".cargo")));
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() { Ok("aarch64") => "arm64", Ok("x86") => "x86", _ => "x64" };
    if let Some(home) = cargo_home {
        if let Ok(indices) = std::fs::read_dir(home.join("registry/src")) {
            for index in indices.flatten() {
                if let Ok(crates) = std::fs::read_dir(index.path()) {
                    for krate in crates.flatten() {
                        if krate.file_name().to_string_lossy().starts_with("webview2-com-sys-") {
                            let dll = krate.path().join(arch).join("WebView2Loader.dll");
                            if dll.is_file() { std::fs::copy(dll, target_dir.join("WebView2Loader.dll")).expect("Cannot copy WebView2Loader.dll"); return; }
                        }
                    }
                }
            }
        }
    }
    panic!("WebView2Loader.dll not found for {arch}; ensure webview2-com-sys sources are available");
}
