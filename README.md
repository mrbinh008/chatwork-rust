# THK-Chat Desktop

Bản tái triển khai ứng dụng Chatwork Desktop: Windows dùng Rust, macOS dùng Swift + AppKit + WKWebView. Không đóng gói Electron/Node.js trong ứng dụng.

## macOS native bằng Swift

Bản build macOS mặc định dùng Swift + AppKit + WKWebView, yêu cầu macOS 12 trở lên. Windows tiếp tục dùng Rust. Phần cửa sổ, menu/phím tắt Command, menu bar, Dock badge, thông báo kèm ảnh, hộp thoại chọn/tải file và cập nhật được xử lý bằng API macOS. Nội dung Chatwork và các tiện ích cây thư mục, shortcut, quản lý/xem trước file vẫn dùng chung JavaScript/CSS trong `src/`.

Build trên Mac đã cài Xcode Command Line Tools (`xcode-select --install`):

```bash
bash build-mac.sh --native       # Chỉ kiến trúc của Mac đang build
bash build-mac.sh --universal    # Apple Silicon + Intel
```

Mã Swift ở `mac/Native/`. Script chạy kiểm thử policy và type-check AppKit/WebKit trước khi build release tối ưu bằng `-O -whole-module-optimization`; đóng gói `.app`, `.tar.gz`, `.zip`, `.dmg` trong `dist/`. Workflow release macOS cũng dùng Swift và không cần Rust. App được ký ad-hoc; chưa có Developer ID/notarization.

Cookie và website storage dùng kho bền vững mặc định của WebKit; cấu hình cửa sổ, zoom và thư mục tải dùng UserDefaults. Chuyển từ bản Rust có thể cần đăng nhập lại; chưa có bước chuyển đổi cấu hình Rust sang UserDefaults. Thông báo và cập nhật dùng callback; lịch kiểm tra cập nhật mỗi 6 giờ có tolerance 5 phút. Chưa có số đo CPU/RAM so sánh với bản Rust; phần web vẫn dùng các observer/timer chung.

Kiểm thử Swift riêng: `bash mac/test-native.sh`. Cần chạy thử đăng nhập/SSO, thông báo, tải đè file và cập nhật trên Mac trước khi phát hành. Máy Windows không biên dịch AppKit; `build-mac-docker.ps1` giữ đường cross-build **Rust cũ**, hoặc có thể chọn `THK_MAC_BACKEND=rust bash build-mac.sh --universal`.

## Bản 2.26.3

- macOS chuyển sang host Swift + AppKit + WKWebView, build Universal cho Apple Silicon và Intel; yêu cầu macOS 12 trở lên. Windows giữ host Rust.
- GitHub Actions kiểm thử Swift và các tiện ích web, build/đóng gói macOS; chỉ công bố release khi cả Windows và macOS thành công.
- Cây thư mục giữ đúng thư mục cha khi sửa thư mục con; tự mở các thư mục cha khi thêm hoặc chuyển thư mục con. Bỏ `thk-file-icon` trong danh sách file.
- Bản Mac được ký ad-hoc, chưa notarize. Chuyển từ host Rust có thể cần đăng nhập lại; chưa có số đo hiệu năng so sánh hoặc kiểm thử tương tác đăng nhập/SSO trên máy người dùng.

## Bản 2.26.2

- **Notification Avatar**: Hiển thị ảnh đại diện (avatar) của người gửi trực tiếp trên thông báo desktop (Windows Toast notification và macOS banner).
- **Cây thư mục phòng trò chuyện (Room Folder Tree)**: Tính năng nhóm các danh mục phòng trò chuyện theo cây thư mục phân cấp ở thanh sidebar bên trái. Hỗ trợ tạo thư mục con nhiều cấp, gập/mở (collapse/expand), đếm tổng tin chưa đọc, nút `⚡ Tự động gom` (phân tích tiền tố `[...]`, `【...】` hoặc dấu `/`, `-` trong tên phòng để gom nhóm tự động), và modal thêm/sửa/xóa thư mục.
- **Tùy chọn Phạm vi cấu hình Shortcut**: Cho phép cấu hình hiển thị shortcut áp dụng cho **Nhóm hiện tại (mặc định)** hoặc **Tất cả các nhóm**, có nút khôi phục thiết lập chung (Inherit).
- **Cài đặt Phím tắt tùy chỉnh (Custom Shortkeys)**: Cho phép ghi nhận và gán lại tổ hợp phím tắt tùy chỉnh cho từng nút công cụ (`info`, `infoTitle`, `code`, `hr`, `leave`, `preview`, `pr`, `files`) với giao diện bấm phím trực quan và lắng nghe phím toàn cục.
- **Xem trước Thumbnail File trực tiếp**: Hiển thị ảnh thumbnail xem trước trực tiếp trên danh sách tệp đính kèm mà không cần bấm thêm một bước vào nút "Xem trước".
- **Kích thước Icon Toolbar chuẩn hóa**: Chuẩn hóa kích thước các nút công cụ shortcut lên 32px × 32px và icon SVG 19px × 19px sắc nét, đồng bộ hoàn hảo với các nút công cụ gốc của Chatwork.

## Bản 2.26.1

- Shortcut chỉ còn cấu hình cho **nhóm hiện tại**. Lựa chọn bật/tắt được áp dụng ngay, ưu tiên hơn điều kiện mặc định theo tên nhóm và giữ nguyên khi toolbar được Chatwork tạo lại. Cấu hình chung từ bản cũ vẫn được đọc làm mặc định chuyển đổi; thay đổi mới chỉ ghi vào nhóm hiện tại.
- Quản lý file có xem trước ảnh, PDF, video và văn bản trong app. DOCX/PPTX hiển thị nội dung văn bản; XLSX có chọn sheet và bảng tối đa 200 dòng × 50 cột. Đây là bản xem nội dung cơ bản, không thay thế trình Office đầy đủ. File không hỗ trợ/giới hạn dung lượng sẽ hiện thông báo và vẫn có nút tải xuống. Đóng preview sẽ hủy tải và thu hồi blob URL.
- Form nghỉ có từng cặp **ngày + giờ bắt đầu + giờ kết thúc** độc lập; có thể thêm từng ngày hoặc thêm một khoảng ngày cùng giờ. Giữ nguyên định dạng `[info]`, tag nhiều leader và nhớ lựa chọn leader như trước. Palette riêng cho form bảo đảm chữ/nền phù hợp sáng/tối, gồm cả ô date/time native.
- Chỉ chạy một phiên app cho mỗi hồ sơ người dùng. Mở app lần nữa sẽ đưa cửa sổ đang chạy lên trước và thoát phiên mới. Khóa được hệ điều hành giải phóng khi app đóng/crash; OTA đợi phiên cũ thoát trước khi khởi động bản mới.

Kiểm tra thêm: `node examples/file-preview-regression.cjs`. Bộ test Rust có kiểm thử kích hoạt phiên đang chạy bằng tiến trình thứ hai.

## Bản 2.26.0

- OTA lấy bản stable mới nhất từ GitHub Releases của `mrbinh008/chatwork-rust`. App kiểm tra ngầm sau khi mở và mỗi 6 giờ; có thể mở **Help → Check for Updates** hoặc nút kiểm tra trong Cài đặt.
- Khi có bản mới: **Tải bản cập nhật → Cập nhật và khởi động lại**. App kiểm tra kích thước, SHA-256 do GitHub cung cấp, cấu trúc gói và phiên bản trước khi cài. Windows thay các file app tại thư mục đang chạy; macOS thay `.app` tại vị trí hiện tại. Giữ bản cũ để khôi phục nếu thay thế thất bại; không thay dữ liệu đăng nhập hay cấu hình.
- Chỉ nhận đúng gói `THK-Chat-vX.Y.Z-Windows-x64.zip` hoặc `THK-Chat-vX.Y.Z-macOS-Universal.tar.gz`. Repository và release phải công khai; không nhúng GitHub token vào app. Windows cần chạy bản đóng gói `THK-Chat.exe`; Mac cần chạy `.app` trong thư mục có quyền ghi, ví dụ Applications, thay vì chạy trong DMG.
- Quản lý file theo nhóm: **Tất cả / Ảnh / Tài liệu / Video / Khác**, tìm tên/người tải lên, tải file qua hộp thoại lưu native. Danh sách dùng phản hồi hiện có của Chatwork; chưa bổ sung phân trang vượt giới hạn server. Khi không đọc được API, giao diện dùng các file đính kèm đã tải trong phần chat và ghi rõ nguồn dữ liệu.
- Cài đặt shortcut ban đầu có phạm vi chung/riêng nhóm; từ 2.26.1 giao diện chỉ cấu hình nhóm hiện tại. Nút Cài đặt luôn được giữ để khôi phục các nút đã ẩn.
- UI lấy màu, nền, font từ Chatwork hiện tại; hỗ trợ sáng/tối và cửa sổ nhỏ. **Emoji gần đây đã được bỏ**, bao gồm theo dõi lịch sử và nút emoji bổ sung; vẫn dùng emoji gốc của Chatwork.

### Phát hành OTA

Cài bản 2.26.0 một lần để có updater. Các lần sau chỉ cần phát hành phiên bản mới trên GitHub:

1. Đổi version trong `Cargo.toml`, đồng bộ `Cargo.lock` bằng `cargo check` và commit mã.
2. Tạo và push tag trùng phiên bản, ví dụ `v2.26.1`.
3. Workflow `.github/workflows/release.yml` build/test Windows và Mac Universal, rồi tạo release có đủ các asset sau khi cả hai job đạt. Nếu build lỗi, release chưa được công bố. Có thể chạy workflow thủ công để lấy artifact mà chưa phát hành.

GitHub cung cấp trường `digest: sha256:...` cho asset qua [Releases API](https://docs.github.com/en/rest/releases/releases). Không dùng file source ZIP tự sinh của GitHub làm gói cập nhật. Log và bản dự phòng nằm trong thư mục `Chatwork/updates` cạnh file cấu hình. Bản này chưa được push/tag hay phát hành lên GitHub từ phiên làm việc này.

Kiểm tra bổ sung:

```powershell
node examples/files-regression.cjs
node examples/toolkit-regression.cjs
./build.ps1
powershell -ExecutionPolicy Bypass -File ./examples/ota-windows-regression.ps1
```

## 🏗️ Kiến trúc

| Thành phần | Electron (gốc) | Rust (bản mới) |
|---|---|---|
| Runtime | Node.js 24 + Chromium | Native Rust binary |
| WebView | Chromium embedded | WebView2 (Windows built-in) |
| Window | Electron BrowserWindow | `tao` crate |
| IPC | Electron IPC | JSON messages qua `wry` IPC |
| Config | electron-store (JSON) | Custom JSON config |
| Tray | Electron Tray | `tao` SystemTray |
| Notifications | Electron Notification | `notify-rust` crate |
| Size | ~250MB | ~5-10MB |

## ✅ Tính năng được tái hiện

Từ phân tích file `dist/chatwork_main.js` (595KB bundled):

- **Multi-tab browsing** – Hỗ trợ nhiều tab (Chatwork, KDDI/Chatwork, services khác)
- **System tray** – Icon tray với badge count (số tin chưa đọc)
- **Notifications** – Desktop notification khi có tin nhắn mới
- **Zoom** – Zoom In/Out/Reset (Ctrl+/-, 0) giống bản gốc
- **Window state** – Lưu/phục hồi vị trí, kích thước cửa sổ
- **Config persistence** – Lưu tất cả settings vào `%APPDATA%\Chatwork\config.json`
- **Auto-launch** – Tùy chọn khởi động cùng Windows
- **Proxy support** – Qua WebView2 proxy settings
- **Custom User-Agent** – Giống Electron app gốc
- **Context menu** – Copy/Paste/Save Image/Copy Link
- **Menu bar** – File/Edit/View/Go/Window/Help đầy đủ
- **IPC bridge** – JS→Rust communication qua `window.__chatwork_ipc`
- **Close to tray** – Đóng cửa sổ → ẩn xuống tray (không thoát)
- **Developer Tools** – Mở DevTools bằng Ctrl+Shift+I

## 🔧 Yêu cầu build

### 1. Cài đặt Rust
```powershell
# Tải và chạy rustup
Invoke-WebRequest https://win.rustup.rs -OutFile rustup-init.exe
.\rustup-init.exe

# Thêm Windows MSVC target
rustup target add x86_64-pc-windows-msvc

# Cài Visual Studio Build Tools (nếu chưa có)
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

### 2. Yêu cầu hệ thống
- **Windows 10/11** (cần WebView2 Runtime - đã có sẵn trên Windows 11)
- **WebView2 Runtime**: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- **Visual Studio Build Tools** với MSVC toolchain

### 3. Build

```powershell
# Debug build (nhanh, có console)
cargo build

# Release build (tối ưu, không console)
cargo build --release --target x86_64-pc-windows-msvc

# Chạy thử
cargo run
```

### 4. Build installer

```powershell
# Dùng script tự động
.\build.ps1

# Hoặc dùng cargo-wix (WiX installer)
cargo install cargo-wix
cargo wix init
cargo wix

# Hoặc NSIS
makensis installer.nsi
```

## 📁 Cấu trúc project

```
chatwork-rs/
├── src/
│   ├── main.rs          # Entry point, event loop chính
│   ├── app.rs           # Constants, shared state, IPC types
│   ├── config.rs        # Persistent config (thay electron-store)
│   ├── menu.rs          # Menu bar + context menu
│   ├── tray.rs          # System tray + badge icon
│   ├── notification.rs  # Desktop notifications
│   └── updater.rs       # Auto-update (Squirrel-compatible)
├── assets/
│   └── chatwork.ico     # App icon (copy từ bản gốc)
├── build.rs             # Windows resource embedding
├── build.ps1            # Build & package script
├── installer.nsi        # NSIS installer script
└── Cargo.toml           # Dependencies
```

## 🎯 Nguyên tắc hoạt động

App hoạt động như một **thin native wrapper** xung quanh WebView2:

1. **Khởi động**: Load config → Tạo window native → Khởi tạo WebView2
2. **WebView**: Load `https://www.chatwork.com` với custom User-Agent
3. **Init script**: Inject JavaScript để:
   - Áp dụng zoom đã lưu
   - Expose `window.__chatwork_ipc` API
   - Monitor title changes để detect unread count
4. **IPC**: Renderer JS → JSON message → Rust handler → native action
5. **Tray**: Đóng window → ẩn xuống tray, click tray → show window

## ⚠️ Lưu ý

- Đây là **client wrapper** - toàn bộ logic Chatwork chạy trên server của Chatwork
- Cần **WebView2 Runtime** trên máy người dùng (đã có sẵn trên Windows 11)
- Tài khoản đăng nhập được lưu bởi WebView2 session (giống browser)
- Không phải port Electron→Rust của UI/logic - mà là native host mới cho cùng web app

## 📊 So sánh kích thước

| | Electron app gốc | Rust app mới |
|---|---|---|
| Installer | ~153MB | ~5-10MB |
| RAM (idle) | ~200-400MB | ~30-80MB |
| Startup | 2-4s | 0.3-1s |
| CPU (idle) | 1-5% | <0.5% |


## Chatwork Toolkit tích hợp

- Quick tag: Info, Info có tiêu đề, Code và đường kẻ ngang nằm trên thanh công cụ soạn tin. Mention dùng cú pháp `@tên`; hai nút @ và tag tất cả đã được bỏ.
- Mention: gõ `@tên`, tìm có/không dấu và tên nhiều từ, chọn bằng ↑/↓ và Enter/Tab; danh sách đánh dấu người đã tag. Đọc cả thành viên nhóm liên quan từ Chatwork hiện tại.
- Emoji: chọn emoji thường dùng và emoji gần đây qua nút ☺. Toolkit ghi nhớ lịch sử khi chèn hoặc gõ emoji; số mục gần đây có thể chỉnh từ 1 đến 50 trong ⚙.
- Ngôn ngữ: Auto, tiếng Việt, English, 日本語 trong ⚙.
- Nghỉ phép: nút hiển thị trong nhóm **Attendance infor_THKHN**. Chọn ngày rời rạc hoặc khoảng ngày, bỏ từng ngày, nhập giờ bắt đầu/kết thúc hoặc chọn giờ gợi ý. Lý do gợi ý bằng tiếng Anh/Nhật, tùy chọn ngôn ngữ nội dung. Request có dạng:

```text
[info]
- Request: PAID_LEAVE
- Time: 08:00 - 17:00  12/11/2026
- Reason: Personal matter
[/info]
```

  Nhiều ngày được xuất thành nhiều dòng `- Time:`; giờ nghỉ áp dụng cho mọi ngày đã chọn. Có xem trước, sao chép, chèn hoặc gửi; thiếu ngày, lý do hoặc giờ không hợp lệ sẽ được báo ngay trên form.
- Pull Request: nút **PR** xuất hiện trong nhóm **【HN】Source Code Review** và chèn mẫu trực tiếp vào ô chat, không mở popup. Tên dự án được nhớ khi sửa trong mẫu.
- Copy code: nút Copy ở góc khối code.
- Link tin nhắn mở trong cửa sổ hiện tại; click trực tiếp vào thông báo hoặc nút mở thông báo khôi phục cửa sổ và gọi xử lý click của đúng thông báo. Khi có dữ liệu phòng/tin nhắn, dùng dữ liệu đó để điều hướng.

Phần **File manager** được bổ sung từ 2.26.0 với phân loại file và tìm kiếm; xem giới hạn nguồn dữ liệu ở mục phiên bản trên.

Kiểm tra hồi quy JavaScript (cần Node.js):

```powershell
node examples/mention-regression.cjs
node examples/request-navigation-regression.cjs
node examples/toolkit-regression.cjs
node examples/ui-render-regression.cjs
cargo check --offline
```

Build và chạy test Rust cho bản Windows GNU bằng `./build.ps1`. Script liên kết app và test bằng LLVM LLD có sẵn trong Rust để tránh lỗi khởi động `0xc0000005` của GNU ld trong toolchain hiện tại. Kết quả gồm bộ cài `dist/THK-ChatSetup-v2.25.14.exe` và bản portable `dist/THK-Chat-v2.25.14-Windows-x64.zip`.

Giao diện Toolkit mới dùng `src/ui.css`: popup có nội dung cuộn, footer cố định và bố cục thích ứng với cửa sổ nhỏ. Preview hiển thị thẻ Chatwork (Info, Title, Code, Quote, HR, TO), giữ nguyên Markdown dạng chữ; nền màu và khoảng trắng của nội dung được giữ. Các nút chèn thẻ thêm dòng mới sau thẻ đóng. Compact mode đã được bỏ theo yêu cầu. Copy code nhận diện khối code lồng bên trong tin nhắn và giữ nguyên thụt dòng/khoảng trắng.

Ảnh trong Mention được chuẩn hóa từ đường dẫn `/avatar/...` sang máy chủ ảnh Chatwork; ảnh không tải được sẽ hiển thị chữ cái đầu của tên. Popup mở từ đầu nội dung, không tự cuộn xuống ô lý do.

Form nghỉ có thêm tìm kiếm/chọn nhiều leader từ thành viên phòng. Mỗi leader được xuất thành một dòng `[To:ID] Tên` phía trên khối `[info]`. Danh sách ID được lưu sau khi sao chép, chèn hoặc gửi request và được khôi phục lần sau; dữ liệu được tách riêng theo tài khoản và phòng chat. Có thể bỏ từng người đã chọn. Các trường hợp đổi phòng khi form đang mở hoặc leader đã lưu chưa tải được đều được kiểm tra trước khi chèn/gửi.

## THK-Chat 2.25.13

Bộ nhận diện dùng bản Original trong `THK-Chat-Logo-Pack`: icon Windows, tray, taskbar, macOS ICNS, tên cửa sổ/About/thông báo và gói cài đặt đều dùng THK-Chat. Có thể đồng bộ lại tài nguyên bằng `node examples/sync-brand-assets.cjs`.

Nút PR chèn trực tiếp mẫu sau; tên dự án đã nhập được dùng lại ở lần chèn tiếp theo:

```text
[toall]
[info]
Project name: 
Pull Request: 
Spec: 
Thời gian review dự kiến: 
[/info]
```

Trong ô chat hoặc textarea mô tả đang được chọn: Ctrl/Cmd+I chèn Info; Ctrl/Cmd+Shift+I chèn Info có Title; Ctrl/Cmd+K chèn Code; Ctrl/Cmd+H chèn HR; Ctrl/Cmd+Shift+P mở Preview. Preview mô tả không có chức năng gửi tin nhắn chat.

Build Mac Universal trên Windows: `powershell -ExecutionPolicy Bypass -File .\build-mac-docker.ps1` (cần Docker Desktop có quyền truy cập). Trên Mac: `bash build-mac.sh --universal`. Script đọc phiên bản từ Cargo.toml, ghép Intel + Apple Silicon và tạo `dist/THK-Chat-v2.25.14-macOS-Universal.tar.gz`; trên Mac có thêm ZIP và DMG được ký ad-hoc. Chưa có chữ ký Developer ID/notarization.

## THK-Chat 2.25.14

Tải file được giữ trong phiên WebView, bao gồm link mở cửa sổ mới và blob. File được lưu vào Downloads hoặc `download_dir` trong cấu hình; nếu trùng tên sẽ thêm số và không ghi đè file cũ. Có thông báo tải xong/thất bại. Icon Copy chỉ hiển thị trên khối code thực sự, không xuất hiện trên nội dung thường hoặc Info.

Kiểm thử bổ sung: `node examples/downloads-regression.cjs`, `node examples/formatting-editors-regression.cjs`, `node examples/branding-regression.cjs`.
