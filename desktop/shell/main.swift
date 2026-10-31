// Audio.app: the editor (the playground, desktop/server.js serving it from this repo) in a window it fills, its menus the
// Mac's menu bar, and the server itself, started and stopped with the app. All the app does natively is what a page
// cannot: windows and the menu bar, files opened from the Finder or the Dock, open and save panels, downloads, the
// microphone permission. Everything else is the repo's own code (desktop/app.js joins the page to the app), so a change
// there is in the app at its next reload (⌥⌘R).
//
// Built by desktop/build.sh. AUDIO_ROOT, AUDIO_PORT and AUDIO_NODE in the environment override the built-in root, port
// and node. Its log: ~/Library/Logs/Audio (app.log, server.log).
import Cocoa
import WebKit

let env = ProcessInfo.processInfo.environment
let info = Bundle.main.infoDictionary ?? [:]
let root = env["AUDIO_ROOT"] ?? info["AudioRoot"] as? String ?? ""
let port = Int(env["AUDIO_PORT"] ?? "") ?? Int(info["AudioPort"] as? String ?? "") ?? 7781
let base = URL(string: "http://127.0.0.1:\(port)")!
let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Audio")

// what the app did, to ~/Library/Logs/Audio/app.log: windows, pages loaded or failed, the server's comings and goings
func log(_ line: String) {
  let file = logs.appendingPathComponent("app.log"), text = "\(ISO8601DateFormatter().string(from: Date())) \(line)\n"
  try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
  if let h = try? FileHandle(forWritingTo: file) { h.seekToEndOfFile(); h.write(text.data(using: .utf8)!); try? h.close() }
  else { try? text.write(to: file, atomically: true, encoding: .utf8) }
}

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate, NSToolbarDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler, WKDownloadDelegate {
  var server: Process?
  var serverIn: Pipe?
  var ready = false
  var quitting = false
  var pending: [String] = []            // files asked for before the server was up
  var editor: NSWindow?
  var titles: [NSKeyValueObservation] = []
  var recording = false
  var editing = false                   // the editor's focus in a field: the Mac's Cut, Copy, Paste, Undo go to it
  var appMenu = NSMenuItem(), windowMenu = NSMenuItem()
  let config = WKWebViewConfiguration()

  func applicationDidFinishLaunching(_ note: Notification) {
    menu()
    config.websiteDataStore = .default()
    config.userContentController.add(self, name: "app")
    config.mediaTypesRequiringUserActionForPlayback = []
    // the editor joined to the app (desktop/app.js): its menus to the menu bar
    let join = "if (location.pathname === '/playground.html') { const add = () => document.documentElement.append(Object.assign(document.createElement('script'), { type: 'module', src: '/desktop/app.js' })); document.documentElement ? add() : document.addEventListener('readystatechange', add, { once: true }) }"
    config.userContentController.addUserScript(WKUserScript(source: join, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    start()
  }

  // ---- the server ----

  func node() -> String? {
    let fm = FileManager.default
    for p in [env["AUDIO_NODE"], info["AudioNode"] as? String, "/opt/homebrew/bin/node", "/usr/local/bin/node"].compactMap({ $0 }) where fm.isExecutableFile(atPath: p) { return p }
    // a node only the login shell knows (nvm, volta, fnm)
    let p = Process(), out = Pipe()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = ["-lc", "command -v node"]
    p.standardOutput = out
    try? p.run()
    p.waitUntilExit()
    let found = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return found.isEmpty ? nil : found
  }

  func start() {
    guard let node = node() else { return fatal("No node found", "Install Node.js (brew install node), or set AUDIO_NODE.") }
    let script = URL(fileURLWithPath: root).appendingPathComponent("desktop/server.js")
    guard FileManager.default.fileExists(atPath: script.path) else { return fatal("No \(script.path)", "The app runs the audio repo it was built from: build it again from there (desktop/build.sh).") }
    try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
    let serverLog = logs.appendingPathComponent("server.log")
    if !FileManager.default.fileExists(atPath: serverLog.path) { FileManager.default.createFile(atPath: serverLog.path, contents: nil) }
    let logFile = try? FileHandle(forWritingTo: serverLog)
    logFile?.seekToEndOfFile()

    let p = Process(), stdin = Pipe(), stdout = Pipe()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = [script.path, "--port", String(port)]
    p.currentDirectoryURL = URL(fileURLWithPath: root)
    p.standardInput = stdin            // held open: its end tells the server the app is gone, however it went
    p.standardOutput = stdout
    p.standardError = logFile ?? FileHandle.nullDevice
    stdout.fileHandleForReading.readabilityHandler = { [weak self] h in
      let data = h.availableData
      if data.isEmpty { h.readabilityHandler = nil; return }
      logFile?.write(data)
      if String(data: data, encoding: .utf8)?.contains("ready ") == true { DispatchQueue.main.async { self?.up() } }
    }
    p.terminationHandler = { [weak self] proc in
      DispatchQueue.main.async {
        guard let self, !self.quitting else { return }
        self.ready = false
        log("server stopped: \(proc.terminationStatus)")
        // Restart the local server and report its log.
        self.start()
        let alert = NSAlert()
        alert.messageText = "The audio process stopped (\(proc.terminationStatus)) and started again"
        alert.informativeText = "Its log: ~/Library/Logs/Audio/server.log"
        alert.runModal()
      }
    }
    do { try p.run() } catch { return fatal("Could not start \(node)", error.localizedDescription) }
    log("server: \(node) \(script.path) --port \(port)")
    server = p
    serverIn = stdin
  }

  func up() {
    if ready { return }
    ready = true
    log("server ready on \(base)")
    if editor == nil { openEditor(nil) } else { (editor?.contentView as? WKWebView)?.reload() }
    for path in pending { openEditor(path) }
    pending = []
  }

  func fatal(_ title: String, _ text: String) {
    let alert = NSAlert()
    alert.messageText = title
    alert.informativeText = text
    alert.runModal()
    NSApp.terminate(nil)
  }

  // ---- windows ----

  func window(_ name: String, _ url: URL, size: NSSize) -> NSWindow {
    let view = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: config)
    view.uiDelegate = self
    view.navigationDelegate = self
    view.isInspectable = true          // Safari › Develop › Audio, or right-click › Inspect Element
    view.allowsMagnification = false
    let w = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    w.contentView = view
    w.isReleasedWhenClosed = false
    w.delegate = self
    w.center()
    w.setFrameAutosaveName(name)
    w.tabbingMode = .disallowed
    titles.append(view.observe(\.title, options: [.new]) { v, _ in w.title = (v.title ?? "").replacingOccurrences(of: " · audio playground", with: "") })
    view.load(URLRequest(url: url))
    w.makeKeyAndOrderFront(nil)
    return w
  }

  // the editor; a file of this machine opened in it, in a tab of its own (desktop/open.html)
  func openEditor(_ path: String?) {
    guard ready else { if let path { pending.append(path) }; return }
    let url = path.map { p -> URL in
      var c = URLComponents(url: base.appendingPathComponent("desktop/open.html"), resolvingAgainstBaseURL: false)!
      c.queryItems = [URLQueryItem(name: "path", value: p)]
      return c.url!
    } ?? base.appendingPathComponent("playground.html")
    if let w = editor, let view = w.contentView as? WKWebView {
      if path != nil { view.load(URLRequest(url: url)) }
      w.makeKeyAndOrderFront(nil)
    } else {
      // a title bar as a code editor's: the sound's name, and on the right the panels, a button each (the page's own,
      // its top right); the page below it, its tabs first. Light or dark as the page is (app.js tells its colour)
      let w = window("Editor", url, size: NSSize(width: 1280, height: 800))
      let bar = NSToolbar(identifier: "editor")
      bar.delegate = self
      bar.displayMode = .iconOnly
      bar.allowsUserCustomization = false
      w.toolbar = bar
      w.toolbarStyle = .unified
      // the title bar the page's own colour (app.js tells it): one ground from the top of the window down
      w.titlebarAppearsTransparent = true
      w.titlebarSeparatorStyle = .none
      w.backgroundColor = NSColor(srgbRed: 0.09, green: 0.09, blue: 0.09, alpha: 1)
      w.appearance = NSAppearance(named: .darkAqua)
      editor = w
    }
  }

  @objc func showEditor(_ sender: Any?) { openEditor(nil) }

  @objc func openDocument(_ sender: Any?) {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.audio, .movie]
    panel.allowsMultipleSelection = true
    guard panel.runModal() == .OK else { return }
    for url in panel.urls { NSDocumentController.shared.noteNewRecentDocumentURL(url); openEditor(url.path) }
  }

  @objc func reloadPage(_ sender: Any?) { (NSApp.keyWindow?.contentView as? WKWebView)?.reload() }

  // Finder › Open With, a file dropped on the Dock icon, Open Recent
  func application(_ app: NSApplication, open urls: [URL]) {
    for url in urls where url.isFileURL { NSDocumentController.shared.noteNewRecentDocumentURL(url); openEditor(url.path) }
  }

  func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
    if !hasVisibleWindows { openEditor(nil) }
    return true
  }

  // ---- quitting ----

  func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
    if recording {
      let alert = NSAlert()
      alert.messageText = "Quit while recording?"
      alert.informativeText = "Quitting stops this recording."
      alert.addButton(withTitle: "Quit")
      alert.addButton(withTitle: "Cancel")
      if alert.runModal() != .alertFirstButtonReturn { return .terminateCancel }
    }
    quitting = true
    if let p = server, p.isRunning {
      p.terminate()
      let until = Date().addingTimeInterval(10)
      while p.isRunning && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.05)) }
    }
    return .terminateNow
  }

  func windowWillClose(_ note: Notification) {
    if note.object as? NSWindow === editor { editor = nil; recording = false }
  }

  // ---- what pages ask for ----

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any] else { return }
    if let path = body["open"] as? String { openEditor(path) }
    if let active = body["recording"] as? Bool { recording = active }
    if let e = body["editing"] as? Bool { editing = e }
    if let rgb = body["background"] as? [Double], rgb.count == 3, message.webView?.window === editor {
      // dark or light as the page: its colour's luma (Rec. 709)
      let dark = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] < 128
      editor?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
      editor?.backgroundColor = NSColor(srgbRed: rgb[0] / 255, green: rgb[1] / 255, blue: rgb[2] / 255, alpha: 1)
    }
    if let panels = body["toolbar"] as? [[String: Any]], let bar = editor?.toolbar {
      let on = panels.first { $0["selected"] as? Bool == true }?["label"] as? String
      bar.selectedItemIdentifier = on.map { NSToolbarItem.Identifier("panel." + $0) }
    }
    if let title = body["title"] as? String, message.webView?.window === editor { editor?.title = title }
    if let menus = body["menus"] as? [[String: Any]] { pageMenus(menus) }
    if let text = body["alert"] as? String, let w = message.webView?.window {
      let alert = NSAlert()
      alert.messageText = text
      alert.beginSheetModal(for: w)
    }
  }

  // <input type=file>
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.beginSheetModal(for: webView.window ?? NSApp.keyWindow!) { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.runModal()
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let alert = NSAlert(), field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
    alert.messageText = prompt
    field.stringValue = defaultText ?? ""
    alert.accessoryView = field
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    completionHandler(alert.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
  }

  // the page's own recording (getUserMedia), allowed as the app is
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(origin.host == "127.0.0.1" ? .grant : .prompt)
  }

  // window.open, target=_blank: the web in the browser; the app's own pages in a window of their own
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    guard let url = action.request.url else { return nil }
    if url.host == base.host && url.port == base.port {
      if url.path == "/desktop/open.html", let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "path" })?.value { openEditor(path) }
      else { _ = window(url.path, url, size: NSSize(width: 1100, height: 760)) }
    } else { NSWorkspace.shared.open(url) }
    return nil
  }

  // links off the app open in the browser; what a page downloads (an export) goes where the user says
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    if let url = action.request.url, action.navigationType == .linkActivated, url.host != base.host || url.port != base.port, url.scheme != "blob", url.scheme != "data" {
      NSWorkspace.shared.open(url)
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.canCreateDirectories = true
    completionHandler(panel.runModal() == .OK ? panel.url : nil)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { log("loaded \(webView.url?.absoluteString ?? "") (\(webView.title ?? ""))") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { log("failed \(webView.url?.absoluteString ?? ""): \(error.localizedDescription)") }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { log("failed \(webView.url?.absoluteString ?? ""): \(error.localizedDescription)") }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { log("page process ended: \(webView.url?.absoluteString ?? ""), reloading"); webView.reload() }

  // ---- the editor's toolbar: its panels, as the page's buttons at its top right, a symbol each ----

  let panelSymbols: [(String, String)] = [
    ("Recipes", "book"), ("Agent", "sparkles"), ("Edits", "square.3.layers.3d"),
    ("Code", "chevron.left.forwardslash.chevron.right"), ("Export", "square.and.arrow.down"), ("Settings", "slider.horizontal.3")
  ]
  var panelIds: [NSToolbarItem.Identifier] { panelSymbols.map { NSToolbarItem.Identifier("panel." + $0.0) } }

  func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.flexibleSpace] + panelIds }
  func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [.flexibleSpace] + panelIds }
  func toolbarSelectableItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { panelIds }

  func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
    guard let (label, symbol) = panelSymbols.first(where: { "panel." + $0.0 == id.rawValue }) else { return nil }
    let item = NSToolbarItem(itemIdentifier: id)
    item.label = label
    item.toolTip = label
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
    item.isBordered = true
    item.target = self
    item.action = #selector(panelItem(_:))
    return item
  }

  // a panel's button: the page's own pressed (it shows the panel, or hides the one shown)
  @objc func panelItem(_ sender: NSToolbarItem) {
    let label = sender.itemIdentifier.rawValue.replacingOccurrences(of: "panel.", with: "")
    (editor?.contentView as? WKWebView)?.evaluateJavaScript("audioHost.panel(\(String(reflecting: label)))")
  }

  // ---- menus: the app's own (Audio, Window), the editor's between them as it has them now ----

  func item(_ title: String, _ action: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
    i.keyEquivalentModifierMask = mods
    return i
  }

  func top(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
    let m = NSMenu(title: title)
    m.autoenablesItems = false
    items.forEach(m.addItem)
    m.delegate = self
    let t = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    t.submenu = m
    return t
  }

  func menu() {
    appMenu = top("Audio", [
      item("About Audio", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Hide Audio", #selector(NSApplication.hide(_:)), "h"),
      item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quit Audio", #selector(NSApplication.terminate(_:)), "q")
    ])
    appMenu.submenu?.autoenablesItems = true
    windowMenu = top("Window", [
      item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      item("Zoom", #selector(NSWindow.performZoom(_:))),
      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
      .separator(),
      item("Editor", #selector(showEditor(_:)), "1"),
      .separator(),
      item("Reload Page", #selector(reloadPage(_:)), "r", [.command, .option]),
      .separator(),
      item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))
    ])
    windowMenu.submenu?.autoenablesItems = true
    // until the editor tells its menus: the edits a field needs
    let edit = top("Edit", [
      item("Undo", Selector(("undo:")), "z"), item("Redo", Selector(("redo:")), "z", [.command, .shift]), .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"), item("Copy", #selector(NSText.copy(_:)), "c"), item("Paste", #selector(NSText.paste(_:)), "v"),
      item("Select All", #selector(NSText.selectAll(_:)), "a")
    ])
    edit.submenu?.autoenablesItems = true
    bar([edit])
  }

  func bar(_ middle: [NSMenuItem]) {
    let bar = NSMenu()
    for i in [appMenu] + middle + [windowMenu] { i.menu?.removeItem(i); bar.addItem(i) }
    NSApp.mainMenu = bar
    NSApp.windowsMenu = windowMenu.submenu
  }

  var tops: [String: NSMenuItem] = [:], names: [String] = []
  var open = 0                          // menus open now: the editor's are not rebuilt under the pointer

  // The editor's menus (desktop/app.js): [{ name, items: [{ id, label, keys, hint, tip, checked, disabled, items? } |
  // { separator } | { group }] }]. Each top menu kept, its items made again; the bar remade only when the names change.
  func pageMenus(_ menus: [[String: Any]]) {
    let now = menus.compactMap { $0["name"] as? String }
    if now != names {
      names = now
      log("menus from the editor: \(now.joined(separator: ", "))")
      tops = Dictionary(now.map { ($0, top($0, [])) }, uniquingKeysWith: { a, _ in a })
      bar(now.compactMap { tops[$0] })
    }
    for m in menus {
      guard let name = m["name"] as? String, let menu = tops[name]?.submenu, let list = m["items"] as? [[String: Any]] else { continue }
      if open > 0 && menu.highlightedItem != nil { continue }
      fill(menu, list)
    }
  }

  // the Mac's own edits, for the keys a field takes: in a field they act on its text (WebKit's), elsewhere the editor's own
  let standard: [String: String] = ["⌘X": "cut:", "⌘C": "copy:", "⌘V": "paste:", "⌘A": "selectAll:", "⌘Z": "undo:", "⇧⌘Z": "redo:"]

  func fill(_ menu: NSMenu, _ list: [[String: Any]]) {
    menu.removeAllItems()
    menu.autoenablesItems = false
    // where a key shown, not taken, sits: past the widest label
    let font = NSFont.menuFont(ofSize: 0)
    let widest = list.compactMap { $0["label"] as? String }.map { ($0 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
    for d in list {
      if d["separator"] != nil { menu.addItem(.separator()); continue }
      if let g = d["group"] as? String {
        if #available(macOS 14.0, *) { menu.addItem(.sectionHeader(title: g)) } else { let h = NSMenuItem(title: g, action: nil, keyEquivalent: ""); h.isEnabled = false; menu.addItem(h) }
        continue
      }
      let label = d["label"] as? String ?? "", keys = d["keys"] as? String ?? "", id = d["id"] as? String ?? ""
      let i = NSMenuItem(title: label, action: #selector(pageItem(_:)), keyEquivalent: "")
      i.target = self
      i.representedObject = id
      i.state = d["checked"] as? Bool == true ? .on : .off
      i.isEnabled = d["disabled"] as? Bool != true
      if let tip = d["tip"] as? String, !tip.isEmpty { i.toolTip = tip }
      if #available(macOS 14.4, *), let hint = d["hint"] as? String, !hint.isEmpty { i.subtitle = hint }
      if let sub = d["items"] as? [[String: Any]] {
        let m = NSMenu(title: label)
        m.delegate = self
        fill(m, sub)
        i.submenu = m
        i.action = nil
      } else if let (key, mods) = equivalent(keys) {
        i.keyEquivalent = key
        i.keyEquivalentModifierMask = mods
        if let sel = standard[keys] { i.action = #selector(editItem(_:)); i.representedObject = [id, sel]; if editing { i.isEnabled = true } }
      } else if !keys.isEmpty {
        // a key the page takes itself (R, Space, ⌥→): shown on the right, dimmed, not one the menu takes
        let style = NSMutableParagraphStyle()
        style.tabStops = [NSTextTab(textAlignment: .right, location: widest + 90)]
        let t = NSMutableAttributedString(string: "\(label)\t", attributes: [.font: font, .paragraphStyle: style])
        t.append(NSAttributedString(string: keys, attributes: [.font: font, .paragraphStyle: style, .foregroundColor: NSColor.secondaryLabelColor]))
        i.attributedTitle = t
      }
      menu.addItem(i)
    }
  }

  // ⌘ or ⌃ with a letter or digit, as a menu takes it; anything else the page's own
  func equivalent(_ keys: String) -> (String, NSEvent.ModifierFlags)? {
    var mods: NSEvent.ModifierFlags = [], rest = ""
    for c in keys {
      switch c {
      case "⌘": mods.insert(.command)
      case "⇧": mods.insert(.shift)
      case "⌥": mods.insert(.option)
      case "⌃": mods.insert(.control)
      default: rest.append(c)
      }
    }
    guard !mods.isDisjoint(with: [.command, .control]), rest.count == 1, let ch = rest.first, ch.isLetter || ch.isNumber else { return nil }
    return (rest.lowercased(), mods)
  }

  @objc func pageItem(_ sender: NSMenuItem) {
    guard let id = sender.representedObject as? String, let view = editor?.contentView as? WKWebView else { return }
    view.evaluateJavaScript("audioHost.run(\(String(reflecting: id)))")
  }

  @objc func editItem(_ sender: NSMenuItem) {
    guard let pair = sender.representedObject as? [String], pair.count == 2 else { return }
    // a field: its own edit; ⌘V always the system's paste, the page's paste reading it; else the editor's
    if editing || pair[1] == "paste:" { NSApp.sendAction(Selector(pair[1]), to: nil, from: sender) }
    else if let view = editor?.contentView as? WKWebView { view.evaluateJavaScript("audioHost.run(\(String(reflecting: pair[0])))") }
  }

  // a menu opening: the editor tells it as it is now
  func menuWillOpen(_ menu: NSMenu) {
    open += 1
    if menu.supermenu === NSApp.mainMenu, let view = editor?.contentView as? WKWebView { view.evaluateJavaScript("audioHost?.push()") }
  }
  func menuDidClose(_ menu: NSMenu) { open = max(0, open - 1) }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
