import AppKit
import ApplicationServices
import Foundation

let identifierAttribute = "AXIdentifier" as CFString

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
}

func textAttribute(_ element: AXUIElement, _ name: CFString) -> String? {
    return attribute(element, name) as? String
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    return attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

func find(_ root: AXUIElement, identifier: String, limit: Int = 600) -> AXUIElement? {
    var queue = [root]
    var visited = 0
    while !queue.isEmpty && visited < limit {
        let next = queue.removeFirst()
        visited += 1
        if textAttribute(next, identifierAttribute) == identifier { return next }
        queue.append(contentsOf: children(next))
    }
    return nil
}

func findRole(_ root: AXUIElement, role: String, limit: Int = 200) -> AXUIElement? {
    var queue = [root]
    var visited = 0
    while !queue.isEmpty && visited < limit {
        let next = queue.removeFirst()
        visited += 1
        if textAttribute(next, kAXRoleAttribute as CFString) == role { return next }
        queue.append(contentsOf: children(next))
    }
    return nil
}

func descendants(_ root: AXUIElement, limit: Int = 1600) -> [AXUIElement] {
    var queue = [root]
    var result = [AXUIElement]()
    while !queue.isEmpty && result.count < limit {
        let next = queue.removeFirst()
        result.append(next)
        queue.append(contentsOf: children(next))
    }
    return result
}

func bounds(_ element: AXUIElement?) -> [String: Double]? {
    guard let element,
          let positionRef = attribute(element, kAXPositionAttribute as CFString),
          let sizeRef = attribute(element, kAXSizeAttribute as CFString) else { return nil }
    let positionValue = positionRef as! AXValue
    let sizeValue = sizeRef as! AXValue
    var point = CGPoint.zero
    var size = CGSize.zero
    guard AXValueGetValue(positionValue, .cgPoint, &point),
          AXValueGetValue(sizeValue, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
    return ["x": point.x, "y": point.y, "width": size.width, "height": size.height]
}

func percentile95(_ values: [Double]) -> Double {
    guard !values.isEmpty else { return 0 }
    let sorted = values.sorted()
    let index = max(0, Int(ceil(Double(sorted.count) * 0.95)) - 1)
    return sorted[index]
}

func verifyInput(_ element: AXUIElement?, repeats: Int = 20) -> (Bool, Bool, [Double]) {
    guard let element, let original = attribute(element, kAXValueAttribute as CFString) as? String else {
        return (false, false, [])
    }
    var samples = [Double]()
    var wroteEverySample = true
    var restoredEverySample = true
    for index in 0..<repeats {
        let candidate = original + (index.isMultiple(of: 2) ? "x" : "y")
        let started = CFAbsoluteTimeGetCurrent()
        let wrote = AXUIElementSetAttributeValue(
            element, kAXValueAttribute as CFString, candidate as CFTypeRef
        ) == .success && textAttribute(element, kAXValueAttribute as CFString) == candidate
        let restored = AXUIElementSetAttributeValue(
            element, kAXValueAttribute as CFString, original as CFTypeRef
        ) == .success && textAttribute(element, kAXValueAttribute as CFString) == original
        samples.append((CFAbsoluteTimeGetCurrent() - started) * 1000)
        wroteEverySample = wroteEverySample && wrote
        restoredEverySample = restoredEverySample && restored
    }
    return (wroteEverySample, restoredEverySample, samples)
}

func numberValue(_ element: AXUIElement) -> Double? {
    return (attribute(element, kAXValueAttribute as CFString) as? NSNumber)?.doubleValue
}

func verifyScroll(_ element: AXUIElement?, repeats: Int = 20) -> (Bool, Bool, [Double]) {
    guard let element,
          let bar = findRole(element, role: kAXScrollBarRole as String),
          let original = numberValue(bar) else { return (false, false, []) }
    var samples = [Double]()
    var wroteEverySample = true
    var restoredEverySample = true
    for index in 0..<repeats {
        let delta = index.isMultiple(of: 2) ? 0.05 : 0.04
        let candidate = original < 0.95 ? original + delta : original - delta
        let started = CFAbsoluteTimeGetCurrent()
        let wrote = AXUIElementSetAttributeValue(
            bar, kAXValueAttribute as CFString, NSNumber(value: candidate)
        ) == .success && abs((numberValue(bar) ?? original) - candidate) < 0.001
        let restored = AXUIElementSetAttributeValue(
            bar, kAXValueAttribute as CFString, NSNumber(value: original)
        ) == .success && abs((numberValue(bar) ?? candidate) - original) < 0.001
        samples.append((CFAbsoluteTimeGetCurrent() - started) * 1000)
        wroteEverySample = wroteEverySample && wrote
        restoredEverySample = restoredEverySample && restored
    }
    return (wroteEverySample, restoredEverySample, samples)
}

func writable(_ element: AXUIElement, _ name: CFString) -> Bool {
    var result = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, name, &result) == .success && result.boolValue
}

func findComposer(_ root: AXUIElement) -> AXUIElement? {
    if let exact = find(root, identifier: "codexctl-probe-composer") { return exact }
    let roles = Set([kAXTextAreaRole as String, kAXTextFieldRole as String])
    return descendants(root).filter { element in
        guard let role = textAttribute(element, kAXRoleAttribute as CFString), roles.contains(role),
              let rect = bounds(element) else { return false }
        return writable(element, kAXValueAttribute as CFString)
            && rect["width", default: 0] >= 180 && rect["height", default: 0] <= 320
    }.max { left, right in
        bounds(left)?["y", default: 0] ?? 0 < bounds(right)?["y", default: 0] ?? 0
    }
}

func findSessions(_ root: AXUIElement, windowBounds: [String: Double]?) -> AXUIElement? {
    if let exact = find(root, identifier: "codexctl-probe-sessions") { return exact }
    let maximumWidth = (windowBounds?["width"] ?? 1200) * 0.55
    let minimumHeight = (windowBounds?["height"] ?? 600) * 0.35
    return descendants(root).filter { element in
        guard textAttribute(element, kAXRoleAttribute as CFString) == kAXScrollAreaRole as String,
              let rect = bounds(element) else { return false }
        return rect["width", default: 0] >= 100 && rect["width", default: 0] <= maximumWidth
            && rect["height", default: 0] >= minimumHeight
            && findRole(element, role: kAXScrollBarRole as String) != nil
    }.min { left, right in
        bounds(left)?["x", default: .greatestFiniteMagnitude] ?? .greatestFiniteMagnitude
            < bounds(right)?["x", default: .greatestFiniteMagnitude] ?? .greatestFiniteMagnitude
    }
}

func argument(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name), index + 1 < CommandLine.arguments.count else {
        return nil
    }
    return CommandLine.arguments[index + 1]
}

func firstWindow(_ app: AXUIElement, timeout: TimeInterval = 10) -> AXUIElement? {
    let deadline = Date().addingTimeInterval(timeout)
    repeat {
        if let window = (attribute(app, kAXWindowsAttribute as CFString) as? [AXUIElement])?.first {
            return window
        }
        Thread.sleep(forTimeInterval: 0.05)
    } while Date() < deadline
    return nil
}

func emit(_ value: [String: Any], exitCode: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    exit(exitCode)
}

@main
struct MacAppProbe {
    static func main() {
        guard let rawPid = argument("--pid"), let pid = Int32(rawPid), pid > 1 else {
            emit(["error": "invalid-pid"], exitCode: 2)
        }
        guard let runningApplication = NSRunningApplication(processIdentifier: pid) else {
            emit(["error": "process-not-found"], exitCode: 3)
        }
        let activeBefore = runningApplication.isActive
        let hiddenBefore = runningApplication.isHidden
        if hiddenBefore { _ = runningApplication.unhide() }
        let activationReturned = activeBefore || runningApplication.activate(
            options: [.activateAllWindows, .activateIgnoringOtherApps]
        )
        let activationDeadline = Date().addingTimeInterval(2)
        while Date() < activationDeadline
                && (!runningApplication.isActive || runningApplication.isHidden) {
            RunLoop.current.run(until: Date().addingTimeInterval(0.02))
        }
        let hiddenAfter = runningApplication.isHidden
        let activationSucceeded = activationReturned
            && runningApplication.isActive && !hiddenAfter
        let accessibility = AXIsProcessTrusted()
        let screenRecording = CGPreflightScreenCaptureAccess()
        let windowServer = windowServerEvidence(pid)
        let app = AXUIElementCreateApplication(pid)
        let window = accessibility ? firstWindow(app) : nil
        let windowBounds = bounds(window)
        let composer = accessibility ? findComposer(app) : nil
        let sessions = accessibility ? findSessions(app, windowBounds: windowBounds) : nil
        if let workload = argument("--workload") {
            runWorkload(workload, pid: pid, window: window, composer: composer, sessions: sessions)
        }
        let input = accessibility ? verifyInput(composer) : (false, false, [Double]())
        let scroll = accessibility ? verifyScroll(sessions) : (false, false, [Double]())
        let screenshotCaptured = screenRecording && captureAvailableWindow(pid)
        emit([
            "schema": "codexctl-macos-native-probe/1", "pid": Int(pid),
            "activation": [
                "activeBefore": activeBefore,
                "hiddenBefore": hiddenBefore,
                "hiddenAfter": hiddenAfter,
                "requested": true,
                "succeeded": activationSucceeded,
                "unhideRequested": hiddenBefore,
            ],
            "windowServer": windowServer,
            "permissions": ["accessibility": accessibility, "screenRecording": screenRecording],
            "window": ["bounds": windowBounds as Any],
            "composer": [
                "found": composer != nil, "bounds": bounds(composer) as Any,
                "inputVerified": input.0, "inputRestored": input.1,
                "latenciesMs": input.2, "p95Ms": percentile95(input.2),
            ],
            "sessions": [
                "found": sessions != nil, "bounds": bounds(sessions) as Any,
                "scrollVerified": scroll.0, "scrollRestored": scroll.1,
                "latenciesMs": scroll.2, "p95Ms": percentile95(scroll.2),
            ],
            "screenshot": ["captured": screenshotCaptured],
        ])
    }

    static func runWorkload(_ phase: String, pid: Int32, window: AXUIElement?,
                            composer: AXUIElement?, sessions: AXUIElement?) -> Never {
        let durationMs = Double(argument("--duration-ms") ?? "") ?? 0
        guard AXIsProcessTrusted(), window != nil, durationMs >= 100, durationMs <= 60000 else {
            emit(workloadResult(phase: phase, pid: pid))
        }
        let started = CFAbsoluteTimeGetCurrent()
        let duration = durationMs / 1000
        let value: (Bool, Bool, Int)
        switch phase {
        case "idle":
            Thread.sleep(forTimeInterval: duration)
            value = (true, true, 1)
        case "input": value = runInputWorkload(composer, duration: duration)
        case "scroll": value = runScrollWorkload(sessions, duration: duration)
        case "stream": value = runGrowthWorkload(composer, duration: duration)
        default: emit(workloadResult(phase: phase, pid: pid), exitCode: 2)
        }
        emit(workloadResult(
            phase: phase, pid: pid, value: value,
            durationMs: (CFAbsoluteTimeGetCurrent() - started) * 1000
        ))
    }

    static func workloadResult(phase: String, pid: Int32,
                               value: (Bool, Bool, Int) = (false, false, 0),
                               durationMs: Double = 0) -> [String: Any] {
        return [
            "schema": "codexctl-macos-native-workload/1", "pid": Int(pid), "phase": phase,
            "verified": value.0, "restored": value.1, "operations": value.2,
            "durationMs": durationMs,
        ]
    }
}
