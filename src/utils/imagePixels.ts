import { decode as decodeJpeg } from "jpeg-js";
import { Platform } from "react-native";
import { cropTopFractionRgba, rgbaToGray, dHashFromGrayBuffer } from "./dHash";

export type PixelFrame = { rgba: Uint8Array; width: number; height: number };

/** Decode JPEG bytes → RGBA */
export function decodeJpegToRgba(bytes: Uint8Array): PixelFrame | null {
  try {
    const decoded = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true }) as {
      width: number;
      height: number;
      data: Uint8Array;
    };
    if (!decoded?.data?.length) return null;
    return { rgba: decoded.data, width: decoded.width, height: decoded.height };
  } catch {
    return null;
  }
}

/** dHash of top `titleFraction` of image (matches scanner title strip vs Scryfall crop). */
export function dHashTitleStripFromRgba(
  frame: PixelFrame,
  titleFraction = 0.22
): bigint | null {
  if (frame.width < 4 || frame.height < 4) return null;
  const cropped = cropTopFractionRgba(frame.rgba, frame.width, frame.height, titleFraction);
  const gray = rgbaToGray(cropped.data, cropped.width, cropped.height);
  return dHashFromGrayBuffer(gray, cropped.width, cropped.height);
}

export async function fetchUrlToUint8Array(uri: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(uri);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Web-only: draw image URL to canvas and read RGBA (requires CORS). */
export async function fetchImageDataViaCanvas(uri: string): Promise<PixelFrame | null> {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w < 4 || h < 4) {
          resolve(null);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        resolve({ rgba: new Uint8Array(imgData.data), width: w, height: h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = uri;
  });
}

export function dHashFromRgbaFrame(frame: PixelFrame): bigint | null {
  if (frame.width < 4 || frame.height < 4) return null;
  return dHashTitleStripFromRgba(frame, 1);
}

export function dHashFromJpegUint8(jpeg: Uint8Array): bigint | null {
  const frame = decodeJpegToRgba(jpeg);
  if (!frame) return null;
  return dHashFromRgbaFrame(frame);
}

function base64ToUint8(b64: string): Uint8Array {
  const g = globalThis as unknown as { Buffer?: { from(data: string, enc: string): Uint8Array } };
  if (g.Buffer) return g.Buffer.from(b64, "base64");
  if (typeof atob !== "function") throw new Error("base64 not supported");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function dHashFromJpegBase64DataUrl(dataUrl: string): bigint | null {
  const i = dataUrl.indexOf("base64,");
  if (i === -1) return null;
  try {
    const bytes = base64ToUint8(dataUrl.slice(i + 7));
    return dHashFromJpegUint8(bytes);
  } catch {
    return null;
  }
}

export async function dHashFromImageUri(uri: string): Promise<bigint | null> {
  if (Platform.OS === "web") {
    const frame = await fetchImageDataViaCanvas(uri);
    if (!frame) return null;
    return dHashTitleStripFromRgba(frame);
  }
  const bytes = await fetchUrlToUint8Array(uri);
  if (!bytes) return null;
  const frame = decodeJpegToRgba(bytes);
  if (!frame) return null;
  return dHashTitleStripFromRgba(frame);
}
