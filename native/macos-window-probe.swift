import Foundation
import ScreenCaptureKit

func windowInfoBounds(_ row: [String: Any]) -> [String: Double]? {
    guard let raw = row[kCGWindowBounds as String] as? [String: Any],
          let x = (raw["X"] as? NSNumber)?.doubleValue,
          let y = (raw["Y"] as? NSNumber)?.doubleValue,
          let width = (raw["Width"] as? NSNumber)?.doubleValue,
          let height = (raw["Height"] as? NSNumber)?.doubleValue,
          width > 1, height > 1 else { return nil }
    return ["x": x, "y": y, "width": width, "height": height]
}

func windowServerEvidence(_ pid: Int32) -> [String: Any] {
    let options: CGWindowListOption = [.optionAll, .excludeDesktopElements]
    let rows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
    let owned = rows.filter { row in
        (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
            && (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0
            && windowInfoBounds(row) != nil
    }
    let largest = owned.compactMap(windowInfoBounds).max { left, right in
        left["width", default: 0] * left["height", default: 0]
            < right["width", default: 0] * right["height", default: 0]
    }
    let onScreenCount = owned.filter {
        ($0[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue == true
    }.count
    return ["count": owned.count, "onScreenCount": onScreenCount, "bounds": largest as Any]
}

func captureAvailableWindow(_ pid: Int32) -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    let lock = NSLock()
    var captured = false
    Task {
        defer { semaphore.signal() }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                true, onScreenWindowsOnly: false
            )
            guard let target = content.windows.first(where: {
                $0.owningApplication?.processID == pid && $0.frame.width > 1 && $0.frame.height > 1
            }) else { return }
            let configuration = SCStreamConfiguration()
            configuration.width = max(2, Int(target.frame.width))
            configuration.height = max(2, Int(target.frame.height))
            let image = try await SCScreenshotManager.captureImage(
                contentFilter: SCContentFilter(desktopIndependentWindow: target),
                configuration: configuration
            )
            lock.withLock { captured = image.width > 1 && image.height > 1 }
        } catch {
            return
        }
    }
    _ = semaphore.wait(timeout: .now() + 5)
    return lock.withLock { captured }
}
