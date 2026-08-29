import AppKit
import Foundation

final class FixtureDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var stopSource: DispatchSourceSignal?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSRect(x: 80, y: 80, width: 1000, height: 700)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "codexctl Native Probe Fixture"

        let root = NSView(frame: NSRect(origin: .zero, size: frame.size))
        let sessions = NSScrollView(frame: NSRect(x: 0, y: 0, width: 230, height: 700))
        sessions.hasVerticalScroller = true
        sessions.setAccessibilityIdentifier("codexctl-probe-sessions")
        let list = NSTextView(frame: NSRect(x: 0, y: 0, width: 210, height: 1800))
        list.isEditable = false
        list.string = (1...80).map { "Session \($0)" }.joined(separator: "\n")
        sessions.documentView = list

        let main = NSView(frame: NSRect(x: 230, y: 0, width: 770, height: 700))
        let composer = NSTextView(frame: NSRect(x: 50, y: 40, width: 670, height: 96))
        composer.string = "fixture"
        composer.setAccessibilityIdentifier("codexctl-probe-composer")
        main.addSubview(composer)
        root.addSubview(sessions)
        root.addSubview(main)
        window.contentView = root
        window.orderFrontRegardless()
        self.window = window

        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler { NSApplication.shared.terminate(nil) }
        source.resume()
        stopSource = source

        let ready = "{\"schema\":\"codexctl-macos-native-fixture/1\",\"pid\":\(ProcessInfo.processInfo.processIdentifier)}\n"
        FileHandle.standardOutput.write(Data(ready.utf8))
    }
}

let app = NSApplication.shared
let delegate = FixtureDelegate()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
