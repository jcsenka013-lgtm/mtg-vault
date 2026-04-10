import ExpoModulesCore
import Vision
import UIKit

public class ExpoVisionOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoVisionOcr")

    // recognizeText(fileUri: String) -> { lines: [String] }
    // Receives a local file:// URI from expo-image-manipulator, runs
    // VNRecognizeTextRequest on a background thread, and resolves with
    // an array of recognised text lines.
    AsyncFunction("recognizeText") { (fileUri: String, promise: Promise) in
      // expo-image-manipulator returns file:// URIs; strip the scheme prefix
      let path: String
      if fileUri.hasPrefix("file://") {
        path = String(fileUri.dropFirst("file://".count))
      } else {
        path = fileUri
      }

      guard let image = UIImage(contentsOfFile: path),
            let cgImage = image.cgImage else {
        promise.reject("E_IMAGE_LOAD", "Could not load image at: \(path)")
        return
      }

      let request = VNRecognizeTextRequest { request, error in
        if let error = error {
          promise.reject("E_OCR_FAILED", error.localizedDescription)
          return
        }
        let observations = request.results as? [VNRecognizedTextObservation] ?? []
        // topCandidates(1) returns the single highest-confidence candidate per line
        let lines = observations.compactMap { $0.topCandidates(1).first?.string }
        promise.resolve(["lines": lines])
      }

      // .accurate is slower but handles MTG card fonts well;
      // it still runs in ~30-60 ms on modern iPhones.
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["en-US"]
      // Disable language correction — card names are proper nouns and
      // autocorrection would corrupt them (e.g. "Snapcaster Mage" → "Snapcaster Mage" ✓
      // but "Tarmogoyf" would be mangled without this flag).
      request.usesLanguageCorrection = false
      // Ignore tiny text artefacts smaller than 2% of the image height
      request.minimumTextHeight = 0.02

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
          try handler.perform([request])
        } catch {
          promise.reject("E_OCR_FAILED", error.localizedDescription)
        }
      }
    }
  }
}
