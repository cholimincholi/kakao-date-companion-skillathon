import AppKit
import CoreGraphics
import Foundation
import Vision

struct OCRResult: Codable {
    let ok: Bool
    let owner: String
    let windowName: String
    let windowID: UInt32
    let text: String
    let lineCount: Int
    let error: String?
}

func jsonPrint(_ result: OCRResult) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(result), let string = String(data: data, encoding: .utf8) {
        print(string)
    }
}

let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []

let candidates = windowInfo.compactMap { info -> (id: UInt32, name: String, owner: String, area: CGFloat)? in
    guard let owner = info[kCGWindowOwnerName as String] as? String,
          let id = info[kCGWindowNumber as String] as? UInt32,
          let bounds = info[kCGWindowBounds as String] as? [String: Any],
          let width = bounds["Width"] as? CGFloat,
          let height = bounds["Height"] as? CGFloat else {
        return nil
    }
    let name = info[kCGWindowName as String] as? String ?? "KakaoTalk"
    let matchesKakao = owner.localizedCaseInsensitiveContains("kakao") ||
        owner.localizedCaseInsensitiveContains("카카오") ||
        name.localizedCaseInsensitiveContains("kakao") ||
        name.localizedCaseInsensitiveContains("카카오")
    guard matchesKakao else { return nil }
    return (id, name, owner, width * height)
}.sorted { $0.area > $1.area }

guard let target = candidates.first else {
    jsonPrint(OCRResult(ok: false, owner: "KakaoTalk", windowName: "", windowID: 0, text: "", lineCount: 0, error: "kakaotalk_window_not_found"))
    exit(2)
}

let captureURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("kakao-date-companion-\(target.id).png")
let captureProcess = Process()
captureProcess.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
captureProcess.arguments = ["-x", "-l", String(target.id), captureURL.path]

do {
    try captureProcess.run()
    captureProcess.waitUntilExit()
} catch {
    jsonPrint(OCRResult(ok: false, owner: target.owner, windowName: target.name, windowID: target.id, text: "", lineCount: 0, error: "screencapture_failed: \(error.localizedDescription)"))
    exit(3)
}

guard captureProcess.terminationStatus == 0,
      let nsImage = NSImage(contentsOf: captureURL),
      let image = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    jsonPrint(OCRResult(ok: false, owner: target.owner, windowName: target.name, windowID: target.id, text: "", lineCount: 0, error: "window_capture_failed_or_empty"))
    exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["ko-KR", "en-US"]

let handler = VNImageRequestHandler(cgImage: image, options: [:])

do {
    try handler.perform([request])
    let lines = (request.results ?? [])
        .compactMap { $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    let text = lines.joined(separator: "\n")
    jsonPrint(OCRResult(ok: true, owner: target.owner, windowName: target.name, windowID: target.id, text: text, lineCount: lines.count, error: nil))
} catch {
    jsonPrint(OCRResult(ok: false, owner: target.owner, windowName: target.name, windowID: target.id, text: "", lineCount: 0, error: error.localizedDescription))
    exit(4)
}
