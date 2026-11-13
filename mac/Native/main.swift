import AppKit
import WebKit
import UserNotifications
import ImageIO

private struct DownloadDestination {
    let selected: URL
    let directory: URL
    var temporary: URL { directory.appendingPathComponent("download") }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate,
    UNUserNotificationCenterDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusItem: NSStatusItem!
    private var popups: [NSWindow] = []
    private var downloads: [ObjectIdentifier: WKDownload] = [:]
    private var downloadDestinations: [ObjectIdentifier: DownloadDestination] = [:]
    private var updater: NativeUpdater!
    private let defaults = UserDefaults.standard
    private var zoom: Double = 1
    private let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"

    func applicationDidFinishLaunching(_ notification: Notification) {
        // LaunchServices normally reuses the app; also handle direct binary launches.
        if let id = Bundle.main.bundleIdentifier,
           let other = NSRunningApplication.runningApplications(withBundleIdentifier: id)
            .first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            other.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            NSApp.terminate(nil)
            return
        }
        zoom = defaults.object(forKey: "native.zoom") as? Double ?? 1
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "THK-Chat/\(version)"
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.userContentController.add(self, name: "native")
        do {
            let resources = Bundle.main.resourceURL!
            let css = try String(contentsOf: resources.appendingPathComponent("ui.css"), encoding: .utf8)
            let brand = try String(contentsOf: resources.appendingPathComponent("icon.svg"), encoding: .utf8)
            var script = """
            if (location.protocol === 'https:' && ['chatwork.com','kcw.kddi.ne.jp','kcw.kddi.com'].some(d => location.hostname === d || location.hostname.endsWith('.' + d))) {
            window.ipc = { postMessage: message => window.webkit.messageHandlers.native.postMessage(message) };
            window.__thk_ui_css = \(WebPolicy.scriptValue(css));
            window.__thk_brand_icon_svg = \(WebPolicy.scriptValue(brand));
            """
            for file in ["injected.js", "toolkit.js", "room-folders.js", "downloads.js", "files.js", "file-preview.js", "update-ui.js"] {
                script += "\n" + (try String(contentsOf: resources.appendingPathComponent(file), encoding: .utf8))
            }
            script += "\n}"
            script = script.replacingOccurrences(of: "__VERSION__", with: version)
                .replacingOccurrences(of: "__ZOOM__", with: String(zoom))
            configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        } catch {
            showError("Cannot load application resources", error)
            NSApp.terminate(nil)
            return
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "THK-Chat"
        window.minSize = NSSize(width: 500, height: 400)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("THKNativeWindow")
        window.tabbingMode = .disallowed
        buildMenu()
        buildStatusItem()
        updater = NativeUpdater(version: version) { [weak self] state in
            self?.evaluate("window.__thk_updateState?.(\(WebPolicy.scriptValue(state))); ")
        }
        let notifications = UNUserNotificationCenter.current()
        notifications.delegate = self
        notifications.requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
            if let error = error { NSLog("Notification authorization: %@", error.localizedDescription) }
        }
        let saved = defaults.string(forKey: "native.lastURL").flatMap(URL.init(string:))
        webView.load(URLRequest(url: saved.flatMap { WebPolicy.isChat($0) ? $0 : nil } ?? URL(string: "https://www.chatwork.com")!))
        showWindow()
        updater.start()
    }

    private func item(_ title: String, _ action: Selector, _ key: String = "", in menu: NSMenu) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        menu.addItem(item)
    }

    private func buildMenu() {
        let menu = NSMenu()
        func submenu(_ title: String) -> NSMenu {
            let item = NSMenuItem(); let sub = NSMenu(title: title)
            item.submenu = sub; menu.addItem(item); return sub
        }
        let app = submenu("THK-Chat")
        item("About THK-Chat", #selector(about), in: app)
        item("Settings…", #selector(settings), ",", in: app)
        item("Check for Updates…", #selector(checkUpdates), in: app)
        app.addItem(.separator())
        let services = NSMenu(); let servicesItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesItem.submenu = services; app.addItem(servicesItem); NSApp.servicesMenu = services
        app.addItem(.separator())
        app.addItem(withTitle: "Hide THK-Chat", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        item("Quit THK-Chat", #selector(quit), "q", in: app)
        let file = submenu("File")
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let edit = submenu("Edit")
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: NSSelectorFromString(selector), keyEquivalent: key)
        }
        let redo = edit.insertItem(withTitle: "Redo", action: NSSelectorFromString("redo:"), keyEquivalent: "z", at: 1)
        redo.keyEquivalentModifierMask = [.command, .shift]
        let view = submenu("View")
        item("Reload", #selector(reload), "r", in: view)
        item("Zoom In", #selector(zoomIn), "+", in: view)
        item("Zoom Out", #selector(zoomOut), "-", in: view)
        item("Actual Size", #selector(resetZoom), "0", in: view)
        view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.control, .command]
        let navigate = submenu("Go")
        item("Back", #selector(back), "[", in: navigate)
        item("Forward", #selector(forward), "]", in: navigate)
        let windows = submenu("Window")
        windows.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        item("Show THK-Chat", #selector(showWindow), in: windows)
        NSApp.windowsMenu = windows
        NSApp.mainMenu = menu
    }

    private func buildStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "bubble.left.and.bubble.right", accessibilityDescription: "THK-Chat")
        let menu = NSMenu()
        item("Show THK-Chat", #selector(showWindow), in: menu)
        item("Check for Updates…", #selector(checkUpdates), in: menu)
        item("Quit THK-Chat", #selector(quit), in: menu)
        statusItem.menu = menu
    }

    @objc func showWindow() {
        window?.deminiaturize(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func about() { NSApp.orderFrontStandardAboutPanel(nil) }
    @objc private func settings() { evaluate("window.__thkToolkit?.openSettings();") }
    @objc private func checkUpdates() { updater.check(open: true) }
    @objc private func reload() { webView.reload() }
    @objc private func back() { webView.goBack() }
    @objc private func forward() { webView.goForward() }
    @objc private func zoomIn() { setZoom(zoom + 0.1) }
    @objc private func zoomOut() { setZoom(zoom - 0.1) }
    @objc private func resetZoom() { setZoom(1) }
    private func setZoom(_ value: Double) {
        zoom = min(1.5, max(0.5, (value * 10).rounded() / 10))
        defaults.set(zoom, forKey: "native.zoom")
        evaluate("document.documentElement.style.zoom = \(zoom);")
    }
    private func evaluate(_ script: String) { webView?.evaluateJavaScript(script, completionHandler: nil) }
    private func showError(_ title: String, _ error: Error) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = error.localizedDescription
        if let window = window { alert.beginSheetModal(for: window) } else { alert.runModal() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showWindow(); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === window { sender.orderOut(nil); return false }
        return true
    }
    func windowWillClose(_ notification: Notification) {
        if let closed = notification.object as? NSWindow { popups.removeAll { $0 === closed } }
    }
    func applicationWillTerminate(_ notification: Notification) {
        if let url = webView?.url, WebPolicy.isChat(url) { defaults.set(url.absoluteString, forKey: "native.lastURL") }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, WebPolicy.isChat(url),
              let text = message.body as? String, let data = text.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = object["type"] as? String else { return }
        switch type {
        case "SetBadgeCount":
            let count = max(0, (object["payload"] as? NSNumber)?.intValue ?? 0)
            NSApp.dockTile.badgeLabel = count > 0 ? (count > 99 ? "99+" : String(count)) : nil
            window.title = count > 0 ? "[\(count)] THK-Chat" : "THK-Chat"
        case "ShowNotification":
            if let payload = object["payload"] as? [String: Any] { notify(payload) }
        case "GoBack": webView.goBack()
        case "GoForward": webView.goForward()
        case "Reload": webView.reload()
        case "SetZoomFactor": if let value = object["payload"] as? Double, value.isFinite { setZoom(value) }
        case "Logout":
            let store = webView.configuration.websiteDataStore
            store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
                let chat = records.filter { record in ["chatwork.com", "kcw.kddi.ne.jp", "kcw.kddi.com"].contains { WebPolicy.matches(record.displayName, $0) } }
                store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: chat) { [weak self] in
                    self?.webView.load(URLRequest(url: URL(string: "https://www.chatwork.com")!))
                }
            }
        case "CheckForUpdates": updater.check(open: true)
        case "DownloadUpdate": updater.download()
        case "InstallUpdate": updater.install()
        case "UpdateUiReady": updater.publish()
        case "WriteLogError": NSLog("Web: %@", String(describing: object["payload"] ?? ""))
        default: break
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.shouldPerformDownload { decisionHandler(.download); return }
        if WebPolicy.isInternal(url) || ["about", "blob", "data"].contains(url.scheme ?? "") {
            decisionHandler(.allow)
        } else {
            if action.targetFrame?.isMainFrame != false, ["http", "https", "mailto", "tel"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(!response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { track(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { track(download) }
    private func track(_ download: WKDownload) { downloads[ObjectIdentifier(download)] = download; download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = URL(fileURLWithPath: suggestedFilename).lastPathComponent
        panel.canCreateDirectories = true
        if let saved = defaults.string(forKey: "native.downloadDirectory") { panel.directoryURL = URL(fileURLWithPath: saved) }
        panel.beginSheetModal(for: window) { [weak self] result in
            let destination = result == .OK ? panel.url : nil
            if let destination = destination {
                do {
                    let directory = destination.deletingLastPathComponent().appendingPathComponent(".thk-download-" + UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
                    let pending = DownloadDestination(selected: destination, directory: directory)
                    self?.defaults.set(destination.deletingLastPathComponent().path, forKey: "native.downloadDirectory")
                    self?.downloadDestinations[ObjectIdentifier(download)] = pending
                    // WKDownload requires a nonexistent destination. Keep an existing file
                    // until the replacement has downloaded successfully.
                    completionHandler(pending.temporary)
                    return
                } catch { self?.showError("Cannot save download", error) }
            } else { self?.downloads.removeValue(forKey: ObjectIdentifier(download)) }
            completionHandler(nil)
        }
    }
    func downloadDidFinish(_ download: WKDownload) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        if let pending = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) {
            defer { try? FileManager.default.removeItem(at: pending.directory) }
            do {
                if FileManager.default.fileExists(atPath: pending.selected.path) {
                    _ = try FileManager.default.replaceItemAt(pending.selected, withItemAt: pending.temporary)
                } else { try FileManager.default.moveItem(at: pending.temporary, to: pending.selected) }
                notify(["title": "Download complete", "body": pending.selected.lastPathComponent])
            } catch { showError("Cannot finish saving download", error) }
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        if let pending = downloadDestinations.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: pending.directory) }
        if (error as NSError).code != NSURLErrorCancelled { showError("Download failed", error) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, !WebPolicy.isInternal(url), url.absoluteString != "about:blank" {
            if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
            return nil
        }
        // WebKit supplies the configuration so OAuth popups keep their opener and cookies.
        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.navigationDelegate = self; popup.uiDelegate = self
        let host = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 700), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        host.title = "THK-Chat — Sign in"; host.contentView = popup; host.delegate = self
        host.isReleasedWhenClosed = false; host.center(); host.makeKeyAndOrderFront(nil)
        popups.append(host)
        return popup
    }
    func webViewDidClose(_ webView: WKWebView) { popups.first { $0.contentView === webView }?.close() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === self.webView else { return }
        evaluate("document.documentElement.style.zoom = \(zoom);")
        if let url = webView.url, WebPolicy.isChat(url) { defaults.set(url.absoluteString, forKey: "native.lastURL") }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showError("Cannot open Chatwork", error) }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories; panel.canChooseFiles = true
        panel.beginSheetModal(for: webView.window ?? window) { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.beginSheetModal(for: webView.window ?? window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: webView.window ?? window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt
        let input = NSTextField(string: defaultText ?? ""); input.frame = NSRect(x: 0, y: 0, width: 300, height: 24)
        alert.accessoryView = input; alert.addButton(withTitle: "OK"); alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: webView.window ?? window) { completionHandler($0 == .alertFirstButtonReturn ? input.stringValue : nil) }
    }

    private func notify(_ payload: [String: Any]) {
        let content = UNMutableNotificationContent()
        content.title = payload["title"] as? String ?? "THK-Chat"
        content.body = payload["body"] as? String ?? ""
        content.sound = .default
        content.userInfo = ["id": payload["id"] as? String ?? "", "target": payload["target"] as? String ?? ""]
        content.categoryIdentifier = "CHAT_MESSAGE"
        let category = UNNotificationCategory(identifier: "CHAT_MESSAGE", actions: [], intentIdentifiers: [], options: [.customDismissAction])
        UNUserNotificationCenter.current().setNotificationCategories([category])
        let identifier = payload["id"] as? String ?? UUID().uuidString
        func deliver(directory: URL? = nil) {
            let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(request) { error in
                if let directory = directory { try? FileManager.default.removeItem(at: directory) }
                if let error = error { NSLog("Notification: %@", error.localizedDescription) }
            }
        }
        guard let icon = payload["icon"] as? String, let url = URL(string: icon), WebPolicy.isChat(url) else { deliver(); return }
        var request = URLRequest(url: url); request.timeoutInterval = 5
        URLSession.shared.downloadTask(with: request) { file, response, _ in
            var directory: URL?
            if (response as? HTTPURLResponse)?.statusCode == 200, let file = file,
               let size = try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber, size.intValue < 5_000_000,
               let source = CGImageSourceCreateWithURL(file as CFURL, nil),
               let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
               let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
               width > 0, height > 0, width <= 2048, height <= 2048,
               let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
               let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) {
                do {
                    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("thk-avatar-" + UUID().uuidString, isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
                    directory = folder
                    let avatar = folder.appendingPathComponent("avatar.png"); try png.write(to: avatar)
                    content.attachments = [try UNNotificationAttachment(identifier: "avatar", url: avatar)]
                } catch { NSLog("Notification avatar: %@", error.localizedDescription) }
            }
            DispatchQueue.main.async { deliver(directory: directory) }
        }.resume()
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { completionHandler(); return }
            let info = response.notification.request.content.userInfo
            let id = WebPolicy.scriptValue(info["id"] as? String ?? "")
            if response.actionIdentifier == UNNotificationDismissActionIdentifier {
                self.evaluate("window.__thk_notificationClosed?.(\(id));")
            } else {
                self.showWindow()
                let target = info["target"] as? String ?? ""
                if target.hasPrefix("#!rid") || target.hasPrefix("#_rid") {
                    self.evaluate("if (!window.__thk_notificationClicked?.(\(id))) window.__thk_navigateToMessage?.(\(WebPolicy.scriptValue(target)));")
                }
            }
            completionHandler()
        }
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.setActivationPolicy(.regular)
application.delegate = delegate
application.run()
