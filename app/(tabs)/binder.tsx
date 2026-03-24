import { useState, useRef, useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet,
  ActivityIndicator, TextInput, Modal,
} from "react-native";
import { router } from "expo-router";
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

const ACCENT = "#c89b3c";
const GREEN = "#22c55e";
const RED = "#ef4444";
const YELLOW = "#f59e0b";

const GRID_PRESETS = [
  { label: "2×2", rows: 2, cols: 2 },
  { label: "3×3", rows: 3, cols: 3 },
  { label: "4×3", rows: 4, cols: 3 },
  { label: "4×4", rows: 4, cols: 4 },
];

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
  const collapsed = text.replace(/\n+/g, " ");
  return collapsed.replace(/[^a-zA-Z\s'\-]/g, " ").replace(/\s\s+/g, " ").trim();
}

export default function BinderScreen() {
  const { activeSession } = useAppStore();

  const [setList, setSetList] = useState<ScryfallSet[]>([]);
  const [selectedSet, setSelectedSet] = useState<{ code: string; name: string } | null>(null);
  const [setFilter, setSetFilter] = useState("");
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setCards, setSetCards] = useState<ScryfallCard[]>([]);

  const [gridPreset, setGridPreset] = useState(GRID_PRESETS[1]);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<ScanResult[]>([]);

  const [reviewIdx, setReviewIdx] = useState<number | null>(null);
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewCandidates, setReviewCandidates] = useState<ScryfallCard[]>([]);
  const [reviewSearching, setReviewSearching] = useState(false);
  const [committing, setCommitting] = useState(false);

  const workerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSetsLoading(true);
    fetchMtgSets().then(setSetList).catch(console.error).finally(() => setSetsLoading(false));
  }, []);

  useEffect(() => {
    if (selectedSet) fetchCardsBySet(selectedSet.code).then(setSetCards).catch(console.error);
  }, [selectedSet]);

  useEffect(() => {
    let active = true;
    Tesseract.createWorker("eng").then(async worker => {
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,",
      });
      if (active) workerRef.current = worker;
    });
    return () => { active = false; workerRef.current?.terminate(); };
  }, []);

  const filteredSets = setFilter.trim()
    ? setList.filter(s =>
        s.name.toLowerCase().includes(setFilter.toLowerCase()) ||
        s.code.toLowerCase().includes(setFilter.toLowerCase())
      )
    : setList;

  const processCell = async (
    img: HTMLImageElement,
    row: number, col: number,
    rows: number, cols: number,
    index: number,
  ): Promise<ScanResult> => {
    const cellW = img.naturalWidth / cols;
    const cellH = img.naturalHeight / rows;
    const cellX = col * cellW;
    const cellY = row * cellH;

    // Full cell thumbnail
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = Math.round(cellW);
    thumbCanvas.height = Math.round(cellH);
    thumbCanvas.getContext("2d")!.drawImage(img, cellX, cellY, cellW, cellH, 0, 0, cellW, cellH);
    const thumbDataUrl = thumbCanvas.toDataURL("image/jpeg", 0.5);

    // Title strip: top ~16% of cell, inset 8% left and 10% right
    const stripX = cellX + cellW * 0.08;
    const stripY = cellY + cellH * 0.02;
    const stripW = cellW * 0.82;
    const stripH = cellH * 0.16;

    // OCR canvas — 2× upscale + contrast
    const ocrCanvas = document.createElement("canvas");
    ocrCanvas.width = Math.round(stripW * 2);
    ocrCanvas.height = Math.round(stripH * 2);
    const ctx = ocrCanvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, stripX, stripY, stripW, stripH, 0, 0, ocrCanvas.width, ocrCanvas.height);
    const id = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
    for (let i = 0; i < id.data.length; i += 4) {
      const g = 0.299 * id.data[i] + 0.587 * id.data[i+1] + 0.114 * id.data[i+2];
      const v = Math.max(0, Math.min(255, 2.0 * (g - 128) + 128));
      id.data[i] = id.data[i+1] = id.data[i+2] = v;
    }
    ctx.putImageData(id, 0, 0);

    let rawOcr = "";
    let extractedName = "";
    try {
      const { data: { text } } = await workerRef.current.recognize(ocrCanvas.toDataURL("image/jpeg", 0.95));
      rawOcr = text;
      extractedName = extractName(text);
    } catch { /* skip blank cells */ }

    if (!extractedName || extractedName.length < 3) {
      return { index, thumbDataUrl, rawOcr, extractedName, status: "empty", card: null, candidates: [], reviewName: "" };
    }

    const sanitized = extractedName.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    let card: ScryfallCard | null = null;
    let candidates: ScryfallCard[] = [];

    // Local fuzzy
    if (setCards.length > 0) {
      const local = setCards
        .map(c => ({ card: c, score: similarity(sanitized, c.name) }))
        .filter(m => m.score > 0.4)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      if (local.length > 0 && local[0].score > 0.85) {
        card = local[0].card;
        candidates = local.map(m => m.card);
      }
    }

    // Autocomplete spell-check
    if (!card) {
      try {
        const sugg = await autocompleteCardName(sanitized);
        if (sugg[0]) {
          const res = await searchCardByNameInSet(sugg[0], selectedSet!.code);
          if (res.length > 0) { card = res[0]; candidates = res; }
        }
      } catch { /* non-fatal */ }
    }

    // Direct search
    if (!card) {
      try {
        const res = await searchCardByNameInSet(sanitized, selectedSet!.code);
        if (res.length > 0) { card = res[0]; candidates = res; }
      } catch { /* non-fatal */ }
    }

    return {
      index, thumbDataUrl, rawOcr, extractedName,
      status: card ? "identified" : "review",
      card, candidates,
      reviewName: extractedName,
    };
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || !files.length || !selectedSet || !workerRef.current) return;
    const { rows, cols } = gridPreset;
    const total = files.length * rows * cols;
    setProcessing(true);
    setResults([]);
    setProgress({ current: 0, total });

    const allResults: ScanResult[] = [];
    let current = 0;

    for (let f = 0; f < files.length; f++) {
      const dataUrl = await new Promise<string>(res => {
        const reader = new FileReader();
        reader.onload = e => res(e.target!.result as string);
        reader.readAsDataURL(files[f]);
      });
      const img = await new Promise<HTMLImageElement>(res => {
        const el = new window.Image();
        el.onload = () => res(el);
        el.src = dataUrl;
      });

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = f * rows * cols + row * cols + col;
          const result = await processCell(img, row, col, rows, cols, idx);
          allResults.push(result);
          current++;
          setProgress({ current, total });
          setResults([...allResults]);
        }
      }
    }
    setProcessing(false);
  };

  const handleReviewSearch = async (query: string) => {
    if (!query.trim() || !selectedSet) return;
    setReviewSearching(true);
    try {
      const sugg = await autocompleteCardName(query);
      if (sugg[0]) {
        const res = await searchCardByNameInSet(sugg[0], selectedSet.code);
        setReviewCandidates(res.slice(0, 8));
      } else {
        const res = await searchCardByNameInSet(query, selectedSet.code);
        setReviewCandidates(res.slice(0, 8));
      }
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

  const removeResult = (index: number) => {
    setResults(prev => prev.filter((_, i) => i !== index));
  };

  const identifiedCards = results.filter(r => r.status === "identified" && r.card);
  const reviewCards = results.filter(r => r.status === "review");

  const handleCommit = async () => {
    if (!activeSession || identifiedCards.length === 0 || committing) return;
    setCommitting(true);
    try {
      await bulkAddCards(identifiedCards.map(r => {
        const norm = normalizeScryfallCard(r.card!);
        return {
          sessionId: activeSession.id,
          scryfallId: norm.scryfallId,
          name: norm.name,
          setCode: norm.setCode,
          setName: norm.setName,
          collectorNumber: norm.collectorNumber,
          rarity: norm.rarity,
          colors: norm.colors,
          isFoil: false,
          condition: "NM" as const,
          quantity: 1,
          priceUsd: norm.priceUsd,
          priceUsdFoil: norm.priceUsdFoil,
          imageUri: norm.imageUri,
          scryfallUri: norm.scryfallUri,
        };
      }));
      setResults([]);
      alert(`✓ ${identifiedCards.length} card${identifiedCards.length !== 1 ? "s" : ""} added to "${activeSession.name}"`);
    } catch (e) {
      alert("Failed to save cards. Please try again.");
    } finally {
      setCommitting(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef as any}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={e => handleFilesSelected(e.target.files)}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Config row */}
        <View style={styles.configCard}>
          {/* Set picker */}
          <Pressable style={styles.setBtn} onPress={() => setSetPickerOpen(true)}>
            <Text style={styles.setBtnLabel}>Set</Text>
            <Text style={styles.setBtnValue} numberOfLines={1}>
              {selectedSet ? `${selectedSet.name} (${selectedSet.code.toUpperCase()})` : "Tap to select…"}
            </Text>
          </Pressable>

          {/* Grid size */}
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

        {/* Progress */}
        {processing && (
          <View style={styles.progressCard}>
            <ActivityIndicator color={ACCENT} size="large" />
            <Text style={styles.progressText}>
              Scanning card {progress.current} of {progress.total}…
            </Text>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, {
                width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` as any
              }]} />
            </View>
          </View>
        )}

        {/* Results summary */}
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
              <Pressable style={styles.rescanBtn} onPress={() => { setResults([]); }}>
                <Text style={styles.rescanBtnText}>↺ New Scan</Text>
              </Pressable>
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

            {/* Review needed list */}
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
                      <Text style={styles.reviewItemOcr} numberOfLines={1}>
                        OCR: "{r.extractedName || "—"}"
                      </Text>
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
            {identifiedCards.length > 0 && (
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

      {/* Review modal */}
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
                    <Text style={styles.reviewCandidateMeta}>
                      {card.set.toUpperCase()} #{card.collector_number}
                    </Text>
                  </View>
                  <Text style={styles.reviewCandidateArrow}>→</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Set picker modal */}
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
                    onPress={() => {
                      setSelectedSet({ code: s.code, name: s.name });
                      setSetFilter("");
                      setSetPickerOpen(false);
                    }}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0f" },
  content: { padding: 16, paddingBottom: 60 },

  configCard: { backgroundColor: "#12121a", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#222233" },
  setBtn: { marginBottom: 14 },
  setBtnLabel: { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  setBtnValue: { color: ACCENT, fontSize: 16, fontWeight: "700" },
  gridRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  gridLabel: { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, width: 32 },
  gridBtns: { flexDirection: "row", gap: 8, flex: 1 },
  gridBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#222233" },
  gridBtnActive: { backgroundColor: ACCENT, borderColor: ACCENT },
  gridBtnText: { color: "#a0a0b8", fontWeight: "700", fontSize: 13 },
  gridBtnTextActive: { color: "#0a0a0f" },

  uploadBtn: { alignItems: "center", padding: 48, borderRadius: 20, borderWidth: 2, borderColor: "#222233", borderStyle: "dashed", marginBottom: 24 },
  uploadBtnDisabled: { opacity: 0.4 },
  uploadEmoji: { fontSize: 48, marginBottom: 12 },
  uploadTitle: { color: "#f0f0f8", fontSize: 20, fontWeight: "800", marginBottom: 6 },
  uploadSub: { color: "#606078", fontSize: 14, textAlign: "center" },

  progressCard: { alignItems: "center", padding: 40, gap: 16 },
  progressText: { color: "#a0a0b8", fontSize: 15, fontWeight: "600" },
  progressBarBg: { width: "100%", height: 6, backgroundColor: "#1a1a26", borderRadius: 3, overflow: "hidden" },
  progressBarFill: { height: "100%", backgroundColor: ACCENT, borderRadius: 3 },

  summaryRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  summaryBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  summaryBadgeText: { fontWeight: "700", fontSize: 13 },
  rescanBtn: { marginLeft: "auto" as any, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, backgroundColor: "#1a1a26", borderWidth: 1, borderColor: "#333348" },
  rescanBtnText: { color: "#a0a0b8", fontWeight: "700", fontSize: 13 },

  sectionLabel: { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 },

  cardGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 },
  cardCell: { width: "30%" as any },
  cardCellInner: { backgroundColor: "#12121a", borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: "#22c55e44" },
  cardCellName: { color: "#f0f0f8", fontSize: 11, fontWeight: "600", padding: 6 },
  removeBtn: { position: "absolute", top: 4, right: 4, backgroundColor: "rgba(239,68,68,0.85)", borderRadius: 10, width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  removeBtnText: { color: "#fff", fontSize: 12, fontWeight: "900", lineHeight: 16 },

  reviewItem: { flexDirection: "row", alignItems: "center", backgroundColor: "#12121a", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: "#f59e0b44", gap: 12 },
  reviewItemMid: { flex: 1 },
  reviewItemOcr: { color: "#a0a0b8", fontSize: 13 },
  reviewItemActions: { flexDirection: "row", gap: 8 },
  fixBtn: { backgroundColor: ACCENT, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  fixBtnText: { color: "#0a0a0f", fontWeight: "800", fontSize: 13 },
  skipBtn: { backgroundColor: "#1a1a26", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#333348" },
  skipBtnText: { color: "#606078", fontWeight: "700", fontSize: 13 },

  commitBtn: { backgroundColor: ACCENT, borderRadius: 16, padding: 18, alignItems: "center", marginTop: 8 },
  commitBtnDisabled: { opacity: 0.4 },
  commitBtnText: { color: "#0a0a0f", fontWeight: "900", fontSize: 16 },

  // Review modal
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#0a0a0f", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", borderTopWidth: 1, borderColor: "#222233", padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { color: "#f0f0f8", fontSize: 18, fontWeight: "800" },
  modalClose: { color: "#606078", fontSize: 22 },
  reviewSearchRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  reviewInput: { flex: 1, backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#222233" },
  reviewSearchBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
  reviewSearchBtnText: { color: "#0a0a0f", fontWeight: "800", fontSize: 14 },
  reviewCandidate: { flexDirection: "row", alignItems: "center", padding: 14, borderBottomWidth: 1, borderColor: "#111120" },
  reviewCandidateName: { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  reviewCandidateMeta: { color: "#606078", fontSize: 12, marginTop: 2 },
  reviewCandidateArrow: { color: ACCENT, fontSize: 18, paddingLeft: 12 },

  // Set picker modal
  pickerContainer: { flex: 1, backgroundColor: "#0a0a0f" },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderColor: "#222233" },
  pickerTitle: { color: "#f0f0f8", fontSize: 20, fontWeight: "800" },
  pickerClose: { color: "#606078", fontSize: 22, padding: 4 },
  pickerSearch: { margin: 16, backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#222233" },
  pickerItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: "#111120" },
  pickerItemName: { color: "#f0f0f8", fontSize: 15, fontWeight: "600" },
  pickerItemMeta: { color: "#606078", fontSize: 12, marginTop: 2 },
});
