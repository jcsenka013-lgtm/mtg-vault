// Web stub — Metro resolves this file instead of index.ts on the web platform.
// recognizeText is always guarded with Platform.OS === 'ios' at the call site,
// so this export should never actually be invoked; it exists purely to satisfy
// the bundler so the import doesn't fail during a web build.

export interface VisionOcrResult {
  lines: string[];
}

export function recognizeText(_fileUri: string): Promise<VisionOcrResult> {
  return Promise.reject(
    new Error('ExpoVisionOcr is not available on web — use Tesseract.js instead.')
  );
}
