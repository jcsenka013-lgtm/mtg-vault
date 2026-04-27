/**
 * Optional Google Cloud Vision TEXT_DETECTION.
 * Set EXPO_PUBLIC_GOOGLE_CLOUD_VISION_API_KEY in env (restricted by referrer / bundle as appropriate).
 */

function base64ToBytes(b64: string): Uint8Array {
  const g = globalThis as unknown as { Buffer?: { from(data: string, enc: string): { buffer: ArrayBuffer } } };
  if (g.Buffer) {
    const decoded = g.Buffer.from(b64, "base64") as unknown as Uint8Array;
    return new Uint8Array(decoded);
  }
  if (typeof atob !== "function") throw new Error("No base64 decoder");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export type CloudOcrOutcome =
  | { ok: true; text: string; confidence01: number }
  | { ok: false; reason: "no_key" | "network" | "api" };

/**
 * Runs Vision API document text detection on a JPEG base64 payload (no data: prefix).
 */
export async function runGoogleVisionTextOnJpegBase64(jpegBase64: string): Promise<CloudOcrOutcome> {
  const key = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!key) return { ok: false, reason: "no_key" };

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`;
  const body = {
    requests: [
      {
        image: { content: jpegBase64 },
        features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, reason: "api" };
    const json = (await res.json()) as {
      responses?: Array<{
        fullTextAnnotation?: { text?: string };
        textAnnotations?: Array<{ description?: string; confidence?: number }>;
      }>;
    };
    const ann = json.responses?.[0];
    const text =
      ann?.fullTextAnnotation?.text?.trim() ??
      ann?.textAnnotations?.[0]?.description?.trim() ??
      "";
    const conf = ann?.textAnnotations?.[0]?.confidence;
    const confidence01 =
      typeof conf === "number" && conf > 0 && conf <= 1
        ? conf
        : typeof conf === "number" && conf > 1
          ? Math.min(1, conf / 100)
          : 0.92;
    if (!text) return { ok: false, reason: "api" };
    return { ok: true, text, confidence01 };
  } catch {
    return { ok: false, reason: "network" };
  }
}

export function jpegDataUrlToBase64Payload(dataUrl: string): string | null {
  const i = dataUrl.indexOf("base64,");
  if (i === -1) return null;
  return dataUrl.slice(i + 7);
}

export function uint8ToJpegBase64Payload(jpegBytes: Uint8Array): string {
  const g = globalThis as unknown as { Buffer?: { from(data: Uint8Array): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(jpegBytes).toString("base64");
  let binary = "";
  for (let i = 0; i < jpegBytes.length; i++) binary += String.fromCharCode(jpegBytes[i]);
  return typeof btoa !== "undefined" ? btoa(binary) : "";
}

export function tryDecodeDataUrlToJpegBytes(dataUrl: string): Uint8Array | null {
  const i = dataUrl.indexOf("base64,");
  if (i === -1) return null;
  try {
    return base64ToBytes(dataUrl.slice(i + 7));
  } catch {
    return null;
  }
}
