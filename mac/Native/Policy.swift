import Foundation

enum WebPolicy {
    static func matches(_ host: String, _ domain: String) -> Bool {
        host == domain || host.hasSuffix("." + domain)
    }

    static func isChat(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        return ["chatwork.com", "kcw.kddi.ne.jp", "kcw.kddi.com"].contains { matches(host, $0) }
    }

    static func isInternal(_ url: URL) -> Bool {
        if isChat(url) { return true }
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        return ["auth0.com", "accounts.google.com", "appleid.apple.com",
                "login.microsoftonline.com", "login.live.com"].contains { matches(host, $0) }
    }

    static func isNewer(_ candidate: String, than current: String) -> Bool {
        let parts = candidate.split(separator: ".").compactMap { Int($0) }
        let old = current.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 3, old.count == 3 else { return false }
        return old.lexicographicallyPrecedes(parts)
    }

    static func scriptValue(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }
}
