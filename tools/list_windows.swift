import CoreGraphics
import Foundation

let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []

for info in windowInfo {
    let owner = info[kCGWindowOwnerName as String] as? String ?? ""
    let name = info[kCGWindowName as String] as? String ?? ""
    let id = info[kCGWindowNumber as String] as? UInt32 ?? 0
    guard !owner.isEmpty else { continue }
    if owner.localizedCaseInsensitiveContains("kakao") ||
        owner.localizedCaseInsensitiveContains("카카오") ||
        name.localizedCaseInsensitiveContains("kakao") ||
        name.localizedCaseInsensitiveContains("카카오") {
        print("\(id)\t\(owner)\t\(name)")
    }
}
