import Foundation

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
        precondition(WebPolicy.isNewer("2.27.0", than: "2.26.2"))
        precondition(WebPolicy.isNewer("2.26.10", than: "2.26.2"))
        precondition(!WebPolicy.isNewer("2.26.2", than: "2.26.2"))
        precondition(!WebPolicy.isNewer("2.25.9", than: "2.26.2"))
        precondition(!WebPolicy.isNewer("2.27.0-beta", than: "2.26.2"))
        let text = "quotes \" and newline\nUnicode 日本語 and \\"
        let encoded = WebPolicy.scriptValue(text)
        let decoded = try! JSONSerialization.jsonObject(with: Data(encoded.utf8), options: [.fragmentsAllowed]) as! String
        precondition(decoded == text)
        print("Swift URL policy, version comparison and IPC escaping checks passed.")
    }
}
