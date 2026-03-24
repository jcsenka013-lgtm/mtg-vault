import { useState, useRef, useEffect, useCallback } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, TextInput, Modal,
} from "react-native";
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

function extractName(text: string): string {
  return text.replace(/\n+/g, " ").replace(/[^a-zA-Z\s'\-]/g, " ").replace(/\s\s+/g, " ").trim();
}

/** Downscale a photo to maxW pixels wide (preserving aspect ratio). */
function prescaleImage(img: HTMLImageElement, maxW = 2000): HTMLCanvasElement {
  const scale = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width  = Math.round(img.naturalWidth  * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
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

  const workerRef   = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

    let rawOcr = "", extractedName = "";
    try {
      const { data: { text } } = await workerRef.current!.recognize(ocrCanvas.toDataURL("image/jpeg", 0.95));
      rawOcr = text;
      extractedName = extractName(text);
    } catch { /* skip */ }

    if (!extractedName || extractedName.length < 3) {
      return { index, thumbDataUrl, rawOcr, extractedName, status: "empty", card: null, candidates: [], reviewName: "" };
    }

    const sanitized = extractedName.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    let card: ScryfallCard | null = null;
    let candidates: ScryfallCard[] = [];

    // A. Local fuzzy (no network cost)
    if (localCards.length > 0) {
      const local = localCards
        .map(c => ({ card: c, score: similarity(sanitized, c.name) }))
        .filter(m => m.score > 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (local.length > 0 && local[0].score > 0.85) {
        card = local[0].card;
        candidates = local.map(m => m.card);
      }
    }

    // B. Autocomplete spell-check (throttled)
    if (!card) {
      try {
        const sugg = await throttledApi(() => autocompleteCardName(sanitized));
        if (sugg[0]) {
          const res = await throttledApi(() => searchCardByNameInSet(sugg[0], setCode));
          if (res.length > 0) { card = res[0]; candidates = res; }
        }
      } catch { /* non-fatal */ }
    }

    // C. Direct search (throttled)
    if (!card) {
      try {
        const res = await throttledApi(() => searchCardByNameInSet(sanitized, setCode));
        if (res.length > 0) { card = res[0]; candidates = res; }
      } catch { /* non-fatal */ }
    }

    return {
      index, thumbDataUrl, rawOcr, extractedName,
      status: card ? "identified" : "review",
      card, candidates, reviewName: extractedName,
    };
  };

  // ── Review modal helpers ──────────────────────────────────────────────────────
  const handleReviewSearch = async (query: string) => {
    if (!query.trim() || !selectedSet) return;
    setReviewSearching(true);
    try {
      const sugg = await throttledApi(() => autocompleteCardName(query));
      const res = await throttledApi(() =>
        searchCardByNameInSet(sugg[0] ?? query, selectedSet.code)
      );
      setReviewCandidates(res.slice(0, 8));
    } catch { setReviewCandidates([]); }
    finally { setReviewSearching(false); }
  };

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

      {/* ── Crop overlay (full-screen, shows per uploaded photo) ── */}
      {cropQueue.length > 0 && (
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

        {/* Upload button */}
        {!processing && results.length === 0 && (
          <Pressable
            style={[styles.uploadBtn, !selectedSet && styles.uploadBtnDisabled]}
            onPress={() => selectedSet && (fileInputRef.current as any)?.click()}
            disabled={!selectedSet}
          >
            <Text style={styles.uploadEmoji}>📖</Text>
            <Text style={styles.uploadTitle}>Upload Binder Photos</Text>
            <Text style={styles.uploadSub}>
              {selectedSet
                ? `Select one or more photos · ${gridPreset.rows}×${gridPreset.cols} grid per page`
                : "Select a set first"}
            </Text>
          </Pressable>
        )}

        {/* Results summary + cards */}
        {results.length > 0 && (
          <>
            <View style={styles.summaryRow}>
              <View style={[styles.summaryBadge, { backgroundColor: "rgba(34,197,94,0.15)", borderColor: GREEN }]}>
                <Text style={[styles.summaryBadgeText, { color: GREEN }]}>✓ {identifiedCards.length} identified</Text>
              </View>
              {reviewCards.length > 0 && (
                <View style={[styles.summaryBadge, { backgroundColor: "rgba(245,158,11,0.15)", borderColor: YELLOW }]}>
                  <Text style={[styles.summaryBadgeText, { color: YELLOW }]}>⚠ {reviewCards.length} need review</Text>
                </View>
              )}
              {!processing && (
                <Pressable style={styles.rescanBtn} onPress={() => setResults([])}>
                  <Text style={styles.rescanBtnText}>↺ New Scan</Text>
                </Pressable>
              )}
            </View>

            {/* Identified grid */}
            {identifiedCards.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Identified</Text>
                <View style={styles.cardGrid}>
                  {identifiedCards.map((r, i) => (
                    <View key={i} style={styles.cardCell}>
                      <View style={styles.cardCellInner}>
                        <img
                          src={r.thumbDataUrl}
                          style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 6 } as any}
                          alt=""
                        />
                        <Text style={styles.cardCellName} numberOfLines={2}>{r.card?.name ?? r.extractedName}</Text>
                        <Pressable style={styles.removeBtn} onPress={() => removeResult(r.index)}>
                          <Text style={styles.removeBtnText}>×</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* Review list */}
            {reviewCards.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Need Review</Text>
                {reviewCards.map((r, i) => (
                  <View key={i} style={styles.reviewItem}>
                    <img
                      src={r.thumbDataUrl}
                      style={{ width: 60, height: 44, objectFit: "cover", borderRadius: 6, flexShrink: 0 } as any}
                      alt=""
                    />
                    <View style={styles.reviewItemMid}>
                      <Text style={styles.reviewItemOcr} numberOfLines={1}>OCR: "{r.extractedName || "—"}"</Text>
                    </View>
                    <View style={styles.reviewItemActions}>
                      <Pressable
                        style={styles.fixBtn}
                        onPress={() => {
                          setReviewIdx(results.indexOf(r));
                          setReviewSearch(r.extractedName);
                          setReviewCandidates(r.candidates);
                        }}
                      >
                        <Text style={styles.fixBtnText}>Fix</Text>
                      </Pressable>
                      <Pressable style={styles.skipBtn} onPress={() => removeResult(r.index)}>
                        <Text style={styles.skipBtnText}>Skip</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Commit */}
            {identifiedCards.length > 0 && !processing && (
              <Pressable
                style={[styles.commitBtn, (!activeSession || committing) && styles.commitBtnDisabled]}
                onPress={handleCommit}
                disabled={!activeSession || committing}
              >
                {committing
                  ? <ActivityIndicator color="#0a0a0f" />
                  : <Text style={styles.commitBtnText}>
                      {activeSession
                        ? `✓ Add ${identifiedCards.length} Card${identifiedCards.length !== 1 ? "s" : ""} to "${activeSession.name}"`
                        : "⚠ No active session — go to Collection first"}
                    </Text>
                }
              </Pressable>
            )}
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

      {/* ── Fix card modal ── */}
      <Modal visible={reviewIdx !== null} animationType="slide" transparent onRequestClose={() => setReviewIdx(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Fix Card</Text>
              <Pressable onPress={() => { setReviewIdx(null); setReviewCandidates([]); }}>
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.reviewSearchRow}>
              <TextInput
                style={styles.reviewInput}
                value={reviewSearch}
                onChangeText={setReviewSearch}
                placeholder="Type card name…"
                placeholderTextColor="#606078"
                onSubmitEditing={() => handleReviewSearch(reviewSearch)}
                returnKeyType="search"
              />
              <Pressable style={styles.reviewSearchBtn} onPress={() => handleReviewSearch(reviewSearch)}>
                {reviewSearching
                  ? <ActivityIndicator color="#0a0a0f" size="small" />
                  : <Text style={styles.reviewSearchBtnText}>Search</Text>
                }
              </Pressable>
            </View>
            <ScrollView>
              {reviewCandidates.map(card => (
                <Pressable key={card.id} style={styles.reviewCandidate} onPress={() => applyReviewCard(card)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewCandidateName}>{card.name}</Text>
                    <Text style={styles.reviewCandidateMeta}>{card.set.toUpperCase()} #{card.collector_number}</Text>
                  </View>
                  <Text style={styles.reviewCandidateArrow}>→</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
  content:   { padding: 16, paddingBottom: 100 },

  // Crop overlay
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
  cropFooter: {
    padding: 16, borderTopWidth: 1, borderColor: "#222233", gap: 10,
  },
  cropHint:        { color: "#606078", fontSize: 12, textAlign: "center" },
  cropConfirmBtn:  { backgroundColor: ACCENT, borderRadius: 14, padding: 16, alignItems: "center" },
  cropConfirmText: { color: "#0a0a0f", fontWeight: "900", fontSize: 15 },

  // Config
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

  // Upload
  uploadBtn:        { alignItems: "center", padding: 48, borderRadius: 20, borderWidth: 2, borderColor: "#222233", borderStyle: "dashed", marginBottom: 24 },
  uploadBtnDisabled:{ opacity: 0.4 },
  uploadEmoji:      { fontSize: 48, marginBottom: 12 },
  uploadTitle:      { color: "#f0f0f8", fontSize: 20, fontWeight: "800", marginBottom: 6 },
  uploadSub:        { color: "#606078", fontSize: 14, textAlign: "center" },

  // Sticky progress
  stickyProgress: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "rgba(10,10,15,0.97)",
    borderTopWidth: 1, borderColor: "#222233",
    padding: 14, gap: 8, zIndex: 100,
  },
  stickyProgressRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stickyProgressText:{ color: "#a0a0b8", fontSize: 14, fontWeight: "600", flex: 1 },
  stickyBarBg:       { height: 4, backgroundColor: "#1a1a26", borderRadius: 2, overflow: "hidden" },
  stickyBarFill:     { height: "100%", backgroundColor: ACCENT, borderRadius: 2 },

  // Results
  summaryRow:        { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  summaryBadge:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  summaryBadgeText:  { fontWeight: "700", fontSize: 13 },
  rescanBtn:         { marginLeft: "auto" as any, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#333348" },
  rescanBtnText:     { color: "#a0a0b8", fontWeight: "700", fontSize: 13 },
  sectionLabel:      { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },

  cardGrid:         { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  cardCell:         { width: "30%" as any },
  cardCellInner:    { backgroundColor: "#12121a", borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#22c55e44" },
  cardCellName:     { color: "#f0f0f8", fontSize: 11, fontWeight: "600", padding: 6 },
  removeBtn:        { position: "absolute", top: 4, right: 4, backgroundColor: "rgba(239,68,68,0.85)", borderRadius: 10, width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  removeBtnText:    { color: "#fff", fontSize: 12, fontWeight: "900", lineHeight: 16 },

  reviewItem:       { flexDirection: "row", alignItems: "center", backgroundColor: "#12121a", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#f59e0b44", gap: 12 },
  reviewItemMid:    { flex: 1 },
  reviewItemOcr:    { color: "#a0a0b8", fontSize: 13 },
  reviewItemActions:{ flexDirection: "row", gap: 8 },
  fixBtn:           { backgroundColor: ACCENT, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  fixBtnText:       { color: "#0a0a0f", fontWeight: "800", fontSize: 13 },
  skipBtn:          { backgroundColor: "#1a1a26", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#333348" },
  skipBtnText:      { color: "#606078", fontWeight: "700", fontSize: 13 },

  commitBtn:         { backgroundColor: ACCENT, borderRadius: 16, padding: 18, alignItems: "center", marginTop: 8 },
  commitBtnDisabled: { opacity: 0.4 },
  commitBtnText:     { color: "#0a0a0f", fontWeight: "900", fontSize: 16 },

  // Fix modal
  modalBg:     { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalSheet:  { backgroundColor: "#0a0a0f", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", borderTopWidth: 1, borderColor: "#222233", padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle:  { color: "#f0f0f8", fontSize: 18, fontWeight: "800" },
  modalClose:  { color: "#606078", fontSize: 22 },
  reviewSearchRow:      { flexDirection: "row", gap: 8, marginBottom: 16 },
  reviewInput:          { flex: 1, backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#222233" },
  reviewSearchBtn:      { backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
  reviewSearchBtnText:  { color: "#0a0a0f", fontWeight: "800", fontSize: 14 },
  reviewCandidate:      { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderColor: "#111120" },
  reviewCandidateName:  { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  reviewCandidateMeta:  { color: "#606078", fontSize: 12, marginTop: 2 },
  reviewCandidateArrow: { color: ACCENT, fontSize: 18, paddingLeft: 12 },

  // Set picker
  pickerContainer: { flex: 1, backgroundColor: "#0a0a0f" },
  pickerHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderColor: "#222233" },
  pickerTitle:     { color: "#f0f0f8", fontSize: 20, fontWeight: "800" },
  pickerClose:     { color: "#606078", fontSize: 22, padding: 4 },
  pickerSearch:    { margin: 16, backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#222233" },
  pickerItem:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: "#111120" },
  pickerItemName:  { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  pickerItemMeta:  { color: "#606078", fontSize: 12, marginTop: 2 },
});
