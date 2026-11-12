use std::{io, path::{Path, PathBuf}};

/// Native Save As dialog, owned by the main app window where supported.
pub struct SaveDialog {
    #[cfg(windows)]
    owner: isize,
}

impl SaveDialog {
    pub fn new(_window: &tao::window::Window) -> Self {
        Self {
            #[cfg(windows)]
            owner: {
                use tao::platform::windows::WindowExtWindows;
                _window.hwnd()
            },
        }
    }

    #[cfg(windows)]
    pub fn choose(&self, suggested: &Path) -> io::Result<Option<PathBuf>> {
        use std::{ffi::OsString, os::windows::ffi::{OsStrExt, OsStringExt}};
        use windows_native::*;

        let mut filename = vec![0u16; 32_768];
        let name: Vec<u16> = suggested.file_name().unwrap_or_default().encode_wide().collect();
        if name.len() >= filename.len() { return Err(io::Error::new(io::ErrorKind::InvalidInput, "Filename is too long")); }
        filename[..name.len()].copy_from_slice(&name);
        // canonicalize() may return a verbatim Windows path; the shell dialog uses normal paths.
        let directory = suggested.parent().unwrap_or(Path::new(""));
        let directory_text = directory.to_string_lossy();
        let directory_text = directory_text.strip_prefix(r"\\?\UNC\").map(|path| format!(r"\\{path}"))
            .unwrap_or_else(|| directory_text.strip_prefix(r"\\?\").unwrap_or(&directory_text).to_string());
        let directory: Vec<u16> = directory_text.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "THK-Chat — Lưu file".encode_utf16().chain(Some(0)).collect();
        let filter: Vec<u16> = "All files (*.*)\0*.*\0\0".encode_utf16().collect();
        let extension: Vec<u16> = suggested.extension().unwrap_or_default().encode_wide().chain(Some(0)).collect();
        let mut dialog = OPENFILENAMEW {
            lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
            hwndOwner: self.owner as _,
            lpstrFilter: filter.as_ptr(),
            nFilterIndex: 1,
            lpstrFile: filename.as_mut_ptr(),
            nMaxFile: filename.len() as u32,
            lpstrInitialDir: directory.as_ptr(),
            lpstrTitle: title.as_ptr(),
            lpstrDefExt: extension.as_ptr(),
            Flags: OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT | OFN_HIDEREADONLY,
            ..Default::default()
        };
        if unsafe { GetSaveFileNameW(&mut dialog) } != 0 {
            let length = filename.iter().position(|ch| *ch == 0).unwrap_or(filename.len());
            Ok(Some(PathBuf::from(OsString::from_wide(&filename[..length]))))
        } else {
            let error = unsafe { CommDlgExtendedError() };
            if error == 0 { Ok(None) } else { Err(io::Error::other(format!("Cannot open Save As dialog ({error:#x})"))) }
        }
    }

    #[cfg(target_os = "macos")]
    pub fn choose(&self, suggested: &Path) -> io::Result<Option<PathBuf>> {
        use objc::{class, msg_send, sel, sel_impl, runtime::{Object, NO, YES}};
        use std::{ffi::CStr, os::unix::ffi::OsStrExt};
        unsafe {
            let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
            let panel: *mut Object = msg_send![class!(NSSavePanel), savePanel];
            if panel.is_null() {
                let _: () = msg_send![pool, drain];
                return Err(io::Error::other("Cannot open Save As dialog"));
            }
            let name = suggested.file_name().unwrap_or_default().as_bytes();
            let name_string: *mut Object = msg_send![class!(NSString), alloc];
            let name_string: *mut Object = msg_send![name_string, initWithBytes:name.as_ptr() length:name.len() encoding:4usize];
            let _: () = msg_send![panel, setNameFieldStringValue:name_string];
            let _: () = msg_send![name_string, release];
            let directory = suggested.parent().unwrap_or(Path::new("/")).as_os_str().as_bytes();
            let directory_string: *mut Object = msg_send![class!(NSString), alloc];
            let directory_string: *mut Object = msg_send![directory_string, initWithBytes:directory.as_ptr() length:directory.len() encoding:4usize];
            let directory_url: *mut Object = msg_send![class!(NSURL), fileURLWithPath:directory_string isDirectory:YES];
            let _: () = msg_send![panel, setDirectoryURL:directory_url];
            let _: () = msg_send![directory_string, release];
            let _: () = msg_send![panel, setCanCreateDirectories:YES];
            let _: () = msg_send![panel, setExtensionHidden:NO];
            let response: isize = msg_send![panel, runModal];
            let result = if response == 1 {
                let url: *mut Object = msg_send![panel, URL];
                let path: *const std::os::raw::c_char = msg_send![url, fileSystemRepresentation];
                if path.is_null() { Err(io::Error::other("No save location was selected")) }
                else { Ok(Some(PathBuf::from(std::ffi::OsStr::from_bytes(CStr::from_ptr(path).to_bytes())))) }
            } else { Ok(None) };
            let _: () = msg_send![pool, drain];
            result
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    pub fn choose(&self, _suggested: &Path) -> io::Result<Option<PathBuf>> {
        Err(io::Error::new(io::ErrorKind::Unsupported, "Save As dialog is unavailable on this platform"))
    }
}

// OPENFILENAMEW ABI from the Windows SDK. Link the existing system import
// library so GNU builds do not need an additional resource/assembler tool.
#[cfg(windows)]
#[allow(non_snake_case)]
mod windows_native {
    use std::ffi::c_void;
    #[cfg_attr(target_arch = "x86", repr(C, packed(1)))]
    #[cfg_attr(not(target_arch = "x86"), repr(C))]
    pub struct OPENFILENAMEW {
        pub lStructSize: u32,
        pub hwndOwner: *mut c_void,
        pub hInstance: *mut c_void,
        pub lpstrFilter: *const u16,
        pub lpstrCustomFilter: *mut u16,
        pub nMaxCustFilter: u32,
        pub nFilterIndex: u32,
        pub lpstrFile: *mut u16,
        pub nMaxFile: u32,
        pub lpstrFileTitle: *mut u16,
        pub nMaxFileTitle: u32,
        pub lpstrInitialDir: *const u16,
        pub lpstrTitle: *const u16,
        pub Flags: u32,
        pub nFileOffset: u16,
        pub nFileExtension: u16,
        pub lpstrDefExt: *const u16,
        pub lCustData: isize,
        pub lpfnHook: Option<unsafe extern "system" fn(*mut c_void, u32, usize, isize) -> usize>,
        pub lpTemplateName: *const u16,
        pub pvReserved: *mut c_void,
        pub dwReserved: u32,
        pub FlagsEx: u32,
    }
    impl Default for OPENFILENAMEW {
        fn default() -> Self { unsafe { std::mem::zeroed() } }
    }
    pub const OFN_EXPLORER: u32 = 0x0008_0000;
    pub const OFN_NOCHANGEDIR: u32 = 0x0000_0008;
    pub const OFN_PATHMUSTEXIST: u32 = 0x0000_0800;
    pub const OFN_OVERWRITEPROMPT: u32 = 0x0000_0002;
    pub const OFN_HIDEREADONLY: u32 = 0x0000_0004;
    #[link(name = "comdlg32")]
    extern "system" {
        pub fn GetSaveFileNameW(dialog: *mut OPENFILENAMEW) -> i32;
        pub fn CommDlgExtendedError() -> u32;
    }
}
