import { useState, useRef, useEffect, useCallback } from "react";
import { useDebounce } from "@hooks/useDebounce";
import {
  View, Text, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, TextInput, Modal, Platform
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Tesseract from "tesseract.js";
import {
  autocompleteCardName,
  searchCardByNameInSet,
  normalizeScryfallCard,
  fetchMtgSets,
  fetchCardsBySet,
} from "@api/scryfall";
import type { ScryfallCard } from "@mtgtypes/index";
import type { ScryfallSet } from "@api/scryfall";
import { useAppStore } from "@store/appStore";
import { bulkAddCards } from "@db/queries";

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCENT  = "#c89b3c";
const GREEN   = "#22c55e";
const YELLOW  = "#f59e0b";
const GRID_PRESETS = [
  { label: "2×2", rows: 2, cols: 2 },
  { label: "3×3", rows: 3, cols: 3 },
  { label: "4×3", rows: 4, cols: 3 },
  { label: "4×4", rows: 4, cols: 4 },
];

// ─── Scryfall throttle: 150 ms minimum between requests ──────────────────────
let _lastApiMs = 0;
async function throttledApi<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 150 - (Date.now() - _lastApiMs));
  if (wait > 0) await new Promise<void>(r => setTimeout(r, wait));
  _lastApiMs = Date.now();
  return fn();
}

// ─── OCR semaphore: max 2 concurrent ─────────────────────────────────────────
class Semaphore {
  private n: number;
  private q: Array<() => void> = [];
  constructor(n: number) { this.n = n; }
  acquire(): Promise<void> {
    if (this.n > 0) { this.n--; return Promise.resolve(); }
    return new Promise<void>(r => this.q.push(r));
  }
  release(): void {
    if (this.q.length > 0) this.q.shift()!();
    else this.n++;
  }
}
const ocrSem = new Semaphore(2);

// ─── Types ────────────────────────────────────────────────────────────────────
type BBox = { x: number; y: number; w: number; h: number }; // normalized 0–1
type CropItem = { prescaled: HTMLCanvasElement };
type ConfirmedCrop = { prescaled: HTMLCanvasElement; bbox: BBox };
type DragMode = "draw" | "move" | "tl" | "tr" | "bl" | "br";
type DragState = { mode: DragMode; startNX: number; startNY: number; origBox: BBox };

type ScanResult = {
  index: number;
  thumbDataUrl: string;
  ocrDataUrl: string;
  rawOcr: string;
  extractedName: string;
  status: "identified" | "review" | "empty";
  card: ScryfallCard | null;
  candidates: ScryfallCard[];
  reviewName: string;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const aL = a.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const bL = b.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const dist = levenshtein(aL, bL);
  const maxLen = Math.max(aL.length, bL.length);
  const levScore = maxLen === 0 ? 1 : 1 - dist / maxLen;
  const aWords = aL.split(" ").filter(Boolean);
  const bWords = bL.split(" ").filter(Boolean);
  const prefixCount = aWords.filter((w, i) => bWords[i]?.startsWith(w)).length;
  const prefixScore = aWords.length > 0 ? prefixCount / Math.max(aWords.length, bWords.length) : 0;
  return Math.max(levScore, prefixScore);
}

/** Draw original photo with crop bbox + grid lines overlaid, returns a data URL */
function drawPhotoWithGrid(src: HTMLCanvasElement, bbox: BBox, rows: number, cols: number): string {
  const maxW = 1200;
  const scale = Math.min(1, maxW / src.width);
  const W = Math.round(src.width * scale);
  const H = Math.round(src.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0, W, H);

  const bx = bbox.x * W, by = bbox.y * H;
  const bw = bbox.w * W, bh = bbox.h * H;

  // Dim area outside the binder crop zone
  ctx.fillStyle = "rgba(0,0,0,0.48)";
  ctx.fillRect(0, 0, W, by);
  ctx.fillRect(0, by + bh, W, H - by - bh);
  ctx.fillRect(0, by, bx, bh);
  ctx.fillRect(bx + bw, by, W - bx - bw, bh);

  // Crop boundary
  ctx.strokeStyle = "#c89b3c";
  ctx.lineWidth = 3;
  ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);

  // Dashed grid lines
  const cellW = bw / cols, cellH = bh / rows;
  ctx.strokeStyle = "rgba(200,155,60,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  for (let c2 = 1; c2 < cols; c2++) {
    const x = bx + cellW * c2;
    ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, by + bh); ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    const y = by + cellH * r;
    ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Cell index labels
  const fontSize = Math.max(14, Math.min(cellW, cellH) * 0.15);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      const cx = bx + c2 * cellW + cellW / 2;
      const cy = by + r * cellH + cellH / 2;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(String(r * cols + c2 + 1), cx + 1, cy + 1);
      ctx.fillStyle = "#c89b3c";
      ctx.fillText(String(r * cols + c2 + 1), cx, cy);
    }
  }

  return canvas.toDataURL("image/jpeg", 0.75);
}

const COLLECTOR_PATTERN = /(?:#|^\s*)?(\d{1,4}[A-Za-z]?)(?:\s|$)/;
const SET_CODE_PATTERN = /\b([A-Z0-9]{3,4})\b/i;

function extractCardInfo(text: string): { name: string; collectorNumber?: string } | null {
  const collapsed = text.replace(/\n+/g, " ");
  const cleanedText = collapsed.replace(/[^a-zA-Z\s'\-]/g, " ").replace(/\s\s+/g, " ").trim();
  const lines = cleanedText.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);
  
  if (lines.length === 0) return null;

  let collectorNumber: string | undefined;
  for (const line of lines) {
    const match = line.match(COLLECTOR_PATTERN);
    if (match) { collectorNumber = match[1]; break; }
  }

  const nameLine = lines.find(line => 
    !COLLECTOR_PATTERN.test(line) && 
    /[a-zA-Z]{3,}/.test(line) &&
    !SET_CODE_PATTERN.test(line)
  );

  const finalName = nameLine || lines[0];
  return { 
    name: finalName ? finalName.replace(/[^a-zA-Z\s'-]/g, "").trim() : "", 
    collectorNumber 
  };
}

/** Downscale a photo or video to maxW pixels wide (preserving aspect ratio). */
function prescaleImage(img: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, maxW = 2000): HTMLCanvasElement {
  // Determine intrinsic dimensions based on element type
  const width = 'videoWidth' in img ? img.videoWidth : ('naturalWidth' in img ? img.naturalWidth : img.width);
  const height = 'videoHeight' in img ? img.videoHeight : ('naturalHeight' in img ? img.naturalHeight : img.height);

  const scale = Math.min(1, maxW / width);
  const c = document.createElement("canvas");
  c.width  = Math.round(width  * scale);
  c.height = Math.round(height * scale);
  
  const ctx = c.getContext("2d")!;
  // Draw an opaque background just in case
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function BinderScreen() {
  const { activeSession } = useAppStore();

  // Set picker
  const [setList,       setSetList]       = useState<ScryfallSet[]>([]);
  const [selectedSet,   setSelectedSet]   = useState<{ code: string; name: string } | null>(null);
  const [setFilter,     setSetFilter]     = useState("");
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [setsLoading,   setSetsLoading]   = useState(false);
  const [setCards,      setSetCards]      = useState<ScryfallCard[]>([]);

  // Grid
  const [gridPreset, setGridPreset] = useState(GRID_PRESETS[1]);

  // Crop flow
  const [cropQueue,    setCropQueue]    = useState<CropItem[]>([]);
  const [cropQueueIdx, setCropQueueIdx] = useState(0);
  const [cropBox,      setCropBox]      = useState<BBox>({ x: 0.05, y: 0.05, w: 0.90, h: 0.90 });
  const cropBoxRef        = useRef<BBox>({ x: 0.05, y: 0.05, w: 0.90, h: 0.90 });
  const confirmedCropsRef = useRef<ConfirmedCrop[]>([]);
  const dragRef           = useRef<DragState | null>(null);
  const cropCanvasRef     = useRef<HTMLCanvasElement | null>(null);

  // Processing
  const [processing, setProcessing] = useState(false);
  const [progress,   setProgress]   = useState({ current: 0, total: 0 });
  const [results,    setResults]     = useState<ScanResult[]>([]);

  // Review modal
  const [reviewIdx,        setReviewIdx]        = useState<number | null>(null);
  const [reviewSearch,     setReviewSearch]      = useState("");
  const [reviewCandidates, setReviewCandidates]  = useState<ScryfallCard[]>([]);
  const [reviewSearching,  setReviewSearching]   = useState(false);
  const [committing,       setCommitting]        = useState(false);

  // Binder view
  const [originalPhotos,    setOriginalPhotos]   = useState<string[]>([]);
  const [totalCells,        setTotalCells]       = useState(0);
  const [showOriginalPhoto, setShowOriginalPhoto] = useState(false);

  // Camera integration
  const [cameraOpen, setCameraOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [webPermissionGranted, setWebPermissionGranted] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const videoRef = useRef<any>(null);

  const workerRef      = useRef<any>(null);
  const fileInputRef   = useRef<HTMLInputElement | null>(null);
  const abortSearchRef = useRef<AbortController | null>(null);

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setSetsLoading(true);
    fetchMtgSets().then(setSetList).catch(console.error).finally(() => setSetsLoading(false));
  }, []);

  useEffect(() => {
    if (selectedSet) fetchCardsBySet(selectedSet.code).then(setSetCards).catch(console.error);
  }, [selectedSet]);

  useEffect(() => {
    let active = true;
    Tesseract.createWorker("eng").then(async w => {
      await w.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,",
      });
      if (active) workerRef.current = w;
    });
    return () => { active = false; workerRef.current?.terminate(); };
  }, []);

  // ── Web Camera lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    let activeStream: MediaStream | null = null;
    if (Platform.OS === "web" && webPermissionGranted && cameraOpen) {
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }
      }).then(stream => {
        activeStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        } else {
          stream.getTracks().forEach(t => t.stop());
        }
      }).catch(err => {
        console.error("Webcam error:", err);
        setWebPermissionGranted(false);
      });
    }
    return () => {
      if (activeStream) activeStream.getTracks().forEach(t => t.stop());
      if (Platform.OS === "web" && videoRef.current && videoRef.current.srcObject) {
         videoRef.current.srcObject.getTracks().forEach((t: any) => t.stop());
         videoRef.current.srcObject = null;
      }
    };
  }, [webPermissionGranted, cameraOpen]);

  // ── Debounced autocomplete: fire search 500 ms after the user stops typing ───
  const debouncedReviewSearch = useDebounce(reviewSearch, 300);
  useEffect(() => {
    if (!debouncedReviewSearch.trim() || reviewIdx === null) return;
    handleReviewSearch(debouncedReviewSearch);
  }, [debouncedReviewSearch, reviewIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Capture Photo ────────────────────────────────────────────────────────────
  const handleCapturePhoto = async () => {
    try {
      if (Platform.OS === "web") {
        const video = videoRef.current;
        if (!video || !video.videoWidth || video.readyState < 3) {
           alert("Camera is warming up. Please wait a second and try again.");
           return;
        }
        // Directly pass the video element to prescaleImage which draws the current frame
        setCropQueue(prev => [...prev, { prescaled: prescaleImage(video, 2000) }]);
      } else {
        if (cameraRef.current) {
          const photo = await cameraRef.current.takePictureAsync({ base64: true });
          if (photo?.base64) {
            const dataUrl = `data:image/jpeg;base64,${photo.base64}`;
            const img = await new Promise<HTMLImageElement>(res => {
              const el = new (window as any).Image() as HTMLImageElement;
              el.onload = () => res(el);
              el.src = dataUrl;
            });
            setCropQueue(prev => [...prev, { prescaled: prescaleImage(img, 2000) }]);
          }
        }
      }
    } catch (e) {
      console.error("Capture failed", e);
      alert("Failed to capture image.");
    }
  };

  // ── Crop canvas: sync box ref + expose setter ────────────────────────────────
  const updateCropBox = useCallback((box: BBox) => {
    cropBoxRef.current = box;
    setCropBox(box);
  }, []);

  // ── Crop canvas: draw whenever box or active item changes ────────────────────
  useEffect(() => {
    const canvas = cropCanvasRef.current;
    if (!canvas || cropQueue.length === 0) return;
    const src = cropQueue[cropQueueIdx]?.prescaled;
    if (!src) return;

    // Fit canvas to viewport
    const availW = (typeof window !== "undefined" ? window.innerWidth : 800) - 32;
    const availH = (typeof window !== "undefined" ? window.innerHeight : 600) - 220;
    const scaleW = availW / src.width;
    const scaleH = availH / src.height;
    const scale  = Math.min(scaleW, scaleH, 1);
    canvas.width  = Math.round(src.width  * scale);
    canvas.height = Math.round(src.height * scale);
    (canvas as any).style.display = "block";
    (canvas as any).style.margin  = "0 auto";

    const ctx = canvas.getContext("2d")!;
    const W = canvas.width, H = canvas.height;
    const b = cropBoxRef.current;

    // Draw source image
    ctx.drawImage(src, 0, 0, W, H);

    // Dark overlay
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);

    // Redraw crop region from source
    const bx = b.x * W, by = b.y * H, bw = b.w * W, bh = b.h * H;
    ctx.drawImage(src,
      b.x * src.width, b.y * src.height, b.w * src.width, b.h * src.height,
      bx, by, bw, bh,
    );

    // Border
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);

    // Corner handles
    const hs = 10;
    ctx.fillStyle = ACCENT;
    for (const [hx, hy] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]] as [number, number][]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }

    // Grid preview lines
    if (gridPreset.rows > 1 || gridPreset.cols > 1) {
      ctx.strokeStyle = "rgba(200,155,60,0.35)";
      ctx.lineWidth = 1;
      for (let c = 1; c < gridPreset.cols; c++) {
        const x = bx + bw * (c / gridPreset.cols);
        ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x, by + bh); ctx.stroke();
      }
      for (let r = 1; r < gridPreset.rows; r++) {
        const y = by + bh * (r / gridPreset.rows);
        ctx.beginPath(); ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); ctx.stroke();
      }
    }

    // Title Guide Overlays
    ctx.fillStyle = "rgba(34, 197, 94, 0.15)";
    ctx.strokeStyle = "rgba(34, 197, 94, 0.45)";
    ctx.lineWidth = 1;
    const cellW = bw / gridPreset.cols;
    const cellH = bh / gridPreset.rows;
    for (let r = 0; r < gridPreset.rows; r++) {
      for (let c = 0; c < gridPreset.cols; c++) {
        const cx = bx + c * cellW;
        const cy = by + r * cellH;
        const txtX = cx + cellW * 0.08;
        const txtY = cy + cellH * 0.02;
        const txtW = cellW * 0.82;
        const txtH = cellH * 0.16;
        ctx.fillRect(txtX, txtY, txtW, txtH);
        ctx.strokeRect(txtX, txtY, txtW, txtH);
      }
    }
  }, [cropBox, cropQueueIdx, cropQueue, gridPreset]);

  // ── Crop canvas: pointer events ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = cropCanvasRef.current;
    if (!canvas || cropQueue.length === 0) return;

    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const nx = clamp01((e.clientX - rect.left) / rect.width);
      const ny = clamp01((e.clientY - rect.top)  / rect.height);
      const b  = cropBoxRef.current;
      const T  = 0.05; // corner hit tolerance (normalized)

      let mode: DragMode = "draw";
      if      (Math.abs(nx - b.x)        < T && Math.abs(ny - b.y)        < T) mode = "tl";
      else if (Math.abs(nx - (b.x + b.w)) < T && Math.abs(ny - b.y)       < T) mode = "tr";
      else if (Math.abs(nx - b.x)        < T && Math.abs(ny - (b.y + b.h)) < T) mode = "bl";
      else if (Math.abs(nx - (b.x + b.w)) < T && Math.abs(ny - (b.y + b.h)) < T) mode = "br";
      else if (nx > b.x && nx < b.x + b.w && ny > b.y && ny < b.y + b.h) mode = "move";

      dragRef.current = { mode, startNX: nx, startNY: ny, origBox: { ...b } };
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const rect = canvas.getBoundingClientRect();
      const nx = clamp01((e.clientX - rect.left) / rect.width);
      const ny = clamp01((e.clientY - rect.top)  / rect.height);
      const { mode, startNX: sx, startNY: sy, origBox: ob } = d;
      const dx = nx - sx, dy = ny - sy;
      const MIN = 0.05;

      let nb: BBox;
      if (mode === "draw") {
        nb = {
          x: Math.min(sx, nx), y: Math.min(sy, ny),
          w: Math.max(MIN, Math.abs(nx - sx)), h: Math.max(MIN, Math.abs(ny - sy)),
        };
      } else if (mode === "move") {
        nb = {
          x: clamp01(Math.min(ob.x + dx, 1 - ob.w)),
          y: clamp01(Math.min(ob.y + dy, 1 - ob.h)),
          w: ob.w, h: ob.h,
        };
      } else if (mode === "tl") {
        const r = ob.x + ob.w, b2 = ob.y + ob.h;
        nb = { x: clamp01(nx), y: clamp01(ny), w: Math.max(MIN, r - nx), h: Math.max(MIN, b2 - ny) };
      } else if (mode === "tr") {
        const b2 = ob.y + ob.h;
        nb = { x: ob.x, y: clamp01(ny), w: Math.max(MIN, nx - ob.x), h: Math.max(MIN, b2 - ny) };
      } else if (mode === "bl") {
        const r = ob.x + ob.w;
        nb = { x: clamp01(nx), y: ob.y, w: Math.max(MIN, r - nx), h: Math.max(MIN, ny - ob.y) };
      } else { // br
        nb = { x: ob.x, y: ob.y, w: Math.max(MIN, nx - ob.x), h: Math.max(MIN, ny - ob.y) };
      }

      updateCropBox(nb);
    };

    const onUp = () => { dragRef.current = null; };

    canvas.addEventListener("pointerdown",  onDown);
    canvas.addEventListener("pointermove",  onMove);
    canvas.addEventListener("pointerup",    onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown",  onDown);
      canvas.removeEventListener("pointermove",  onMove);
      canvas.removeEventListener("pointerup",    onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [cropQueue, cropQueueIdx, updateCropBox]);

  // ── File input → build crop queue ────────────────────────────────────────────
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || !files.length || !selectedSet || !workerRef.current) return;
    const items: CropItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const dataUrl = await new Promise<string>(res => {
        const reader = new FileReader();
        reader.onload = e => res(e.target!.result as string);
        reader.readAsDataURL(files[i]);
      });
      const img = await new Promise<HTMLImageElement>(res => {
        const el = new (window as any).Image() as HTMLImageElement;
        el.onload = () => res(el);
        el.src = dataUrl;
      });
      items.push({ prescaled: prescaleImage(img, 2000) });
    }
    // Reset file input so re-selecting same files still fires onChange
    if (fileInputRef.current) fileInputRef.current.value = "";
    confirmedCropsRef.current = [];
    updateCropBox({ x: 0.05, y: 0.05, w: 0.90, h: 0.90 });
    setCropQueueIdx(0);
    setCropQueue(items);
  };

  // ── Confirm crop for current page, advance or start scan ─────────────────────
  const handleCropConfirm = () => {
    const item = cropQueue[cropQueueIdx];
    if (!item) return;
    confirmedCropsRef.current.push({ prescaled: item.prescaled, bbox: { ...cropBoxRef.current } });

    if (cropQueueIdx < cropQueue.length - 1) {
      updateCropBox({ x: 0.05, y: 0.05, w: 0.90, h: 0.90 });
      setCropQueueIdx(i => i + 1);
    } else {
      const crops = [...confirmedCropsRef.current];
      setCropQueue([]);
      processBatch(crops, gridPreset.rows, gridPreset.cols);
    }
  };

  // ── Process all confirmed crops (semaphore-limited, throttled API) ───────────
  const processBatch = async (crops: ConfirmedCrop[], rows: number, cols: number) => {
    if (!workerRef.current || !selectedSet) return;
    const total = crops.length * rows * cols;
    setProcessing(true);
    setResults([]);
    setProgress({ current: 0, total });
    setTotalCells(total);
    setShowOriginalPhoto(false);
    setOriginalPhotos(crops.map(c => drawPhotoWithGrid(c.prescaled, c.bbox, rows, cols)));

    const allResults: (ScanResult | null)[] = new Array(total).fill(null);
    let completed = 0;

    // Capture current card list for local fuzzy matching
    const localCards = setCards;
    const setCode    = selectedSet.code;

    const tasks: Array<() => Promise<void>> = [];
    for (let b = 0; b < crops.length; b++) {
      const { prescaled, bbox } = crops[b];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = b * rows * cols + row * cols + col;
          tasks.push(async () => {
            await ocrSem.acquire();
            let result: ScanResult | null = null;
            try {
              result = await processCell(prescaled, bbox, row, col, rows, cols, idx, localCards, setCode);
            } finally {
              ocrSem.release();
            }
            if (result) {
              allResults[idx] = result;
            }
            completed++;
            setProgress({ current: completed, total });
            setResults(allResults.filter((r): r is ScanResult => r !== null));
          });
        }
      }
    }

    await Promise.all(tasks.map(t => t()));
    setProcessing(false);
  };

  // ── OCR + search for a single grid cell ──────────────────────────────────────
  const processCell = async (
    img: HTMLCanvasElement,
    bbox: BBox,
    row: number, col: number,
    rows: number, cols: number,
    index: number,
    localCards: ScryfallCard[],
    setCode: string,
  ): Promise<ScanResult> => {
    const W = img.width, H = img.height;
    const bx = bbox.x * W, by = bbox.y * H;
    const bw = bbox.w * W, bh = bbox.h * H;
    const cellW = bw / cols, cellH = bh / rows;
    const cellX = bx + col * cellW, cellY = by + row * cellH;

    // Thumbnail
    const thumb = document.createElement("canvas");
    thumb.width  = Math.round(cellW);
    thumb.height = Math.round(cellH);
    thumb.getContext("2d")!.drawImage(img, cellX, cellY, cellW, cellH, 0, 0, cellW, cellH);
    const thumbDataUrl = thumb.toDataURL("image/jpeg", 0.5);

    // OCR strip: top 16% of cell, 8% left inset, 10% right inset
    const sx = cellX + cellW * 0.08, sy = cellY + cellH * 0.02;
    const sw = cellW * 0.82,         sh = cellH * 0.16;

    const ocrCanvas = document.createElement("canvas");
    ocrCanvas.width  = Math.round(sw * 2);
    ocrCanvas.height = Math.round(sh * 2);
    const ctx = ocrCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ocrCanvas.width, ocrCanvas.height);
    const id = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
    for (let i = 0; i < id.data.length; i += 4) {
      const g = 0.299 * id.data[i] + 0.587 * id.data[i + 1] + 0.114 * id.data[i + 2];
      const v = Math.max(0, Math.min(255, 2.0 * (g - 128) + 128));
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);

    const ocrDataUrl = ocrCanvas.toDataURL("image/jpeg", 0.95);
    let rawOcr = "", extractedName = "", collectorNumber = "";
    try {
      const { data: { text } } = await workerRef.current!.recognize(ocrDataUrl);
      rawOcr = text;
      const info = extractCardInfo(text);
      if (info?.name) extractedName = info.name;
      if (info?.collectorNumber) collectorNumber = info.collectorNumber;
    } catch { /* skip */ }

    if (!extractedName || extractedName.length < 3) {
      return { index, thumbDataUrl, ocrDataUrl, rawOcr, extractedName, status: "empty", card: null, candidates: [], reviewName: "" };
    }

    const sanitized = extractedName.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    let card: ScryfallCard | null = null;
    let candidates: ScryfallCard[] = [];

    // A. Local fuzzy (no network cost)
    if (localCards.length > 0) {
      const local = localCards
        .map(c => ({ card: c, score: similarity(sanitized, c.name) }))
        .sort((a, b) => b.score - a.score);
      
      const goodMatches = local.filter(m => m.score > 0.4).slice(0, 5);
      
      if (goodMatches.length > 0 && goodMatches[0].score > 0.85) {
        card = goodMatches[0].card;
        candidates = goodMatches.map(m => m.card);
      } else {
        // Even if we fail to auto-identify, populate top 3 locals into candidates for the Fix menu
        candidates = local.slice(0, 3).map(m => m.card);
      }
    }

    // B. Autocomplete spell-check
    if (!card) {
      try {
        const sugg = await autocompleteCardName(sanitized);
        if (sugg[0]) {
          const res = await searchCardByNameInSet(sugg[0], setCode);
          if (res.length > 0) { card = res[0]; candidates = res; }
        }
      } catch { /* non-fatal */ }
    }

    // C. Direct search
    if (!card) {
      try {
        const res = await searchCardByNameInSet(sanitized, setCode);
        if (res.length > 0) { card = res[0]; candidates = res; }
      } catch { /* non-fatal */ }
    }

    return {
      index, thumbDataUrl, ocrDataUrl, rawOcr, extractedName,
      status: card ? "identified" : "review",
      card, candidates, reviewName: extractedName,
    };
  };

  // ── Review modal helpers ──────────────────────────────────────────────────────
  const handleReviewSearch = useCallback(async (query: string) => {
    if (!query.trim() || !selectedSet) return;

    // Cancel any in-flight request from the previous keystroke burst
    abortSearchRef.current?.abort();
    abortSearchRef.current = new AbortController();
    const { signal } = abortSearchRef.current;

    setReviewSearching(true);
    try {
      const sugg = await throttledApi(() => autocompleteCardName(query));
      if (signal.aborted) return;
      const res  = await throttledApi(() => searchCardByNameInSet(sugg[0] ?? query, selectedSet.code));
      if (signal.aborted) return;
      setReviewCandidates(res.slice(0, 8));
    } catch (err: any) {
      if (!signal.aborted) setReviewCandidates([]);
    } finally {
      if (!signal.aborted) setReviewSearching(false);
    }
  }, [selectedSet]);

  const applyReviewCard = (card: ScryfallCard) => {
    if (reviewIdx === null) return;
    setResults(prev => prev.map((r, i) =>
      i === reviewIdx ? { ...r, card, status: "identified" as const } : r
    ));
    setReviewIdx(null);
    setReviewSearch("");
    setReviewCandidates([]);
  };

  // Fix: filter by r.index (cell index), not array position
  const removeResult = (cellIndex: number) => {
    setResults(prev => prev.filter(r => r.index !== cellIndex));
  };

  // ── Commit ────────────────────────────────────────────────────────────────────
  const identifiedCards = results.filter(r => r.status === "identified" && r.card);
  const reviewCards     = results.filter(r => r.status === "review");

  const handleCommit = async () => {
    if (!activeSession || identifiedCards.length === 0 || committing) return;
    setCommitting(true);
    try {
      await bulkAddCards(identifiedCards.map(r => {
        const n = normalizeScryfallCard(r.card!);
        return {
          sessionId: activeSession.id,
          scryfallId: n.scryfallId,
          name: n.name,
          setCode: n.setCode,
          setName: n.setName,
          collectorNumber: n.collectorNumber,
          rarity: n.rarity,
          colors: n.colors,
          isFoil: false,
          condition: "NM" as const,
          quantity: 1,
          priceUsd: n.priceUsd,
          priceUsdFoil: n.priceUsdFoil,
          imageUri: n.imageUri,
          scryfallUri: n.scryfallUri,
        };
      }));
      setResults([]);
      alert(`✓ ${identifiedCards.length} card${identifiedCards.length !== 1 ? "s" : ""} added to "${activeSession.name}"`);
    } catch {
      alert("Failed to save cards. Please try again.");
    } finally {
      setCommitting(false);
    }
  };

  const filteredSets = setFilter.trim()
    ? setList.filter(s =>
        s.name.toLowerCase().includes(setFilter.toLowerCase()) ||
        s.code.toLowerCase().includes(setFilter.toLowerCase())
      )
    : setList;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef as any}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" } as any}
        onChange={e => handleFilesSelected((e.target as HTMLInputElement).files)}
      />

      {/* ── Camera Overlay (Full-screen when scanning pages) ── */}
      {cameraOpen && (
        <View style={styles.cameraOverlay}>
          {Platform.OS === "web" ? (
             <video
               ref={videoRef}
               autoPlay playsInline muted
               style={{ width: "100%", height: "100%", objectFit: "cover", position: "absolute", zIndex: 0 } as any}
             />
          ) : (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing="back"
            />
          )}

          <View style={[styles.cameraTop, { zIndex: 10 }]}>
             <Pressable style={styles.cameraCloseBtn} onPress={() => setCameraOpen(false)}>
               <Text style={styles.cameraCloseText}>✕ Cancel</Text>
             </Pressable>
             <View style={styles.cameraBadge}>
               <Text style={styles.cameraBadgeText}>{cropQueue.length} Taken</Text>
             </View>
             {cropQueue.length > 0 ? (
               <Pressable style={styles.cameraDoneBtn} onPress={() => { setCameraOpen(false); setCropQueueIdx(0); }}>
                 <Text style={styles.cameraDoneBtnText}>Done</Text>
               </Pressable>
             ) : <View style={{ width: 80 }} />}
          </View>

          <View style={[styles.cameraBottom, { zIndex: 10 }]}>
            <Pressable style={styles.cameraCaptureBtn} onPress={handleCapturePhoto}>
              <View style={styles.cameraCaptureInner} />
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Crop overlay (full-screen, shows per uploaded photo) ── */}
      {cropQueue.length > 0 && !cameraOpen && (
        <View style={styles.cropOverlay}>
          <View style={styles.cropHeader}>
            <Text style={styles.cropTitle}>
              Align Cards — Page {cropQueueIdx + 1} of {cropQueue.length}
            </Text>
            <Pressable onPress={() => setCropQueue([])} style={styles.cropCancelBtn}>
              <Text style={styles.cropCancelText}>✕ Cancel</Text>
            </Pressable>
          </View>

          <View style={styles.cropCanvasWrap}>
            <canvas ref={cropCanvasRef as any} style={{ touchAction: "none", cursor: "crosshair" } as any} />
          </View>

          <View style={styles.cropFooter}>
            <Text style={styles.cropHint}>Drag corners or draw a new box to isolate the card area</Text>
            <Pressable style={styles.cropConfirmBtn} onPress={handleCropConfirm}>
              <Text style={styles.cropConfirmText}>
                {cropQueueIdx < cropQueue.length - 1
                  ? `Confirm & Next Page (${cropQueueIdx + 2}/${cropQueue.length}) →`
                  : "Confirm & Start Scanning →"}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Main scroll content ── */}
      <ScrollView contentContainerStyle={styles.content}>
        {/* Config card */}
        <View style={styles.configCard}>
          <Pressable style={styles.setBtn} onPress={() => setSetPickerOpen(true)}>
            <Text style={styles.setBtnLabel}>Set</Text>
            <Text style={styles.setBtnValue} numberOfLines={1}>
              {selectedSet ? `${selectedSet.name} (${selectedSet.code.toUpperCase()})` : "Tap to select…"}
            </Text>
          </Pressable>
          <View style={styles.gridRow}>
            <Text style={styles.gridLabel}>Grid</Text>
            <View style={styles.gridBtns}>
              {GRID_PRESETS.map(g => (
                <Pressable
                  key={g.label}
                  style={[styles.gridBtn, gridPreset.label === g.label && styles.gridBtnActive]}
                  onPress={() => setGridPreset(g)}
                >
                  <Text style={[styles.gridBtnText, gridPreset.label === g.label && styles.gridBtnTextActive]}>
                    {g.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {/* Actions */}
        {!processing && results.length === 0 && (
          !selectedSet ? (
            <Pressable
              style={[styles.uploadBtn, { borderColor: ACCENT, backgroundColor: "rgba(200,155,60,0.08)" }]}
              onPress={() => setSetPickerOpen(true)}
            >
              <Text style={styles.uploadEmoji}>🔍</Text>
              <Text style={[styles.uploadTitle, { color: ACCENT }]}>Step 1: Select a Set</Text>
              <Text style={styles.uploadSub}>Tap here to choose which Magic set you are scanning</Text>
            </Pressable>
          ) : (
            <View style={styles.actionsRow}>
              <Pressable
                style={styles.actionBtnCamera}
                onPress={async () => {
                  if (Platform.OS === "web") {
                    try {
                      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                      stream.getTracks().forEach(t => t.stop());
                      setWebPermissionGranted(true);
                      setCameraOpen(true);
                    } catch (e) { alert("Camera permission denied."); }
                  } else {
                    if (!permission?.granted) await requestPermission();
                    setCameraOpen(true);
                  }
                }}
              >
                <Text style={styles.actionBtnEmoji}>📸</Text>
                <Text style={styles.actionBtnTitle}>Take Photos</Text>
              </Pressable>
              
              <Pressable
                style={styles.actionBtnUpload}
                onPress={() => (fileInputRef.current as any)?.click()}
              >
                <Text style={styles.actionBtnEmoji}>📖</Text>
                <Text style={styles.actionBtnTitleUpload}>Upload Files</Text>
              </Pressable>
            </View>
          )
        )}

        {/* ── Binder results ── */}
        {results.length > 0 && (
          <>
            {/* Top status bar */}
            <View style={styles.summaryRow}>
              <View style={[styles.summaryBadge, { backgroundColor: "rgba(34,197,94,0.15)", borderColor: GREEN }]}>
                <Text style={[styles.summaryBadgeText, { color: GREEN }]}>✓ {identifiedCards.length}</Text>
              </View>
              {reviewCards.length > 0 && (
                <View style={[styles.summaryBadge, { backgroundColor: "rgba(249,115,22,0.15)", borderColor: "#f97316" }]}>
                  <Text style={[styles.summaryBadgeText, { color: "#f97316" }]}>! {reviewCards.length} need fix</Text>
                </View>
              )}
              <Pressable
                style={[styles.viewPhotoBtn, showOriginalPhoto && styles.viewPhotoBtnActive]}
                onPress={() => setShowOriginalPhoto(v => !v)}
              >
                <Text style={styles.viewPhotoBtnText}>{showOriginalPhoto ? "Hide Photo" : "View Photo"}</Text>
              </Pressable>
              {!processing && (
                <Pressable style={styles.rescanBtn} onPress={() => { setResults([]); setOriginalPhotos([]); }}>
                  <Text style={styles.rescanBtnText}>↺ New</Text>
                </Pressable>
              )}
            </View>

            {/* Original photo context view */}
            {showOriginalPhoto && originalPhotos.length > 0 && (
              <View style={styles.originalPhotoSection}>
                {originalPhotos.map((url, pi) => (
                  <View key={pi} style={styles.originalPhotoWrapper}>
                    {originalPhotos.length > 1 && (
                      <Text style={styles.originalPhotoLabel}>Page {pi + 1}</Text>
                    )}
                    <img
                      src={url}
                      style={{ width: "100%", borderRadius: 10, display: "block" } as any}
                      alt={`Binder page ${pi + 1}`}
                    />
                  </View>
                ))}
              </View>
            )}

            {/* Physical binder grid pages */}
            {!showOriginalPhoto && originalPhotos.map((_, pageIdx) => {
              const cellsPerPage = gridPreset.rows * gridPreset.cols;
              const pageStart = pageIdx * cellsPerPage;
              return (
                <View key={pageIdx} style={styles.binderPage}>
                  {/* Ring holes */}
                  <View style={styles.binderRingsRow}>
                    {Array.from({ length: Math.max(3, gridPreset.cols) }).map((_, ri) => (
                      <View key={ri} style={styles.binderRingHole} />
                    ))}
                  </View>

                  {/* Card pocket grid */}
                  <View style={styles.binderGrid}>
                    {Array.from({ length: gridPreset.rows }).map((_, rowIdx) => (
                      <View key={rowIdx} style={styles.binderRow}>
                        {Array.from({ length: gridPreset.cols }).map((_, colIdx) => {
                          const cellIndex = pageStart + rowIdx * gridPreset.cols + colIdx;
                          const r = results.find(res => res.index === cellIndex);
                          const isSuccess = r?.status === "identified";
                          const isReview  = r?.status === "review";
                          const stillProcessing = processing && !r;
                          const cardImg =
                            r?.card?.image_uris?.small ??
                            r?.card?.card_faces?.[0]?.image_uris?.small ??
                            null;

                          return (
                            <Pressable
                              key={colIdx}
                              style={[
                                styles.pocket,
                                isSuccess && styles.pocketSuccess,
                                isReview  && styles.pocketReview,
                              ]}
                              onPress={() => {
                                if (!isReview || !r) return;
                                setReviewIdx(results.indexOf(r));
                                setReviewSearch(r.extractedName);
                                setReviewCandidates(r.candidates);
                              }}
                              disabled={!isReview}
                            >
                              {/* Card image */}
                              {(isSuccess || isReview) && (
                                <img
                                  src={isSuccess && cardImg ? cardImg : r!.thumbDataUrl}
                                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 5, display: "block" } as any}
                                  alt=""
                                />
                              )}

                              {/* Empty / loading */}
                              {!r && (
                                stillProcessing
                                  ? <ActivityIndicator color={ACCENT} size="small" style={{ flex: 1 }} />
                                  : <View style={styles.emptyPocket} />
                              )}

                              {/* Status badges */}
                              {isSuccess && (
                                <View style={styles.successBadge}>
                                  <Text style={styles.successBadgeText}>✓</Text>
                                </View>
                              )}
                              {isReview && (
                                <View style={styles.reviewBadge}>
                                  <Text style={styles.reviewBadgeText}>!</Text>
                                </View>
                              )}
                              {isReview && (
                                <View style={styles.tapToFixOverlay}>
                                  <Text style={styles.tapToFixText}>Tap to Fix</Text>
                                </View>
                              )}
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* ── Sticky progress bar (overlays bottom while processing) ── */}
      {processing && (
        <View style={styles.stickyProgress}>
          <View style={styles.stickyProgressRow}>
            <ActivityIndicator color={ACCENT} size="small" />
            <Text style={styles.stickyProgressText}>
              Processing card {progress.current} of {progress.total}…
            </Text>
          </View>
          <View style={styles.stickyBarBg}>
            <View style={[styles.stickyBarFill, {
              width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` as any,
            }]} />
          </View>
        </View>
      )}

      {/* ── Fix card modal (bottom sheet) ── */}
      <Modal visible={reviewIdx !== null} animationType="slide" transparent onRequestClose={() => { setReviewIdx(null); setReviewCandidates([]); }}>
        <View style={styles.modalBg}>
          <View style={styles.modalSheet}>

            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Identify Card</Text>
              <Pressable onPress={() => { setReviewIdx(null); setReviewCandidates([]); setReviewSearch(""); }}>
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>

            {/* Full crop thumbnail — lets user read the card name despite glare */}
            {reviewIdx !== null && results[reviewIdx] && (
              <View style={styles.modalThumbRow}>
                <View style={styles.modalThumbCard}>
                  <img
                    src={results[reviewIdx].thumbDataUrl}
                    style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 8, display: "block" } as any}
                    alt="Card crop"
                  />
                </View>
                <View style={styles.modalThumbMeta}>
                  <Text style={styles.modalThumbLabel}>OCR read:</Text>
                  <Text style={styles.modalThumbOcr} numberOfLines={2}>
                    "{results[reviewIdx].extractedName || "—"}"
                  </Text>
                  {results[reviewIdx].ocrDataUrl && (
                    <View style={styles.modalOcrStripWrap}>
                      <img
                        src={results[reviewIdx].ocrDataUrl}
                        style={{ width: "100%", height: 36, objectFit: "contain", borderRadius: 4, display: "block" } as any}
                        alt="OCR strip"
                      />
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Search input + absolute autocomplete dropdown */}
            <View style={styles.searchWrapper}>
              <View style={styles.reviewSearchRow}>
                <TextInput
                  style={styles.reviewInput}
                  value={reviewSearch}
                  onChangeText={text => {
                    setReviewSearch(text);
                    if (!text.trim()) setReviewCandidates([]);
                  }}
                  placeholder="Type card name…"
                  placeholderTextColor="#606078"
                  autoFocus
                  onSubmitEditing={() => handleReviewSearch(reviewSearch)}
                  returnKeyType="search"
                />
                {reviewSearching
                  ? <ActivityIndicator color={ACCENT} style={{ paddingHorizontal: 14 }} />
                  : reviewSearch.trim()
                    ? <Pressable style={styles.reviewSearchBtn} onPress={() => handleReviewSearch(reviewSearch)}>
                        <Text style={styles.reviewSearchBtnText}>Go</Text>
                      </Pressable>
                    : null
                }
              </View>

              {/* Floating autocomplete dropdown */}
              {reviewCandidates.length > 0 && (
                <View style={styles.autocompleteDropdown}>
                  <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 260 as any }}>
                    {reviewCandidates.map(card => {
                      const thumb = card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
                      return (
                        <Pressable key={card.id} style={styles.reviewCandidate} onPress={() => applyReviewCard(card)}>
                          {thumb ? (
                            <img
                              src={thumb}
                              style={{ width: 36, height: 50, objectFit: "cover", borderRadius: 4, flexShrink: 0 } as any}
                              alt=""
                            />
                          ) : null}
                          <View style={{ flex: 1 }}>
                            <Text style={styles.reviewCandidateName}>{card.name}</Text>
                            <Text style={styles.reviewCandidateMeta}>
                              {card.set.toUpperCase()} #{card.collector_number} · {card.rarity}
                            </Text>
                          </View>
                          <Text style={styles.reviewCandidateArrow}>→</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Floating commit button ── */}
      {results.length > 0 && !processing && identifiedCards.length > 0 && (
        <Pressable
          style={[styles.floatingCommit, (!activeSession || committing) && styles.floatingCommitDisabled]}
          onPress={handleCommit}
          disabled={!activeSession || committing}
        >
          {committing ? (
            <ActivityIndicator color="#0a0a0f" />
          ) : (
            <>
              <Text style={styles.floatingCommitText}>
                {activeSession
                  ? `Commit ${identifiedCards.length} Card${identifiedCards.length !== 1 ? "s" : ""} to Vault`
                  : "No active session"}
              </Text>
              {reviewCards.length > 0 && (
                <Text style={styles.floatingCommitSub}>
                  {reviewCards.length} unresolved will be skipped
                </Text>
              )}
            </>
          )}
        </Pressable>
      )}

      {/* ── Set picker modal ── */}
      <Modal visible={setPickerOpen} animationType="slide" onRequestClose={() => setSetPickerOpen(false)}>
        <View style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Select a Set</Text>
            <Pressable onPress={() => setSetPickerOpen(false)}>
              <Text style={styles.pickerClose}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.pickerSearch}
            value={setFilter}
            onChangeText={setSetFilter}
            placeholder="Search by name or code…"
            placeholderTextColor="#606078"
            autoFocus
          />
          {setsLoading
            ? <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
            : (
              <ScrollView>
                {filteredSets.map(s => (
                  <Pressable
                    key={s.code}
                    style={styles.pickerItem}
                    onPress={() => { setSelectedSet({ code: s.code, name: s.name }); setSetFilter(""); setSetPickerOpen(false); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickerItemName}>{s.name}</Text>
                      <Text style={styles.pickerItemMeta}>{s.code.toUpperCase()} · {s.card_count} cards</Text>
                    </View>
                    <Text style={{ color: ACCENT }}>→</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )
          }
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  content:   { padding: 16, paddingBottom: 130 },

  // ── Crop overlay ─────────────────────────────────────────────────────────────
  cropOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "#0a0a0f", zIndex: 200, flexDirection: "column",
  },
  cropHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 16, borderBottomWidth: 1, borderColor: "#222233",
  },
  cropTitle:     { color: "#f0f0f8", fontSize: 16, fontWeight: "800" },
  cropCancelBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#1a1a26", borderRadius: 10 },
  cropCancelText:{ color: "#606078", fontWeight: "700", fontSize: 13 },
  cropCanvasWrap:{ flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 8 },
  cropFooter:    { padding: 16, borderTopWidth: 1, borderColor: "#222233", gap: 10 },
  cropHint:        { color: "#606078", fontSize: 12, textAlign: "center" },
  cropConfirmBtn:  { backgroundColor: ACCENT, borderRadius: 14, padding: 16, alignItems: "center" },
  cropConfirmText: { color: "#0a0a0f", fontWeight: "900", fontSize: 15 },

  // ── Config ───────────────────────────────────────────────────────────────────
  configCard: { backgroundColor: "#12121a", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#222233" },
  setBtn:     { marginBottom: 14 },
  setBtnLabel:{ color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  setBtnValue:{ color: ACCENT, fontSize: 16, fontWeight: "700" },
  gridRow:    { flexDirection: "row", alignItems: "center", gap: 12 },
  gridLabel:  { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, width: 32 },
  gridBtns:   { flexDirection: "row", gap: 8, flex: 1 },
  gridBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#222233" },
  gridBtnActive:    { backgroundColor: ACCENT, borderColor: ACCENT },
  gridBtnText:      { color: "#a0a0b8", fontWeight: "700", fontSize: 13 },
  gridBtnTextActive:{ color: "#0a0a0f" },

  // ── Actions ──────────────────────────────────────────────────────────────────
  actionsRow:           { flexDirection: "row", gap: 16, marginBottom: 24 },
  actionBtnCamera:      { flex: 1, alignItems: "center", padding: 32, borderRadius: 20, backgroundColor: ACCENT },
  actionBtnUpload:      { flex: 1, alignItems: "center", padding: 32, borderRadius: 20, backgroundColor: "#1a1a26", borderWidth: 2, borderColor: "#333348", borderStyle: "dashed" },
  actionBtnEmoji:       { fontSize: 36, marginBottom: 12 },
  actionBtnTitle:       { color: "#0a0a0f", fontSize: 16, fontWeight: "800", textAlign: "center" },
  actionBtnTitleUpload: { color: "#f0f0f8", fontSize: 16, fontWeight: "800", textAlign: "center" },
  uploadBtn:   { alignItems: "center", padding: 48, borderRadius: 20, borderWidth: 2, borderColor: "#222233", borderStyle: "dashed", marginBottom: 24 },
  uploadEmoji: { fontSize: 48, marginBottom: 12 },
  uploadTitle: { color: "#f0f0f8", fontSize: 20, fontWeight: "800", marginBottom: 6 },
  uploadSub:   { color: "#606078", fontSize: 14, textAlign: "center" },

  // ── Camera overlay ───────────────────────────────────────────────────────────
  cameraOverlay:      { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#000", zIndex: 300, justifyContent: "space-between" },
  cameraTop:          { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 24, paddingTop: 40, backgroundColor: "rgba(0,0,0,0.5)" },
  cameraCloseBtn:     { padding: 12, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12 },
  cameraCloseText:    { color: "#fff", fontWeight: "700" },
  cameraBadge:        { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 16 },
  cameraBadgeText:    { color: ACCENT, fontWeight: "900", fontSize: 16 },
  cameraDoneBtn:      { padding: 12, backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 20 },
  cameraDoneBtnText:  { color: "#000", fontWeight: "800", fontSize: 15 },
  cameraBottom:       { padding: 40, alignItems: "center", backgroundColor: "rgba(0,0,0,0.5)" },
  cameraCaptureBtn:   { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  cameraCaptureInner: { width: 66, height: 66, borderRadius: 33, backgroundColor: "white" },

  // ── Sticky progress bar ──────────────────────────────────────────────────────
  stickyProgress:     { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(10,10,15,0.97)", borderTopWidth: 1, borderColor: "#222233", padding: 14, gap: 8, zIndex: 100 },
  stickyProgressRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  stickyProgressText: { color: "#a0a0b8", fontSize: 14, fontWeight: "600", flex: 1 },
  stickyBarBg:        { height: 4, backgroundColor: "#1a1a26", borderRadius: 2, overflow: "hidden" },
  stickyBarFill:      { height: "100%", backgroundColor: ACCENT, borderRadius: 2 },

  // ── Results top bar ──────────────────────────────────────────────────────────
  summaryRow:      { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  summaryBadge:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  summaryBadgeText:{ fontWeight: "700", fontSize: 12 },
  rescanBtn:       { marginLeft: "auto" as any, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#333348" },
  rescanBtnText:   { color: "#a0a0b8", fontWeight: "700", fontSize: 12 },

  // "View Photo" toggle
  viewPhotoBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#333348" },
  viewPhotoBtnActive: { backgroundColor: "rgba(200,155,60,0.18)", borderColor: ACCENT },
  viewPhotoBtnText:   { color: "#a0a0b8", fontWeight: "700", fontSize: 12 },

  // ── Original photo context view ──────────────────────────────────────────────
  originalPhotoSection: { marginBottom: 20, gap: 10 },
  originalPhotoWrapper: { borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#252d42" },
  originalPhotoLabel:   { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, padding: 8, backgroundColor: "#12121a" },

  // ── Physical binder page ─────────────────────────────────────────────────────
  binderPage: {
    backgroundColor: "#161c2e",
    borderRadius: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#252d42",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 14,
    elevation: 10,
    // Constrain width so cards are not enormous on wide screens
    maxWidth: 520,
    width: "100%" as any,
    alignSelf: "center",
  },
  binderRingsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#0e1320",
    borderBottomWidth: 1,
    borderColor: "#252d42",
  },
  binderRingHole: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "#0a0a0f",
    borderWidth: 2, borderColor: "#3a4460",
  },
  binderGrid: { padding: 10, gap: 6 },
  binderRow:  { flexDirection: "row", gap: 6 },

  // ── Card pockets ─────────────────────────────────────────────────────────────
  pocket: {
    flex: 1,
    aspectRatio: 63 / 88,
    backgroundColor: "#0d1117",
    borderRadius: 6,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#252d42",
  },
  pocketSuccess: {
    borderWidth: 2,
    borderColor: "#22c55e",
  },
  pocketReview: {
    borderWidth: 2,
    borderColor: "#f97316",
    shadowColor: "#f97316",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.65,
    shadowRadius: 10,
    elevation: 6,
  },
  emptyPocket: { flex: 1, backgroundColor: "#0b0f1a" },

  // Status badges (corner pins)
  successBadge:     { position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center" },
  successBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900", lineHeight: 14 },
  reviewBadge:      { position: "absolute", top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: "#f97316", alignItems: "center", justifyContent: "center" },
  reviewBadgeText:  { color: "#fff", fontSize: 12, fontWeight: "900", lineHeight: 16 },

  // "Tap to Fix" bottom banner on review pockets
  tapToFixOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "rgba(249,115,22,0.88)", paddingVertical: 3, alignItems: "center" },
  tapToFixText:    { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },

  // ── Floating commit button ───────────────────────────────────────────────────
  floatingCommit: {
    position: "absolute",
    bottom: 20,
    left: 16,
    right: 16,
    backgroundColor: ACCENT,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: "center",
    zIndex: 90,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 8,
  },
  floatingCommitDisabled: { opacity: 0.5 },
  floatingCommitText:     { color: "#0a0a0f", fontWeight: "900", fontSize: 16 },
  floatingCommitSub:      { color: "rgba(10,10,15,0.6)", fontSize: 12, fontWeight: "600", marginTop: 2 },

  // ── Fix card modal (centered dialog) ─────────────────────────────────────────
  modalBg:    { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalSheet: {
    backgroundColor: "#12121a",
    borderRadius: 20,
    width: "100%" as any, maxWidth: 480, maxHeight: "82%" as any,
    borderWidth: 1, borderColor: "#222233",
    padding: 20,
  },
  modalHandle: { display: "none" as any },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle:  { color: "#f0f0f8", fontSize: 18, fontWeight: "800" },
  modalClose:  { color: "#606078", fontSize: 22, padding: 4 },

  // Thumbnail + OCR strip row inside modal
  modalThumbRow:    { flexDirection: "row", gap: 12, marginBottom: 16, backgroundColor: "#0a0a0f", borderRadius: 12, padding: 10, borderWidth: 1, borderColor: "#222233" },
  modalThumbCard:   { width: 72, aspectRatio: 63 / 88, borderRadius: 6, overflow: "hidden", backgroundColor: "#1a1a26", flexShrink: 0 },
  modalThumbMeta:   { flex: 1, justifyContent: "center", gap: 6 },
  modalThumbLabel:  { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  modalThumbOcr:    { color: "#f0f0f8", fontSize: 13, fontWeight: "600", fontStyle: "italic" },
  modalOcrStripWrap:{ backgroundColor: "#1a1a26", borderRadius: 6, padding: 4 },

  searchWrapper:       { position: "relative", zIndex: 10, marginBottom: 16 },
  autocompleteDropdown: {
    position: "absolute",
    top: 52 as any,   // sits just below the ~48px input row
    left: 0, right: 0,
    backgroundColor: "#0e0e18",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333348",
    zIndex: 999,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 16,
  },
  reviewSearchRow:     { flexDirection: "row", gap: 8, alignItems: "center" },
  reviewInput:         { flex: 1, backgroundColor: "#0a0a0f", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#333348" },
  reviewSearchBtn:     { backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 11, justifyContent: "center" },
  reviewSearchBtnText: { color: "#0a0a0f", fontWeight: "800", fontSize: 14 },
  reviewCandidate:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderBottomWidth: 1, borderColor: "#1a1a26" },
  reviewCandidateName: { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  reviewCandidateMeta: { color: "#606078", fontSize: 12, marginTop: 2 },
  reviewCandidateArrow:{ color: ACCENT, fontSize: 18, paddingLeft: 8 },

  // ── Set picker ───────────────────────────────────────────────────────────────
  pickerContainer: { flex: 1, backgroundColor: "#0a0a0f" },
  pickerHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderColor: "#222233" },
  pickerTitle:     { color: "#f0f0f8", fontSize: 20, fontWeight: "800" },
  pickerClose:     { color: "#606078", fontSize: 22, padding: 4 },
  pickerSearch:    { margin: 16, backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#222233" },
  pickerItem:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: "#111120" },
  pickerItemName:  { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  pickerItemMeta:  { color: "#606078", fontSize: 12, marginTop: 2 },
});
