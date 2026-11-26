import Foundation

enum WebPolicy {
    static let attendanceMiniAppURL = URL(string: "https://attendance.thk-hd-hn.vn/")!
    static let attendanceMiniAppTitle = "THK Quick Leave"

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

    static func isMiniApp(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        return host == "attendance.thk-hd-hn.vn"
    }

    static func isMiniAppNavigation(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased() else { return false }
        if matches(host, "thk-hd-hn.vn") { return true }
        return ["auth0.com", "google.com", "gstatic.com", "googleapis.com",
                "accounts.youtube.com", "apple.com", "appleid.apple.com",
                "microsoft.com", "microsoftonline.com", "live.com"].contains { matches(host, $0) }
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

    static func messageTarget(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("#!rid") || trimmed.hasPrefix("#_rid") else { return nil }
        let body = String(trimmed.dropFirst(5))
        let parts = body.split(separator: "-", omittingEmptySubsequences: false)
        guard (parts.count == 1 || parts.count == 2),
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }) else { return nil }
        return "#!rid" + body
    }

    static func notificationActivationScript(id: String, target: String) -> String? {
        let cleanId = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanTarget = messageTarget(target)
        switch (!cleanId.isEmpty, cleanTarget) {
        case (true, let resolvedTarget?):
            return "if (!window.__thk_notificationClicked?.(\(scriptValue(cleanId)))) window.__thk_navigateToMessage?.(\(scriptValue(resolvedTarget)));"
        case (true, nil):
            return "window.__thk_notificationClicked?.(\(scriptValue(cleanId)));"
        case (false, let resolvedTarget?):
            return "window.__thk_navigateToMessage?.(\(scriptValue(resolvedTarget)));"
        case (false, nil):
            return nil
        }
    }
}
