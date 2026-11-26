import Foundation
import ImageIO

@main
struct PolicyTests {
    static func main() {
        for address in ["https://www.chatwork.com/#!rid7", "https://kcw.kddi.ne.jp/", "https://api.chatwork.com/"] {
            precondition(WebPolicy.isChat(URL(string: address)!))
        }
        for address in ["https://chatwork.com.evil.test/", "https://evil.test/?chatwork.com", "https://evilchatwork.com/", "http://www.chatwork.com", "file:///chatwork.com"] {
            precondition(!WebPolicy.isInternal(URL(string: address)!))
        }
        precondition(WebPolicy.isInternal(URL(string: "https://accounts.google.com/o/oauth2/auth")!))
        precondition(!WebPolicy.isChat(URL(string: "https://accounts.google.com/")!))
        precondition(WebPolicy.isMiniApp(URL(string: "https://attendance.thk-hd-hn.vn/")!))
        precondition(WebPolicy.isMiniApp(URL(string: "https://attendance.thk-hd-hn.vn/requests")!))
        for address in ["http://attendance.thk-hd-hn.vn/", "https://attendance.thk-hd-hn.vn.evil.test/", "https://evil.test/?attendance.thk-hd-hn.vn", "https://sub.attendance.thk-hd-hn.vn/", "javascript:alert(1)"] {
            precondition(!WebPolicy.isMiniApp(URL(string: address)!))
        }
        precondition(WebPolicy.isMiniAppNavigation(URL(string: "https://attendance.thk-hd-hn.vn/auth/google/callback")!))
        precondition(WebPolicy.isMiniAppNavigation(URL(string: "https://accounts.google.com/o/oauth2/auth")!))
        precondition(!WebPolicy.isMiniAppNavigation(URL(string: "https://evil.test/")!))
        precondition(WebPolicy.isNewer("2.27.0", than: "2.26.2"))
        precondition(WebPolicy.isNewer("2.26.10", than: "2.26.2"))
        precondition(!WebPolicy.isNewer("2.26.2", than: "2.26.2"))
        precondition(!WebPolicy.isNewer("2.25.9", than: "2.26.2"))
        precondition(!WebPolicy.isNewer("2.27.0-beta", than: "2.26.2"))
        let text = "quotes \" and newline\nUnicode 日本語 and \\"
        let encoded = WebPolicy.scriptValue(text)
        let decoded = try! JSONSerialization.jsonObject(with: Data(encoded.utf8), options: [.fragmentsAllowed]) as! String
        precondition(decoded == text)
        precondition(WebPolicy.messageTarget("#!rid123-456") == "#!rid123-456")
        precondition(WebPolicy.messageTarget("#_rid123") == "#!rid123")
        precondition(WebPolicy.messageTarget("javascript:alert(1)") == nil)
        precondition(WebPolicy.messageTarget("#!rid123-abc") == nil)
        precondition(WebPolicy.notificationActivationScript(id: "toast-1", target: "") == "window.__thk_notificationClicked?.(\"toast-1\");")
        precondition(WebPolicy.notificationActivationScript(id: "toast-2", target: "#_rid11-22") == "if (!window.__thk_notificationClicked?.(\"toast-2\")) window.__thk_navigateToMessage?.(\"#!rid11-22\");")
        precondition(WebPolicy.notificationActivationScript(id: "", target: "#!rid99-100") == "window.__thk_navigateToMessage?.(\"#!rid99-100\");")
        precondition(WebPolicy.notificationActivationScript(id: "", target: "") == nil)
        let notificationIcon = URL(fileURLWithPath: "assets/AppIcon.icns")
        guard let iconSource = CGImageSourceCreateWithURL(notificationIcon as CFURL, nil) else {
            preconditionFailure("The macOS notification app icon must decode")
        }
        precondition(CGImageSourceGetCount(iconSource) > 0)
        precondition(CGImageSourceCreateImageAtIndex(iconSource, 0, nil) != nil)
        print("Swift URL policy, version comparison, IPC escaping, notification activation and icon decoding checks passed.")
    }
}
