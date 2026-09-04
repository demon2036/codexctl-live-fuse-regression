import ApplicationServices
import Foundation

func runInputWorkload(_ element: AXUIElement?, duration: TimeInterval) -> (Bool, Bool, Int) {
    guard let element, let original = attribute(element, kAXValueAttribute as CFString) as? String else {
        return (false, false, 0)
    }
    let deadline = CFAbsoluteTimeGetCurrent() + duration
    var operations = 0
    var verified = true
    while CFAbsoluteTimeGetCurrent() < deadline {
        let candidate = original + (operations.isMultiple(of: 2) ? "x" : "y")
        let wrote = AXUIElementSetAttributeValue(
            element, kAXValueAttribute as CFString, candidate as CFTypeRef
        ) == .success
        let restored = AXUIElementSetAttributeValue(
            element, kAXValueAttribute as CFString, original as CFTypeRef
        ) == .success
        verified = verified && wrote && restored
        operations += 1
        Thread.sleep(forTimeInterval: 0.025)
    }
    let restored = AXUIElementSetAttributeValue(
        element, kAXValueAttribute as CFString, original as CFTypeRef
    ) == .success && textAttribute(element, kAXValueAttribute as CFString) == original
    return (verified, restored, operations)
}

func runScrollWorkload(_ element: AXUIElement?, duration: TimeInterval) -> (Bool, Bool, Int) {
    guard let element, let bar = findRole(element, role: kAXScrollBarRole as String),
          let original = numberValue(bar) else { return (false, false, 0) }
    let deadline = CFAbsoluteTimeGetCurrent() + duration
    var operations = 0
    var verified = true
    while CFAbsoluteTimeGetCurrent() < deadline {
        let delta = operations.isMultiple(of: 2) ? 0.05 : 0.04
        let candidate = original < 0.95 ? original + delta : original - delta
        let wrote = AXUIElementSetAttributeValue(
            bar, kAXValueAttribute as CFString, NSNumber(value: candidate)
        ) == .success
        let restored = AXUIElementSetAttributeValue(
            bar, kAXValueAttribute as CFString, NSNumber(value: original)
        ) == .success
        verified = verified && wrote && restored
        operations += 1
        Thread.sleep(forTimeInterval: 0.025)
    }
    let restored = AXUIElementSetAttributeValue(
        bar, kAXValueAttribute as CFString, NSNumber(value: original)
    ) == .success && abs((numberValue(bar) ?? original + 1) - original) < 0.001
    return (verified, restored, operations)
}

func runGrowthWorkload(_ element: AXUIElement?, duration: TimeInterval) -> (Bool, Bool, Int) {
    guard let element, let original = attribute(element, kAXValueAttribute as CFString) as? String else {
        return (false, false, 0)
    }
    let deadline = CFAbsoluteTimeGetCurrent() + duration
    var operations = 0
    var verified = true
    while CFAbsoluteTimeGetCurrent() < deadline {
        let length = operations % 120 + 1
        let candidate = original + String(repeating: "x", count: length)
        let wrote = AXUIElementSetAttributeValue(
            element, kAXValueAttribute as CFString, candidate as CFTypeRef
        ) == .success
        verified = verified && wrote
        operations += 1
        Thread.sleep(forTimeInterval: 0.016)
    }
    let restored = AXUIElementSetAttributeValue(
        element, kAXValueAttribute as CFString, original as CFTypeRef
    ) == .success && textAttribute(element, kAXValueAttribute as CFString) == original
    return (verified, restored, operations)
}
