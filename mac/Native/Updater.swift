import AppKit

// All state is confined to the main queue; network and package validation run off it.
final class NativeUpdater {
    private let current: String
    private let emit: ([String: Any]) -> Void
    private var state: [String: Any]
    private var timer: Timer?
    private var asset: URL?
    private var digest = ""
    private var work: URL?
    private var helper: URL?
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 1800
        return URLSession(configuration: config)
    }()

    init(version: String, emit: @escaping ([String: Any]) -> Void) {
        current = version; self.emit = emit
        state = ["phase": "idle", "current_version": version]
    }
    func start() {
        check()
        timer = Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in self?.check() }
        timer?.tolerance = 300
    }
    func publish(open: Bool = false) {
        var snapshot = state; snapshot["open"] = open; emit(snapshot)
    }
    private func fail(_ error: Error, open: Bool = true) {
        state["phase"] = "error"; state["message"] = error.localizedDescription; publish(open: open)
    }
    private func failure(_ message: String) -> Error { NSError(domain: "THKUpdater", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

    func check(open: Bool = false) {
        if ["checking", "downloading", "installing", "ready"].contains(state["phase"] as? String ?? "") { publish(open: open); return }
        state = ["phase": "checking", "current_version": current]; publish(open: open)
        var request = URLRequest(url: URL(string: "https://api.github.com/repos/mrbinh008/chatwork-rust/releases/latest")!)
        request.setValue("THK-Chat/\(current)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                do {
                    if let error = error { throw error }
                    guard (response as? HTTPURLResponse)?.statusCode == 200, let data = data,
                          let release = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                          release["draft"] as? Bool == false, release["prerelease"] as? Bool == false,
                          let tag = release["tag_name"] as? String else { throw self.failure("Cannot read the latest stable release.") }
                    let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
                    guard WebPolicy.isNewer(version, than: self.current) else {
                        self.state["phase"] = "current"; self.publish(); return
                    }
                    let name = "THK-Chat-v\(version)-macOS-Universal.tar.gz"
                    guard let assets = release["assets"] as? [[String: Any]],
                          let asset = assets.first(where: { $0["name"] as? String == name }),
                          let address = asset["browser_download_url"] as? String, let url = URL(string: address),
                          url.scheme == "https", url.host == "github.com",
                          url.path == "/mrbinh008/chatwork-rust/releases/download/\(tag)/\(name)",
                          let hash = asset["digest"] as? String, hash.hasPrefix("sha256:"),
                          hash.dropFirst(7).range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil,
                          let size = asset["size"] as? Int, size > 0 else { throw self.failure("Release is missing a verified macOS Universal package.") }
                    self.asset = url; self.digest = String(hash.dropFirst(7)).lowercased()
                    self.state["version"] = version; self.state["total"] = size
                    self.state["release_url"] = "https://github.com/mrbinh008/chatwork-rust/releases/tag/\(tag)"
                    self.state["notes"] = release["body"] as? String ?? ""
                    self.state["phase"] = "available"; self.publish()
                } catch { self.fail(error, open: open) }
            }
        }.resume()
    }

    func download() {
        guard state["phase"] as? String == "available", let asset = asset, let version = state["version"] as? String else { return }
        state["phase"] = "downloading"; publish()
        do {
            let fm = FileManager.default
            let root = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("THK-Chat/updates", isDirectory: true)
            let work = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try fm.createDirectory(at: work, withIntermediateDirectories: true)
            guard let bundled = Bundle.main.url(forResource: "macos-update", withExtension: "sh") else { throw failure("Missing update helper.") }
            let helper = work.appendingPathComponent("macos-update.sh")
            try fm.copyItem(at: bundled, to: helper)
            self.work = work; self.helper = helper
            let expectedSize = state["total"] as? Int ?? 0
            let digest = self.digest
            let installed = Bundle.main.bundleURL.path
            session.downloadTask(with: asset) { [weak self] temp, response, error in
                do {
                    if let error = error { throw error }
                    guard (response as? HTTPURLResponse)?.statusCode == 200, let temp = temp else {
                        throw NSError(domain: "THKUpdater", code: 2, userInfo: [NSLocalizedDescriptionKey: "Package download failed."])
                    }
                    let actual = (try fm.attributesOfItem(atPath: temp.path)[.size] as? NSNumber)?.intValue
                    guard actual == expectedSize else { throw NSError(domain: "THKUpdater", code: 3, userInfo: [NSLocalizedDescriptionKey: "Downloaded package size does not match the release."]) }
                    try fm.moveItem(at: temp, to: work.appendingPathComponent("package.download"))
                    // The existing helper validates SHA-256, archive entries, bundle ID and version.
                    let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/sh")
                    process.arguments = [helper.path, "Prepare", work.path, installed, version, digest, work.appendingPathComponent("result.json").path]
                    let log = work.appendingPathComponent("prepare.log")
                    fm.createFile(atPath: log.path, contents: nil)
                    let output = try FileHandle(forWritingTo: log); defer { try? output.close() }
                    process.standardOutput = output; process.standardError = output
                    try process.run(); process.waitUntilExit()
                    guard process.terminationStatus == 0 else { throw NSError(domain: "THKUpdater", code: 4, userInfo: [NSLocalizedDescriptionKey: "Package validation failed. See \(log.path)"]) }
                    DispatchQueue.main.async { self?.state["phase"] = "ready"; self?.publish() }
                } catch { DispatchQueue.main.async { self?.fail(error) } }
            }.resume()
        } catch { fail(error) }
    }

    func install() {
        guard state["phase"] as? String == "ready", let work = work, let helper = helper,
              let version = state["version"] as? String else { return }
        do {
            let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/sh")
            process.arguments = [helper.path, "Install", work.path, Bundle.main.bundleURL.path, version, digest,
                                 work.appendingPathComponent("result.json").path, String(ProcessInfo.processInfo.processIdentifier), "restart"]
            process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
            try process.run()
            state["phase"] = "installing"; publish()
            NSApp.terminate(nil)
        } catch { fail(error) }
    }
}
