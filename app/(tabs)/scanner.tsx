import { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
  ActivityIndicator,
  Dimensions,
  Modal,
  ScrollView,
  TextInput,
  Image,
  Animated,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useAppStore } from "@store/appStore";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CARD_RATIO = 63 / 88;
const CARD_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 450);
const CARD_HEIGHT = CARD_WIDTH / CARD_RATIO;
const TITLE_HEIGHT = CARD_HEIGHT * 0.15;
// Platform constant — safe at module level; never changes at runtime
const isWeb = Platform.OS === "web";

import { searchCardByNameInSet, fetchMtgSets, normalizeScryfallCard, getCardBySetAndNumber, fetchCardsBySet, autocompleteCardName } from "@api/scryfall";
import type { ScryfallCard } from "@mtgtypes/index";
import type { ScryfallSet } from "@api/scryfall";
import { bulkAddCards } from "@db/queries";
import Tesseract from "tesseract.js";
import * as ImageManipulator from "expo-image-manipulator";

// Regex patterns for OCR text extraction (used for future set code detection)
const COLLECTOR_PATTERN = /(\d{1,4})\s*\/\s*(\d{1,4})/;
const SET_CODE_PATTERN = /\b([A-Z]{3,5})\b/;

// ── Pokemon TCG types ────────────────────────────────────────────────────────
interface PokemonSet {
  id: string;
  name: string;
  total: number;
  releaseDate: string;
}

interface PokemonCard {
  id: string;
  name: string;
  set: { id: string; name: string };
  number: string;
  rarity?: string;
  images: { small: string; large: string };
  tcgplayer?: {
    prices?: {
      normal?: { market?: number };
      holofoil?: { market?: number };
      reverseHolofoil?: { market?: number };
    };
  };
}

async function fetchPokemonSets(): Promise<PokemonSet[]> {
  const res = await fetch("https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=250");
  const json = await res.json();
  return (json.data ?? []) as PokemonSet[];
}

async function searchPokemonCards(name: string, setId: string): Promise<PokemonCard[]> {
  const q = `name:"${name}" set.id:${setId}`;
  const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}`);
  const json = await res.json();
  return (json.data ?? []) as PokemonCard[];
}

function mapPokemonRarity(rarity?: string): "common" | "uncommon" | "rare" | "mythic" {
  if (!rarity) return "common";
  const r = rarity.toLowerCase();
  if (r.includes("ultra rare") || r.includes("secret") || r.includes("rainbow") || r.includes("amazing")) return "mythic";
  if (r.includes("rare")) return "rare";
  if (r.includes("uncommon")) return "uncommon";
  return "common";
}

function adaptPokemonCard(card: PokemonCard): QueuedCard {
  const prices = card.tcgplayer?.prices;
  const priceUsd = prices?.normal?.market ?? null;
  const priceUsdFoil = prices?.holofoil?.market ?? prices?.reverseHolofoil?.market ?? null;
  return {
    localId: `${card.id}-${Date.now()}`,
    scryfallId: card.id,
    name: card.name,
    setCode: card.set.id,
    setName: card.set.name,
    collectorNumber: card.number,
    rarity: mapPokemonRarity(card.rarity),
    colors: [],
    thumbUri: card.images?.small ?? null,
    imageUri: card.images?.large ?? null,
    scryfallUri: null,
    priceUsd,
    priceUsdFoil,
  };
}

// ── Unified card display helpers (MTG + Pokemon) ─────────────────────────────
function getAnyCardThumb(card: any, isPokemon: boolean): string | null {
  if (isPokemon) return (card as PokemonCard).images?.small ?? null;
  return getSmallImageUri(card as ScryfallCard);
}

function getAnyCardMeta(card: any, isPokemon: boolean): string {
  if (isPokemon) {
    const c = card as PokemonCard;
    return `${c.set?.name ?? ""} · #${c.number}`;
  }
  const c = card as ScryfallCard;
  return `${c.mana_cost ? `${c.mana_cost}  ·  ` : ""}${c.set?.toUpperCase?.() ?? ""} #${c.collector_number}`;
}

function getAnyCardSubLine(card: any, isPokemon: boolean): string {
  if (isPokemon) return (card as PokemonCard).rarity ?? "";
  return (card as ScryfallCard).type_line ?? "";
}

function getAnyCardPrice(card: any, isPokemon: boolean): string | null {
  if (isPokemon) {
    const prices = (card as PokemonCard).tcgplayer?.prices;
    const market = prices?.normal?.market ?? prices?.holofoil?.market ?? prices?.reverseHolofoil?.market;
    return market != null ? `$${market.toFixed(2)}` : null;
  }
  const usd = (card as ScryfallCard).prices?.usd;
  return usd ? `$${parseFloat(usd).toFixed(2)}` : null;
}

interface QueuedCard {
  localId: string;
  scryfallId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: "common" | "uncommon" | "rare" | "mythic";
  colors: string[];
  thumbUri: string | null;
  imageUri: string | null;
  scryfallUri: string | null;
  priceUsd: number | null;
  priceUsdFoil: number | null;
}

interface ReviewNeededItem {
  localId: string;
  ocrText: string;
  candidates: ScryfallCard[];
}

function extractCardInfo(text: string): { name: string; collectorNumber?: string } | null {
  // Collapse newlines to spaces first — PSM.SINGLE_LINE still emits \n between words sometimes
  const collapsed = text.replace(/\n+/g, " ");
  // Strip all non-letter characters except spaces, hyphens, apostrophes
  const cleanedText = collapsed.replace(/[^a-zA-Z\s'\-]/g, " ").replace(/\s\s+/g, " ").trim();
  const lines = cleanedText.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);
  
  if (lines.length === 0) return null;

  let collectorNumber: string | undefined;
  for (const line of lines) {
    const match = line.match(COLLECTOR_PATTERN);
    if (match) {
      collectorNumber = match[1];
      break;
    }
  }

  // Find the likely card name
  // Strategy: The first line that is mostly letters and not metadata
  const nameLine = lines.find(line => 
    !COLLECTOR_PATTERN.test(line) && 
    /[a-zA-Z]{3,}/.test(line) &&
    !SET_CODE_PATTERN.test(line)
  );

  const finalName = nameLine || lines[0];

  // Final cleanup of the name to remove stray mana symbols or weird characters
  // Leave spaces, hyphens and apostrophes (e.g. "Sage's Nouliths")
  return { 
    name: finalName ? finalName.replace(/[^a-zA-Z\s'-]/g, "").trim() : "", 
    collectorNumber 
  };
}

function getSmallImageUri(card: ScryfallCard): string | null {
  if (card.image_uris?.small) return card.image_uris.small;
  if (card.card_faces?.[0]?.image_uris?.small) return card.card_faces[0].image_uris.small;
  return null;
}

function sanitizeOcrText(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function stringSimilarity(a: string, b: string): number {
  const aL = a.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const bL = b.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

  // Levenshtein over the longer string
  const dist = levenshteinDistance(aL, bL);
  const maxLen = Math.max(aL.length, bL.length);
  const levScore = maxLen === 0 ? 1 : 1 - dist / maxLen;

  // Prefix boost: OCR often reads a truncated version of a long name.
  // If every word in the OCR text appears as a prefix-sequence in the card name, score higher.
  const aWords = aL.split(" ").filter(Boolean);
  const bWords = bL.split(" ").filter(Boolean);
  const prefixMatchCount = aWords.filter((w, i) => bWords[i]?.startsWith(w) || bWords[i] === w).length;
  const prefixScore = aWords.length > 0 ? prefixMatchCount / Math.max(aWords.length, bWords.length) : 0;

  return Math.max(levScore, prefixScore);
}

export default function ScannerScreen() {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [webPermissionGranted, setWebPermissionGranted] = useState(false);
  const [webPermissionDenied, setWebPermissionDenied] = useState(false);
  const [isSecureContext, setIsSecureContext] = useState(true);
  const [webChecking, setWebChecking] = useState(Platform.OS === "web");

  const { activeSession, setPendingCard, isPokemonUser, setIsPokemonUser } = useAppStore();
  const [scanning, setScanning] = useState(false);
  const isMounted = useRef(true);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoScan, setAutoScan] = useState(false);

  // Scan mode
  const [scanMode, setScanMode] = useState<"single" | "rapid">("single");

  // Set selection
  const [selectedSet, setSelectedSet] = useState<{ code: string; name: string } | null>(null);
  const [setList, setSetList] = useState<ScryfallSet[]>([]);
  const [pokemonSetList, setPokemonSetList] = useState<PokemonSet[]>([]);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [setFilter, setSetFilter] = useState("");
  const [recentSetCodes, setRecentSetCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("recentSets") ?? "[]"); } catch { return []; }
  });

  // Single-mode result picker modal
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultCandidates, setResultCandidates] = useState<ScryfallCard[]>([]);
  const [noTextCount, setNoTextCount] = useState(0);
  const [debugImage, setDebugImage] = useState<string | null>(null);
  const [setCards, setSetCards] = useState<ScryfallCard[]>([]);

  const workerRef = useRef<any>(null);

  // Initialize OCR worker once
  useEffect(() => {
    let active = true;
    const setup = async () => {
      try {
        const worker = await Tesseract.createWorker("eng");
        // PSM 7 = single text line. Whitelist prevents symbol noise ({~|-) from card frame icons.
        await worker.setParameters({
          tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,",
        });
        if (active) workerRef.current = worker;
      } catch (err) {
        console.error("Worker init failed:", err);
      }
    };
    setup();
    return () => {
      active = false;
      isMounted.current = false;
      workerRef.current?.terminate();
    };
  }, []);

  // Rapid mode queue
  const [rapidQueue, setRapidQueue] = useState<QueuedCard[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);

  // Non-blocking review queue (Feature 2)
  const [needsReview, setNeedsReview] = useState<ReviewNeededItem[]>([]);
  const [reviewingItem, setReviewingItem] = useState<ReviewNeededItem | null>(null);

  // Auto-capture (Feature 3)
  const [autoCaptureActive, setAutoCaptureActive] = useState(false);

  // Debugging state
  const [lastOcrFull, setLastOcrFull] = useState<string | null>(null);
  const [lastOcrExtracted, setLastOcrExtracted] = useState<{name: string, collector?: string} | null>(null);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Review Scan modal (rapid mode fallback)
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewEditText, setReviewEditText] = useState("");
  const [reviewResults, setReviewResults] = useState<ScryfallCard[]>([]);
  const [reviewSearching, setReviewSearching] = useState(false);

  // Success flash animation
  const flashAnim = useRef(new Animated.Value(0)).current;
  // Auto-capture countdown progress (0 → 1 over 1.5 s)
  const countdownAnim = useRef(new Animated.Value(0)).current;

  const cooldownRef = useRef(false);
  const cameraRef = useRef<CameraView>(null);
  const videoRef = useRef<any>(null);
  const guideRef = useRef<View>(null);
  const canvasRef = useRef<any>(null);
  // Stability detection refs (Feature 3)
  const prevPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const stableFramesRef = useRef(0);
  // Always-current ref to captureManual so effects avoid stale closures
  const captureManualRef = useRef<(silent?: boolean) => Promise<boolean>>(async () => false);

  // Fetch set list — branches on isPokemonUser; reset selected set when mode flips
  useEffect(() => {
    setSelectedSet(null);
    setSetsLoading(true);
    if (isPokemonUser) {
      fetchPokemonSets()
        .then(sets => setPokemonSetList(sets))
        .catch(console.error)
        .finally(() => setSetsLoading(false));
    } else {
      fetchMtgSets()
        .then(sets => setSetList(sets))
        .catch(console.error)
        .finally(() => setSetsLoading(false));
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [isPokemonUser]);

  useEffect(() => {
    if (Platform.OS === "web") {
      setIsSecureContext(window.isSecureContext);
      setWebChecking(false);
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2200);
  }, []);

  const triggerSuccessFlash = useCallback(() => {
    flashAnim.setValue(0.35);
    Animated.timing(flashAnim, { toValue: 0, duration: 700, useNativeDriver: true }).start();
  }, [flashAnim]);

  const requestWebPermission = async () => {
    if (Platform.OS === "web" && !isSecureContext) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      // Stop temporary stream used for prompting
      stream.getTracks().forEach(track => track.stop());
      
      setWebPermissionGranted(true);
      setWebPermissionDenied(false);
    } catch (err) {
      console.error("Web camera permission denied", err);
      setWebPermissionDenied(true);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setScanning(true);
      // Clear result panel every time the scanner re-focuses so returning from
      // the confirm screen doesn't leave stale candidates visible.
      setResultModalVisible(false);
      setResultCandidates([]);
      setLastScanned(null);
      cooldownRef.current = false;
      return () => {
        setScanning(false);
      };
    }, [])
  );

  useEffect(() => {
    let activeStream: MediaStream | null = null;

    if (Platform.OS === "web" && webPermissionGranted && scanning && selectedSet) {
      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          advanced: [{ focusMode: "continuous" } as any]
        }
      }).then(stream => {
        activeStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        } else {
          // If unmounted before promise resolved
          stream.getTracks().forEach(t => t.stop());
        }
      }).catch(err => {
        console.error(err);
        setWebPermissionDenied(true);
        setWebPermissionGranted(false);
      });
    }

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
      }
      if (Platform.OS === "web" && videoRef.current) {
        if (videoRef.current.srcObject) {
          videoRef.current.srcObject.getTracks().forEach((t: any) => t.stop());
          videoRef.current.srcObject = null;
        }
      }
    };
  }, [webPermissionGranted, scanning, selectedSet]);

  // Fetch card list for the selected set for local fuzzy matching
  useEffect(() => {
    if (selectedSet) {
      fetchCardsBySet(selectedSet.code).then(setSetCards).catch(e => console.error("Cache failed:", e));
    }
  }, [selectedSet]);

  const handleOcrResult = useCallback(
    async (recognizedText: string) => {
      if (cooldownRef.current) return;
      if (!activeSession) {
        router.push("/session/new");
        return;
      }
      if (!selectedSet) return;

      const info = extractCardInfo(recognizedText);
      setLastOcrExtracted(info);
      if (!info) return;

      // Sanitize: strip non-alphanumeric chars before searching
      let sanitizedName = info.name ? sanitizeOcrText(info.name) : "";
      if (!sanitizedName && !info.collectorNumber) return;
      
      const scanKey = info.collectorNumber ? `${sanitizedName}-${info.collectorNumber}` : sanitizedName;
      if (scanKey === lastScanned) return;

      cooldownRef.current = true;
      setLastScanned(scanKey);

      try {
        let results: ScryfallCard[] = [];

        // 1. Try name search FIRST (as requested)
        if (sanitizedName) {
          // A. Try LOCAL fuzzy match first for speed & resilience
          let localMatches: { card: ScryfallCard; score: number }[] = [];
          if (setCards.length > 0) {
            localMatches = setCards
              .map(c => ({ card: c, score: stringSimilarity(sanitizedName, c.name) }))
              .filter(m => m.score > 0.4)
              .sort((a, b) => b.score - a.score)
              .slice(0, 8);

            if (localMatches.length > 0 && localMatches[0].score > 0.85) {
              console.log("Local Fuzzy WIN:", localMatches[0].card.name, "score:", localMatches[0].score);
              results = [localMatches[0].card];
            }
          }

          // B. Use Scryfall autocomplete as a spell-checker for the OCR name,
          //    then search the corrected name in the set.
          if (results.length === 0) {
            try {
              const suggestions = await autocompleteCardName(sanitizedName);
              const corrected = suggestions[0];
              if (corrected && corrected.toLowerCase() !== sanitizedName.toLowerCase()) {
                console.log("Autocomplete correction:", sanitizedName, "→", corrected);
                results = await searchCardByNameInSet(corrected, selectedSet.code);
              }
            } catch { /* non-fatal */ }
          }

          // C. Direct Scryfall search with the original sanitized name
          if (results.length === 0) {
            results = await searchCardByNameInSet(sanitizedName, selectedSet.code);
          }

          // D. If Scryfall also returned nothing, surface local candidates so the
          //    user can still pick the right card rather than seeing "No match"
          if (results.length === 0 && localMatches.length > 0) {
            console.log("Falling back to local candidates:", localMatches.map(m => m.card.name));
            results = localMatches.map(m => m.card);
          }
        }

        // 2. Fallback to exact match by collector number if name search fails
        if (results.length === 0 && info.collectorNumber) {
          const exactCard = await getCardBySetAndNumber(selectedSet.code, info.collectorNumber);
          if (exactCard) results = [exactCard];
        }

        if (scanMode === "rapid") {
          if (results.length === 0) {
            // No match → push to non-blocking review queue instead of opening a modal
            setNeedsReview(prev => [
              ...prev,
              { localId: `review-${Date.now()}`, ocrText: sanitizedName, candidates: [] },
            ]);
            showToast("No match found — flagged for review");
            return;
          }

          const top = results[0];
          const similarity = stringSimilarity(sanitizedName, top.name);

          if (similarity >= 0.7) {
            // High confidence → auto-enqueue
            const norm = normalizeScryfallCard(top);
            const queued: QueuedCard = {
              localId: `${top.id}-${Date.now()}`,
              scryfallId: norm.scryfallId,
              name: norm.name,
              setCode: norm.setCode,
              setName: norm.setName,
              collectorNumber: norm.collectorNumber,
              rarity: norm.rarity,
              colors: norm.colors,
              thumbUri: getSmallImageUri(top),
              imageUri: norm.imageUri,
              scryfallUri: norm.scryfallUri,
              priceUsd: norm.priceUsd,
              priceUsdFoil: norm.priceUsdFoil,
            };
            setRapidQueue(prev => [queued, ...prev]);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            triggerSuccessFlash();
          } else {
            // Low confidence → push to review queue, camera keeps rolling
            setNeedsReview(prev => [
              ...prev,
              { localId: `review-${Date.now()}`, ocrText: sanitizedName, candidates: results },
            ]);
            showToast("Low confidence — flagged for review");
          }
        } else {
          // Single mode: show result picker
          if (results.length === 0) {
            showToast("No match in set — try again");
            return;
          }
          // Only stop auto-scan on native devices; keep it running on web side-panel
          if (autoScan && !isWeb) setAutoScan(false);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setResultCandidates(results);
          setResultModalVisible(true);
        }
      } catch (e) {
        console.error("Scryfall search error:", e);
        if (scanMode === "rapid") showToast("Scan error — try again");
      } finally {
        setTimeout(() => { cooldownRef.current = false; }, 3000);
      }
    },
    [activeSession, lastScanned, autoScan, selectedSet, scanMode, showToast, triggerSuccessFlash]
  );

  const handleResultSelect = useCallback(async (tappedCard: ScryfallCard) => {
    setResultModalVisible(false);
    // Snapshot candidates before clearing them for the navigation params
    const snapshot = resultCandidates;
    setResultCandidates([]);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingCard(null);
    // Put tapped card first so confirm screen shows it selected by default
    const reordered = [tappedCard, ...snapshot.filter(c => c.id !== tappedCard.id)];
    router.push({
      pathname: "/confirm",
      params: { candidates: JSON.stringify(reordered), sessionId: activeSession?.id ?? "" },
    });
  }, [resultCandidates, activeSession, setPendingCard]);

  const handleReviewSearch = useCallback(async (text: string) => {
    if (!selectedSet || !text.trim()) return;
    setReviewSearching(true);
    try {
      const results = await searchCardByNameInSet(text.trim(), selectedSet.code);
      setReviewResults(results);
    } catch {
      setReviewResults([]);
    } finally {
      setReviewSearching(false);
    }
  }, [selectedSet]);

  // Open the review modal for a flagged item in the review queue
  const openReviewItem = useCallback((item: ReviewNeededItem) => {
    setReviewingItem(item);
    setReviewEditText(item.ocrText);
    setReviewResults(item.candidates);
    setReviewModalVisible(true);
  }, []);

  const handleReviewSelect = useCallback(async (card: ScryfallCard) => {
    setReviewModalVisible(false);
    const norm = normalizeScryfallCard(card);
    const queued: QueuedCard = {
      localId: `${card.id}-${Date.now()}`,
      scryfallId: norm.scryfallId,
      name: norm.name,
      setCode: norm.setCode,
      setName: norm.setName,
      collectorNumber: norm.collectorNumber,
      rarity: norm.rarity,
      colors: norm.colors,
      thumbUri: getSmallImageUri(card),
      imageUri: norm.imageUri,
      scryfallUri: norm.scryfallUri,
      priceUsd: norm.priceUsd,
      priceUsdFoil: norm.priceUsdFoil,
    };
    // If resolving a flagged review item, remove it from the review queue
    if (reviewingItem) {
      setNeedsReview(prev => prev.filter(r => r.localId !== reviewingItem.localId));
      setReviewingItem(null);
    }
    setRapidQueue(prev => [queued, ...prev]);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    triggerSuccessFlash();
  }, [reviewingItem, triggerSuccessFlash]);

  const commitBatch = async () => {
    if (rapidQueue.length === 0 || !activeSession || isCommitting) return;
    setIsCommitting(true);
    const count = rapidQueue.length;
    try {
      await bulkAddCards(rapidQueue.map(c => ({
        sessionId: activeSession.id,
        scryfallId: c.scryfallId,
        name: c.name,
        setCode: c.setCode,
        setName: c.setName,
        collectorNumber: c.collectorNumber,
        rarity: c.rarity,
        colors: c.colors,
        isFoil: false,
        condition: "NM" as const,
        quantity: 1,
        priceUsd: c.priceUsd,
        priceUsdFoil: c.priceUsdFoil,
        imageUri: c.imageUri,
        scryfallUri: c.scryfallUri,
      })));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setRapidQueue([]);
      showToast(`✓ ${count} card${count !== 1 ? "s" : ""} saved to vault`);
    } catch (e) {
      console.error("Bulk insert failed:", e);
      Alert.alert("Save Failed", "Could not commit batch. Please try again.");
    } finally {
      setIsCommitting(false);
    }
  };

  const captureManual = async (silent = false): Promise<boolean> => {
    if (isProcessing) return false;
    setIsProcessing(true);
    try {
      if (Platform.OS === "web") {
          const guide = guideRef.current as unknown as HTMLDivElement;
          if (videoRef.current && canvasRef.current && guide) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            
            if (!video.videoWidth || !video.videoHeight) {
              console.log("Video dimensions not ready, skipping...");
              return false;
            }
            
            const rectV = video.getBoundingClientRect();
            const rectG = guide.getBoundingClientRect();
            
            const vW = video.videoWidth;
            const vH = video.videoHeight;
            
            const scaleX = vW / rectV.width;
            const scaleY = vH / rectV.height;
            
            const sx = (rectG.left - rectV.left) * scaleX;
            const sy = (rectG.top - rectV.top) * scaleY;
            const sw = rectG.width * scaleX;
            const sh = rectG.height * scaleY;

            // Inset horizontally to skip decorative card frame icons on left (~12%) and
            // element-cost circles on right (~18%) that pollute OCR with symbol noise.
            const insetL = sw * 0.08;
            const insetR = sw * 0.10;
            const ocrSx = sx + insetL;
            const ocrSw = sw - insetL - insetR;

            // 2x upscale before OCR — Tesseract accuracy improves significantly on larger images
            const OCR_SCALE = 2;
            canvas.width = ocrSw * OCR_SCALE;
            canvas.height = sh * OCR_SCALE;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              ctx.drawImage(video, ocrSx, sy, ocrSw, sh, 0, 0, canvas.width, canvas.height);

              // Grayscale + high-contrast pass to help Tesseract read stylized card fonts
              const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const data = imgData.data;
              for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2];
                const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                // Contrast factor 2.0 for bolder text separation
                const contrast = 2.0;
                let val = (contrast * (gray - 128)) + 128;
                val = Math.max(0, Math.min(255, val));
                data[i] = data[i+1] = data[i+2] = val;
              }
              ctx.putImageData(imgData, 0, 0);
            }

            const base64Data = canvas.toDataURL("image/jpeg", 0.95);
            setDebugImage(base64Data);
          
          if (!workerRef.current) {
            console.log("Worker not ready, skipping OCR pass...");
            return false;
          }

          const { data: { text } } = await workerRef.current.recognize(base64Data);
          console.log("--- WEB OCR DEBUG (BoundRect Mapping) ---");
          console.log("Video Size:", vW, "x", vH);
          console.log("Display Rect:", rectV.width.toFixed(0), "x", rectV.height.toFixed(0));
          console.log("Scale X/Y:", scaleX.toFixed(2), scaleY.toFixed(2));
          console.log("Crop Region (sx, sy, sw, sh):", sx.toFixed(0), sy.toFixed(0), sw.toFixed(0), sh.toFixed(0));
          console.log("OCR Text Extracted:\n", text);
          setLastOcrFull(text);
          if (text.trim()) {
            await handleOcrResult(text);
            return true;
          } else if (!silent) {
            if (window) window.alert("Could not read any text. Try getting closer or improving lighting.");
          }
          return false;
        }
      } else {
        if (cameraRef.current) {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          const photo = await cameraRef.current.takePictureAsync({ base64: true });
          if (photo?.uri) {
            console.log("Starting Native OCR analysis on Cropped Image...");

            // ── Feature 1: Map the visual overlay to photo coordinates ──
            // The guide overlay occupies: width=CARD_WIDTH, height=TITLE_HEIGHT,
            // horizontally centred, vertically centred on the full screen.
            const guideScreenX = (SCREEN_WIDTH - CARD_WIDTH) / 2;
            const guideScreenY = (SCREEN_HEIGHT - TITLE_HEIGHT) / 2;

            // Camera fills the screen with "cover" semantics.
            const screenAspect = SCREEN_WIDTH / SCREEN_HEIGHT;
            const photoAspect  = photo.width  / photo.height;

            let scale: number, offsetX: number, offsetY: number;
            if (photoAspect > screenAspect) {
              // Photo is wider than screen – sides cropped in the preview
              scale   = photo.height / SCREEN_HEIGHT;
              offsetX = (photo.width - SCREEN_WIDTH * scale) / 2;
              offsetY = 0;
            } else {
              // Photo is taller than screen – top/bottom cropped in the preview
              scale   = photo.width / SCREEN_WIDTH;
              offsetX = 0;
              offsetY = (photo.height - SCREEN_HEIGHT * scale) / 2;
            }

            // Inset left 8% and right 10% to skip decorative card icons and element circles
            const rawOriginX = Math.round(guideScreenX * scale + offsetX);
            const rawCropW   = Math.round(CARD_WIDTH * scale);
            const insetLpx   = Math.round(rawCropW * 0.08);
            const insetRpx   = Math.round(rawCropW * 0.10);
            const originX = Math.max(0, rawOriginX + insetLpx);
            const originY = Math.max(0, Math.round(guideScreenY * scale + offsetY));
            const cropW   = Math.min(rawCropW - insetLpx - insetRpx, photo.width - originX);
            const cropH   = Math.min(Math.round(TITLE_HEIGHT * scale), photo.height - originY);

            const cropped = await ImageManipulator.manipulateAsync(
              photo.uri,
              [{ crop: { originX, originY, width: cropW, height: cropH } }],
              { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
            );

            if (cropped.base64) setDebugImage(`data:image/jpeg;base64,${cropped.base64}`);
            if (!workerRef.current) return false;
            const { data: { text } } = await workerRef.current.recognize(`data:image/jpeg;base64,${cropped.base64}`);
            console.log("--- NATIVE OCR DEBUG ---");
            console.log("Photo Size:", photo.width, "x", photo.height);
            console.log("OCR Text Extracted:\n", text);
            setLastOcrFull(text);
            if (text.trim()) {
              await handleOcrResult(text);
            } else if (!silent) {
              Alert.alert("No Text Detected", "Could not read any text. Try getting closer or improving lighting.");
            }
          }
        }
      }
    } catch (e) {
      console.error("Capture failed", e);
      if (!silent) Alert.alert("Error", "Failed to capture image.");
    } finally {
      setIsProcessing(false);
    }
    return false;
  };

  // Continuous background scanner — Single mode only
  useEffect(() => {
    if (scanMode === "rapid") return; // rapid mode uses its own auto-capture loop below
    let timeoutId: ReturnType<typeof setTimeout>;
    const performAutoScan = async () => {
      if (!isMounted.current) return;
      if (!autoScan || isProcessing || !scanning) {
        if (autoScan) timeoutId = setTimeout(performAutoScan, 1000);
        return;
      }
      try {
        const foundText = await captureManual(true);
        const delay = foundText ? 2000 : 3500;
        if (isMounted.current) timeoutId = setTimeout(performAutoScan, delay);
      } catch (err) {
        console.error("AutoScan loop error:", err);
        if (isMounted.current) timeoutId = setTimeout(performAutoScan, 5000);
      }
    };
    if (autoScan) performAutoScan();
    return () => clearTimeout(timeoutId);
  }, [autoScan, isProcessing, scanning, scanMode]);

  // ── Feature 3: Web stability detection (pixel comparison) ──────────────────
  useEffect(() => {
    if (!autoCaptureActive || !isWeb || scanMode !== "rapid" || !scanning) {
      prevPixelsRef.current = null;
      stableFramesRef.current = 0;
      countdownAnim.setValue(0);
      return;
    }

    const checkStability = () => {
      if (!isMounted.current) return;
      const video = videoRef.current;
      const guide = guideRef.current as unknown as HTMLDivElement;
      if (!video || !guide || !video.videoWidth) return;

      try {
        const rectV = video.getBoundingClientRect();
        const rectG = guide.getBoundingClientRect();
        const vW = video.videoWidth, vH = video.videoHeight;
        const scaleX = vW / rectV.width;
        const scaleY = vH / rectV.height;

        // Down-sample to a small patch for speed (60×20 px)
        const sampleW = 60, sampleH = 20;
        const tmpCanvas = document.createElement("canvas");
        tmpCanvas.width = sampleW;
        tmpCanvas.height = sampleH;
        const ctx = tmpCanvas.getContext("2d");
        if (!ctx) return;

        const sx = (rectG.left - rectV.left) * scaleX;
        const sy = (rectG.top  - rectV.top)  * scaleY;
        const sw = rectG.width  * scaleX;
        const sh = rectG.height * scaleY;
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sampleW, sampleH);

        const current = ctx.getImageData(0, 0, sampleW, sampleH).data;

        if (prevPixelsRef.current && current.length === prevPixelsRef.current.length) {
          let diff = 0;
          for (let i = 0; i < current.length; i += 4) {
            diff += Math.abs(current[i]     - prevPixelsRef.current[i]);
            diff += Math.abs(current[i + 1] - prevPixelsRef.current[i + 1]);
            diff += Math.abs(current[i + 2] - prevPixelsRef.current[i + 2]);
          }
          const avgDiff = diff / (sampleW * sampleH * 3);

          if (avgDiff < 10) {
            stableFramesRef.current = Math.min(stableFramesRef.current + 1, 3);
          } else {
            stableFramesRef.current = 0;
          }
        } else {
          stableFramesRef.current = 0;
        }

        const progress = stableFramesRef.current / 3;
        countdownAnim.setValue(progress);

        if (stableFramesRef.current >= 3) {
          // Stable for 1.5 s — fire!
          stableFramesRef.current = 0;
          prevPixelsRef.current = null;
          countdownAnim.setValue(0);
          captureManualRef.current(true);
        } else {
          prevPixelsRef.current = current;
        }
      } catch (_) {
        // Security errors from cross-origin canvas etc. — ignore silently
      }
    };

    const id = setInterval(checkStability, 500);
    return () => {
      clearInterval(id);
      prevPixelsRef.current = null;
      stableFramesRef.current = 0;
      countdownAnim.setValue(0);
    };
  }, [autoCaptureActive, isWeb, scanMode, scanning]);

  // ── Feature 3: Native countdown auto-capture ───────────────────────────────
  useEffect(() => {
    if (!autoCaptureActive || isWeb || scanMode !== "rapid" || !scanning) {
      countdownAnim.stopAnimation();
      countdownAnim.setValue(0);
      return;
    }

    let cancelled = false;

    const runCycle = () => {
      if (cancelled || !isMounted.current) return;
      countdownAnim.setValue(0);
      Animated.timing(countdownAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: false,
      }).start(async ({ finished }) => {
        if (!finished || cancelled || !isMounted.current) return;
        await captureManualRef.current(true);
        // Brief pause between captures so the queue can update
        setTimeout(() => { if (!cancelled) runCycle(); }, 400);
      });
    };

    runCycle();
    return () => {
      cancelled = true;
      countdownAnim.stopAnimation();
      countdownAnim.setValue(0);
    };
  }, [autoCaptureActive, isWeb, scanMode, scanning]);

  // Auto-enable rapid auto-capture when switching to Rapid mode
  useEffect(() => {
    if (scanMode === "rapid") {
      setAutoCaptureActive(true);
    } else {
      setAutoCaptureActive(false);
      prevPixelsRef.current = null;
      stableFramesRef.current = 0;
    }
  }, [scanMode]);

  // Keep the ref in sync with the latest closure on every render
  captureManualRef.current = captureManual;

  const filteredSets = setFilter.trim()
    ? setList.filter(s =>
        s.name.toLowerCase().includes(setFilter.toLowerCase()) ||
        s.code.toLowerCase().includes(setFilter.toLowerCase())
      )
    : setList;

  // Recently used sets (resolved to full objects), shown above all others when no filter active
  const recentSets = recentSetCodes
    .map(code => setList.find(s => s.code === code))
    .filter((s): s is ScryfallSet => !!s);

  const queueTotalValue = rapidQueue.reduce((sum, c) => sum + (c.priceUsd ?? 0), 0);

  const isNativePermGranted = permission?.granted;
  const isWebPermGranted = webPermissionGranted;
  const canScan = !!selectedSet;

  if ((!isWeb && !permission) || (isWeb && webChecking)) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Checking camera permissions...</Text>
      </View>
    );
  }

  if (isWeb && !isSecureContext) {
    return (
      <View className="flex-1 bg-[#0a0a0f] items-center justify-center p-8">
        <Text className="text-6xl mb-4">⚠️</Text>
        <Text className="text-[#f0f0f8] text-xl font-bold text-center mb-2">Insecure Connection</Text>
        <Text className="text-[#a0a0b8] text-base text-center leading-6">
          Camera access requires a secure connection. Please load this app over HTTPS or localhost.
        </Text>
      </View>
    );
  }

  const isNativePermDenied = !isWeb && permission && permission.status === 'denied' && !permission.canAskAgain;
  if (isNativePermDenied || (isWeb && webPermissionDenied)) {
    return (
      <View className="flex-1 bg-[#0a0a0f] items-center justify-center p-8">
        <Text className="text-6xl mb-4">🚫</Text>
        <Text className="text-[#f0f0f8] text-xl font-bold text-center mb-2">Permission Denied</Text>
        <Text className="text-[#a0a0b8] text-base text-center leading-6">
          Camera access denied. Please enable camera permissions in your browser settings to scan cards.
        </Text>
      </View>
    );
  }

  if ((!isWeb && !isNativePermGranted) || (isWeb && !isWebPermGranted)) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>📷</Text>
        <Text style={styles.permTitle}>Camera Access Needed</Text>
        <Text style={styles.permSubtitle}>
          MTG Scanner needs the camera to scan cards.
        </Text>
        <Pressable
          style={styles.permButton}
          onPress={isWeb ? requestWebPermission : requestPermission}
        >
          <Text style={styles.permButtonText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  // ── Set selection gate — blocks camera until a set is chosen ──
  if (!selectedSet) {
    return (
      <View style={styles.gateContainer}>
        <View style={styles.gateHeader}>
          <Text style={styles.gateEmoji}>🎴</Text>
          <Text style={styles.gateTitle}>Which set are you scanning?</Text>
          <Text style={styles.gateSub}>Select a set below to open the scanner</Text>
        </View>
        <View style={styles.gateSearchWrap}>
          <TextInput
            style={styles.gateSearchInput}
            value={setFilter}
            onChangeText={setSetFilter}
            placeholder="Search by name or code..."
            placeholderTextColor="#606078"
            autoFocus
          />
        </View>
        {setsLoading ? (
          <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
        ) : filteredSets.length === 0 ? (
          <Text style={styles.gateEmpty}>No sets found.</Text>
        ) : (
          <ScrollView style={styles.gateList} keyboardShouldPersistTaps="handled">
            {/* Recently used — only shown when no active search filter */}
            {!setFilter.trim() && recentSets.length > 0 && (
              <>
                <Text style={styles.gateSection}>Recently Used</Text>
                {recentSets.map(s => (
                  <Pressable
                    key={`recent-${s.code}`}
                    style={[styles.gateItem, styles.gateItemRecent]}
                    onPress={() => {
                      setSelectedSet({ code: s.code, name: s.name });
                      setSetFilter("");
                      const next = [s.code, ...recentSetCodes.filter(c => c !== s.code)].slice(0, 3);
                      setRecentSetCodes(next);
                      try { localStorage.setItem("recentSets", JSON.stringify(next)); } catch {}
                    }}
                  >
                    <View style={styles.gateItemLeft}>
                      <Text style={styles.gateItemName}>{s.name}</Text>
                      <Text style={styles.gateItemMeta}>
                        {s.code.toUpperCase()} · {s.card_count} cards · {s.released_at?.slice(0, 4)}
                      </Text>
                    </View>
                    <Text style={styles.gateItemArrow}>→</Text>
                  </Pressable>
                ))}
                <Text style={styles.gateSection}>All Sets</Text>
              </>
            )}
            {filteredSets.map(s => (
              <Pressable
                key={s.code}
                style={styles.gateItem}
                onPress={() => {
                  setSelectedSet({ code: s.code, name: s.name });
                  setSetFilter("");
                  const next = [s.code, ...recentSetCodes.filter(c => c !== s.code)].slice(0, 3);
                  setRecentSetCodes(next);
                  try { localStorage.setItem("recentSets", JSON.stringify(next)); } catch {}
                }}
              >
                <View style={styles.gateItemLeft}>
                  <Text style={styles.gateItemName}>{s.name}</Text>
                  <Text style={styles.gateItemMeta}>
                    {s.code.toUpperCase()} · {s.card_count} cards · {s.released_at?.slice(0, 4)}
                  </Text>
                </View>
                <Text style={styles.gateItemArrow}>→</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  const debugOcrVisible = !!lastOcrFull;

  return (
    <View style={styles.container}>
      {/* Hidden canvas for web capture */}
      {isWeb && <canvas ref={canvasRef} style={{ display: "none" }} />}

      {/* Camera */}
      {isFocused && scanning && (
        isWeb ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            autofocus="on"
            flash={flash ? "on" : "off"}
            onBarcodeScanned={undefined}
          />
        )
      )}

      {/* Success flash overlay */}
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: "#22c55e", opacity: flashAnim, zIndex: 8 }]}
        pointerEvents="none"
      />

      {/* Toast notification */}
      {toastMessage && (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.topBarTitle}>🔍 Scan Card</Text>
          <View style={styles.topBarRight}>
            {/* Mode toggle */}
            <View style={styles.modeToggle}>
              <Pressable
                style={[styles.modeBtn, scanMode === "single" && styles.modeBtnActive]}
                onPress={() => setScanMode("single")}
              >
                <Text style={[styles.modeBtnText, scanMode === "single" && styles.modeBtnTextActive]}>
                  Single
                </Text>
              </Pressable><Pressable
                style={[styles.modeBtn, scanMode === "rapid" && styles.modeBtnRapid]}
                onPress={() => setScanMode("rapid")}
              >
                <Text style={[styles.modeBtnText, scanMode === "rapid" && styles.modeBtnTextRapid]}>
                  ⚡ Rapid
                </Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setFlash((f) => !f)} style={styles.flashBtn}>
              <Text style={styles.flashText}>{flash ? "⚡ On" : "⚡ Off"}</Text>
            </Pressable>
          </View>
        </View>

        {/* Active set chip — tap to change */}
        <Pressable style={styles.setChip} onPress={() => setSetPickerOpen(true)}>
          <Text style={styles.setChipText} numberOfLines={1}>
            {selectedSet.name} ({selectedSet.code.toUpperCase()})
          </Text>
          <Text style={styles.setChipChange}>Change ▼</Text>
        </Pressable>

        {/* Session indicator */}
        {activeSession ? (
          <View style={styles.sessionBadge}>
            <Text style={styles.sessionBadgeText}>📦 {activeSession.name}</Text>
          </View>
        ) : (
          <View style={styles.noSessionBanner}>
            <Text style={styles.noSessionText}>⚠️ No active session</Text>
            <Pressable onPress={() => router.push("/session/new")}>
              <Text style={styles.noSessionLink}>Create one →</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.overlayContainer} pointerEvents="none">
          <View style={styles.overlayDim} />
          <View style={styles.overlayRow}>
            <View style={styles.overlayDim} />
            <View
              ref={guideRef}
              style={[
                styles.cardFrame,
                autoCaptureActive && scanMode === "rapid" && styles.cardFrameActive,
              ]}
            >
              <View style={styles.targetBoxTop}>
                <Text style={styles.targetLabel}>Card Name Only</Text>
              </View>
            </View>
            <View style={styles.overlayDim} />
          </View>
          <View style={[styles.overlayDim, { paddingTop: 20, alignItems: "center" }]}>
            <Text style={styles.frameHelper}>Webcams generally have fixed focus lenses.</Text>
            <Text style={styles.frameHelperSub}>Hold MTG card 8-12 inches away</Text>

            {/* Stability progress bar — visible in Rapid mode with auto-capture on */}
            {scanMode === "rapid" && autoCaptureActive && (
              <View style={styles.stabilityBarContainer}>
                <Animated.View style={[
                  styles.stabilityBarFill,
                  { width: countdownAnim.interpolate({ inputRange: [0, 1], outputRange: [0, CARD_WIDTH] }) },
                ]} />
              </View>
            )}
            {scanMode === "rapid" && autoCaptureActive && (
              <Text style={styles.stabilityLabel}>
                {isWeb ? "Hold card steady to auto-capture..." : "Auto-capturing..."}
              </Text>
            )}
          </View>
        </View>

        {/* OCR Debug Panel */}
        {debugOcrVisible && (
          <View style={styles.debugPanel}>
            <View style={styles.debugHeader}>
              <Text style={styles.debugTitle}>Latest OCR Read</Text>
              <Pressable onPress={() => setLastOcrFull(null)}>
                <Text style={styles.debugClose}>✕</Text>
              </Pressable>
            </View>
            <Text style={styles.debugText} numberOfLines={3}>
              {lastOcrFull?.replace(/\n/g, " | ")}
            </Text>
            {debugImage && (
              <View style={styles.debugImageContainer}>
                <Text style={styles.debugImgLabel}>Croppead Input:</Text>
                <Image source={{ uri: debugImage }} style={styles.debugImg} resizeMode="contain" />
              </View>
            )}
            {lastOcrExtracted && (
              <Text style={styles.debugExtraction}>
                Match: <Text style={{color: ACCENT}}>{lastOcrExtracted.name || "???"}</Text> {lastOcrExtracted.collector ? `(#${lastOcrExtracted.collector})` : ""}
              </Text>
            )}
          </View>
        )}

        {/* Session Queue — Rapid Mode only */}
        {scanMode === "rapid" && (
          <View style={styles.queueSheet}>
            <Pressable style={styles.queueHeader} onPress={() => setQueueExpanded(q => !q)}>
              <View style={styles.queueHeaderLeft}>
                <Text style={styles.queueROI}>
                  ${queueTotalValue.toFixed(2)}
                </Text>
                <Text style={styles.queueCount}>
                  {rapidQueue.length === 0 && needsReview.length === 0
                    ? "Queue empty — scanning…"
                    : `${rapidQueue.length} queued${needsReview.length > 0 ? `  ·  ${needsReview.length} need review` : ""}`}
                </Text>
              </View>
              {rapidQueue.length > 0 && (
                <Pressable
                  style={[styles.commitBtn, isCommitting && styles.btnDisabled]}
                  onPress={commitBatch}
                  disabled={isCommitting}
                >
                  {isCommitting
                    ? <ActivityIndicator size="small" color="#0a0a0f" />
                    : <Text style={styles.commitBtnText}>💾 Commit to Vault</Text>
                  }
                </Pressable>
              )}
              <Text style={styles.queueToggleArrow}>{queueExpanded ? "▼" : "▲"}</Text>
            </Pressable>

            {queueExpanded && (rapidQueue.length > 0 || needsReview.length > 0) && (
              <ScrollView style={styles.queueList} showsVerticalScrollIndicator={false}>
                {/* Confirmed cards */}
                {rapidQueue.map(card => (
                  <View key={card.localId} style={styles.queueItem}>
                    {card.thumbUri ? (
                      <Image source={{ uri: card.thumbUri }} style={styles.queueThumb} />
                    ) : (
                      <View style={[styles.queueThumb, styles.queueThumbPlaceholder]}>
                        <Text style={{ color: "#606078" }}>🃏</Text>
                      </View>
                    )}
                    <Text style={styles.queueItemName} numberOfLines={1}>{card.name}</Text>
                    <Text style={styles.queueItemPrice}>
                      {card.priceUsd ? `$${card.priceUsd.toFixed(2)}` : "—"}
                    </Text>
                  </View>
                ))}

                {/* Review-needed items — shown below confirmed cards */}
                {needsReview.map(item => (
                  <Pressable
                    key={item.localId}
                    style={styles.reviewNeededItem}
                    onPress={() => openReviewItem(item)}
                  >
                    <View style={[styles.queueThumb, styles.queueThumbPlaceholder]}>
                      <Text style={{ color: "#f59e0b", fontSize: 16 }}>?</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reviewNeededText} numberOfLines={1}>
                        "{item.ocrText || "Unknown"}"
                      </Text>
                      <View style={styles.reviewNeededBadge}>
                        <Text style={styles.reviewNeededBadgeText}>Review Needed — tap to fix</Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Bottom Bar: Action Buttons */}
        <View style={styles.bottomBar}>
          <View style={styles.actionRow}>
            {scanMode === "rapid" ? (
              // Rapid mode: auto-capture toggle (motion/stability detection)
              <Pressable
                style={[styles.captureBtn, autoCaptureActive && styles.captureBtnActive, !canScan && styles.btnDisabled]}
                onPress={() => setAutoCaptureActive(a => !a)}
                disabled={!canScan}
              >
                <Text style={styles.captureBtnText}>
                  {autoCaptureActive ? "⚡ Auto-Capture: ON" : "⚡ Auto-Capture: OFF"}
                </Text>
              </Pressable>
            ) : (
              // Single mode: original auto-scan toggle
              <Pressable
                style={[styles.captureBtn, autoScan && styles.captureBtnActive, !canScan && styles.btnDisabled]}
                onPress={() => setAutoScan(!autoScan)}
                disabled={!canScan}
              >
                <Text style={styles.captureBtnText}>
                  {autoScan ? "⏱ Auto-Scan: ON" : "⏱ Auto-Scan: OFF"}
                </Text>
              </Pressable>
            )}

            <Pressable
              style={[styles.manualBtn, !canScan && styles.btnDisabled]}
              onPress={() => captureManual()}
              disabled={isProcessing || !canScan}
            >
              {isProcessing
                ? <ActivityIndicator color="#f0f0f8" size="small" />
                : <Text style={styles.manualBtnText}>📸 Capture 1x</Text>
              }
            </Pressable>

            <Pressable
              style={styles.manualBtn}
              onPress={() =>
                router.push({
                  pathname: "/manual-entry",
                  params: { sessionId: activeSession?.id ?? "" },
                })
              }
            >
              <Text style={styles.manualBtnText}>✏️ Manual Entry</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* ── Set Picker Modal ── */}
      <Modal
        visible={setPickerOpen}
        animationType="slide"
        onRequestClose={() => setSetPickerOpen(false)}
      >
        <View style={styles.pickerContainer}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Select a Set</Text>
            <Pressable style={styles.pickerClose} onPress={() => setSetPickerOpen(false)}>
              <Text style={styles.pickerCloseText}>✕</Text>
            </Pressable>
          </View>
          <View style={styles.pickerSearchBar}>
            <TextInput
              style={styles.pickerSearchInput}
              value={setFilter}
              onChangeText={setSetFilter}
              placeholder="Search by name or code..."
              placeholderTextColor="#606078"
              autoFocus
            />
          </View>
          <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
            {setsLoading ? (
              <ActivityIndicator color={ACCENT} style={{ marginTop: 40 }} />
            ) : filteredSets.length === 0 ? (
              <Text style={styles.pickerEmpty}>No sets found.</Text>
            ) : (
              filteredSets.map(s => (
                <Pressable
                  key={s.code}
                  style={[styles.pickerItem, selectedSet?.code === s.code && styles.pickerItemActive]}
                  onPress={() => {
                    setSelectedSet({ code: s.code, name: s.name });
                    setSetFilter("");
                    setSetPickerOpen(false);
                  }}
                >
                  <Text style={[styles.pickerItemName, selectedSet?.code === s.code && styles.pickerItemNameActive]}>
                    {s.name}
                  </Text>
                  <Text style={styles.pickerItemMeta}>
                    {s.code.toUpperCase()} · {s.card_count} cards · {s.released_at?.slice(0, 4)}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* ── Review Scan Modal (Rapid mode fallback) ── */}
      {reviewModalVisible && (
        isWeb ? (
          <View style={[styles.resultModalBgWeb, { zIndex: 1000 }]}>
            <View style={styles.resultSheetWeb}>
              <View style={styles.resultSheetHeader}>
                <Text style={styles.resultSheetTitle}>Review Scan</Text>
                <Pressable style={styles.resultSheetClose} onPress={() => setReviewModalVisible(false)}>
                  <Text style={styles.resultSheetCloseText}>✕</Text>
                </Pressable>
              </View>
              <View style={styles.reviewSearchRow}>
                <TextInput
                  style={styles.reviewInput}
                  value={reviewEditText}
                  onChangeText={setReviewEditText}
                  placeholder="Edit OCR text..."
                  placeholderTextColor="#606078"
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={() => handleReviewSearch(reviewEditText)}
                />
                <Pressable
                  style={[styles.reviewSearchBtn, reviewSearching && styles.btnDisabled]}
                  onPress={() => handleReviewSearch(reviewEditText)}
                  disabled={reviewSearching}
                >
                  {reviewSearching
                    ? <ActivityIndicator size="small" color="#0a0a0f" />
                    : <Text style={styles.reviewSearchBtnText}>Search</Text>
                  }
                </Pressable>
              </View>
              {reviewResults.length === 0 && !reviewSearching && (
                <View style={styles.reviewEmptyState}>
                  <Text style={styles.reviewEmptyText}>
                    No results. Edit the text above and search again.
                  </Text>
                </View>
              )}
              <ScrollView>
                {reviewResults.map(card => {
                  const thumbUri = getSmallImageUri(card);
                  const price = card.prices.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : null;
                  return (
                    <Pressable key={card.id} style={styles.resultCard} onPress={() => handleReviewSelect(card)}>
                      {thumbUri ? (
                        <Image source={{ uri: thumbUri }} style={styles.resultThumb} />
                      ) : (
                        <View style={[styles.resultThumb, styles.resultThumbPlaceholder]}>
                          <Text style={{ color: "#606078", fontSize: 20 }}>🃏</Text>
                        </View>
                      )}
                      <View style={styles.resultInfo}>
                        <Text style={styles.resultName} numberOfLines={1}>{card.name}</Text>
                        <Text style={styles.resultMeta} numberOfLines={1}>{card.mana_cost ? `${card.mana_cost}  ·  ` : ""}{card.set.toUpperCase()} #{card.collector_number}</Text>
                        <Text style={styles.resultTypeLine} numberOfLines={1}>{card.type_line}</Text>
                      </View>
                      {price && (
                        <View style={styles.resultPriceChip}>
                          <Text style={styles.resultPrice}>{price}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Pressable
                style={styles.resultCancelBtn}
                onPress={() => {
                  if (reviewingItem) {
                    setNeedsReview(prev => prev.filter(r => r.localId !== reviewingItem.localId));
                    setReviewingItem(null);
                  }
                  setReviewModalVisible(false);
                }}
              >
                <Text style={styles.resultCancelText}>
                  {reviewingItem ? "Skip — Remove from Review Queue" : "Skip — Try scanning again"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Modal
            visible={reviewModalVisible}
            animationType="slide"
            transparent
            onRequestClose={() => setReviewModalVisible(false)}
          >
            <View style={styles.resultModalBg}>
              <View style={styles.resultSheet}>
                <View style={styles.resultSheetHeader}>
                  <Text style={styles.resultSheetTitle}>Review Scan</Text>
                  <Pressable style={styles.resultSheetClose} onPress={() => setReviewModalVisible(false)}>
                    <Text style={styles.resultSheetCloseText}>✕</Text>
                  </Pressable>
                </View>
                <View style={styles.reviewSearchRow}>
                  <TextInput
                    style={styles.reviewInput}
                    value={reviewEditText}
                    onChangeText={setReviewEditText}
                    placeholder="Edit OCR text..."
                    placeholderTextColor="#606078"
                    autoCapitalize="words"
                    returnKeyType="search"
                    onSubmitEditing={() => handleReviewSearch(reviewEditText)}
                  />
                  <Pressable
                    style={[styles.reviewSearchBtn, reviewSearching && styles.btnDisabled]}
                    onPress={() => handleReviewSearch(reviewEditText)}
                    disabled={reviewSearching}
                  >
                    {reviewSearching
                      ? <ActivityIndicator size="small" color="#0a0a0f" />
                      : <Text style={styles.reviewSearchBtnText}>Search</Text>
                    }
                  </Pressable>
                </View>
                {reviewResults.length === 0 && !reviewSearching && (
                  <View style={styles.reviewEmptyState}>
                    <Text style={styles.reviewEmptyText}>
                      No results. Edit the text above and search again.
                    </Text>
                  </View>
                )}
                <ScrollView>
                  {reviewResults.map(card => {
                    const thumbUri = getSmallImageUri(card);
                    const price = card.prices.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : null;
                    return (
                      <Pressable key={card.id} style={styles.resultCard} onPress={() => handleReviewSelect(card)}>
                        {thumbUri ? (
                          <Image source={{ uri: thumbUri }} style={styles.resultThumb} />
                        ) : (
                          <View style={[styles.resultThumb, styles.resultThumbPlaceholder]}>
                            <Text style={{ color: "#606078", fontSize: 20 }}>🃏</Text>
                          </View>
                        )}
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{card.name}</Text>
                          <Text style={styles.resultMeta} numberOfLines={1}>
                            {card.mana_cost ? `${card.mana_cost}  ·  ` : ""}{card.set.toUpperCase()} #{card.collector_number}
                          </Text>
                          <Text style={styles.resultTypeLine} numberOfLines={1}>{card.type_line}</Text>
                        </View>
                        {price && (
                          <View style={styles.resultPriceChip}>
                            <Text style={styles.resultPrice}>{price}</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable style={styles.resultCancelBtn} onPress={() => setReviewModalVisible(false)}>
                  <Text style={styles.resultCancelText}>Skip — Try scanning again</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        )
      )}

      {/* ── Single-Mode Result Picker Modal ── */}
      {resultModalVisible && (
        isWeb ? (
          <View style={[styles.resultModalBgWeb, { zIndex: 1000 }]}>
            <View style={styles.resultSheetWeb}>
              <View style={styles.resultSheetHeader}>
                <Text style={styles.resultSheetTitle}>Which card is this?</Text>
                <Pressable style={styles.resultSheetClose} onPress={() => setResultModalVisible(false)}>
                  <Text style={styles.resultSheetCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView>{resultCandidates.map(card => {
                  const thumbUri = getSmallImageUri(card);
                  const price = card.prices.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : null;
                  return (
                    <Pressable key={card.id} style={styles.resultCard} onPress={() => handleResultSelect(card)}>
                      {thumbUri ? (
                        <Image source={{ uri: thumbUri }} style={styles.resultThumb} />
                      ) : (
                        <View style={[styles.resultThumb, styles.resultThumbPlaceholder]}>
                          <Text style={{ color: "#606078", fontSize: 20 }}>🃏</Text>
                        </View>
                      )}
                      <View style={styles.resultInfo}>
                        <Text style={styles.resultName} numberOfLines={1}>{card.name}</Text>
                        <Text style={styles.resultMeta} numberOfLines={1}>{card.mana_cost ? `${card.mana_cost}  ·  ` : ""}{card.set.toUpperCase()} #{card.collector_number}</Text>
                        <Text style={styles.resultTypeLine} numberOfLines={1}>{card.type_line}</Text>
                      </View>
                      {price && (
                        <View style={styles.resultPriceChip}>
                          <Text style={styles.resultPrice}>{price}</Text>
                        </View>
                      )}
                    </Pressable>
                  );
                })}</ScrollView>
              <Pressable style={styles.resultCancelBtn} onPress={() => setResultModalVisible(false)}>
                <Text style={styles.resultCancelText}>None of these — Try again</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Modal
            visible={resultModalVisible}
            animationType="slide"
            transparent
            onRequestClose={() => setResultModalVisible(false)}
          >
            <View style={styles.resultModalBg}>
              <View style={styles.resultSheet}>
                <View style={styles.resultSheetHeader}>
                  <Text style={styles.resultSheetTitle}>Which card is this?</Text>
                  <Pressable style={styles.resultSheetClose} onPress={() => setResultModalVisible(false)}>
                    <Text style={styles.resultSheetCloseText}>✕</Text>
                  </Pressable>
                </View>
                <ScrollView>
                  {resultCandidates.map(card => {
                    const thumbUri = getSmallImageUri(card);
                    const price = card.prices.usd ? `$${parseFloat(card.prices.usd).toFixed(2)}` : null;
                    return (
                      <Pressable key={card.id} style={styles.resultCard} onPress={() => handleResultSelect(card)}>
                        {thumbUri ? (
                          <Image source={{ uri: thumbUri }} style={styles.resultThumb} />
                        ) : (
                          <View style={[styles.resultThumb, styles.resultThumbPlaceholder]}>
                            <Text style={{ color: "#606078", fontSize: 20 }}>🃏</Text>
                          </View>
                        )}
                        <View style={styles.resultInfo}>
                          <Text style={styles.resultName} numberOfLines={1}>{card.name}</Text>
                          <Text style={styles.resultMeta} numberOfLines={1}>
                            {card.mana_cost ? `${card.mana_cost}  ·  ` : ""}{card.set.toUpperCase()} #{card.collector_number}
                          </Text>
                          <Text style={styles.resultTypeLine} numberOfLines={1}>{card.type_line}</Text>
                        </View>
                        {price && (
                          <View style={styles.resultPriceChip}>
                            <Text style={styles.resultPrice}>{price}</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable style={styles.resultCancelBtn} onPress={() => setResultModalVisible(false)}>
                  <Text style={styles.resultCancelText}>None of these — Try again</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        )
      )}
    </View>
  );
}

const ACCENT = "#c89b3c";
const RAPID = "#ef4444";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1, justifyContent: "space-between" },
  center: { flex: 1, backgroundColor: "#0a0a0f", alignItems: "center", justifyContent: "center", padding: 32 },
  loadingText: { color: "#a0a0b8" },
  emoji: { fontSize: 60, marginBottom: 16 },
  permTitle: { color: "#f0f0f8", fontSize: 22, fontWeight: "800", marginBottom: 8, textAlign: "center" },
  permSubtitle: { color: "#a0a0b8", fontSize: 15, textAlign: "center", marginBottom: 28, lineHeight: 22 },
  permButton: { backgroundColor: ACCENT, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  permButtonText: { color: "#0a0a0f", fontWeight: "800", fontSize: 16 },

  // Top bar
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: isWeb ? 10 : 56, paddingBottom: 10, backgroundColor: "rgba(10,10,15,0.85)", zIndex: 10 },
  topBarTitle: { color: "#ffffff", fontSize: 18, fontWeight: "800", textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  flashBtn: { backgroundColor: "rgba(200,155,60,0.2)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: ACCENT },
  flashText: { color: ACCENT, fontWeight: "700", fontSize: 12 },

  // Mode toggle
  modeToggle: { flexDirection: "row", backgroundColor: "rgba(10,10,20,0.9)", borderRadius: 22, padding: 4, borderWidth: 1, borderColor: "#333348" },
  modeBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18 },
  modeBtnActive: { backgroundColor: ACCENT },
  modeBtnRapid: { backgroundColor: RAPID },
  modeBtnText: { color: "#c0c0d8", fontWeight: "700", fontSize: 14 },
  modeBtnTextActive: { color: "#0a0a0f" },
  modeBtnTextRapid: { color: "#fff" },

  // Session badge
  sessionBadge: { alignSelf: "center", backgroundColor: "rgba(10,10,15,0.8)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: "#222233", zIndex: 10 },
  sessionBadgeText: { color: "#a0a0b8", fontSize: 13, fontWeight: "600" },
  noSessionBanner: { flexDirection: "row", alignSelf: "center", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.15)", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: "#ef4444", zIndex: 10 },
  noSessionText: { color: "#ef4444", fontWeight: "600" },
  noSessionLink: { color: ACCENT, fontWeight: "700" },

  // Camera overlay
  overlayContainer: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  overlayDim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  overlayRow: { flexDirection: "row", height: TITLE_HEIGHT },
  cardFrame: { width: CARD_WIDTH, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)", borderRadius: 8, justifyContent: "center" },
  targetBoxTop: { width: "100%", height: "100%", paddingHorizontal: 12, justifyContent: "center" },
  targetLabel: { color: "rgba(255,255,255,0.8)", fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
  frameHelper: { color: "#f0f0f8", fontSize: 13, fontWeight: "700", textAlign: "center", paddingHorizontal: 20 },
  frameHelperSub: { color: ACCENT, fontSize: 13, fontWeight: "800", textAlign: "center", marginTop: 4 },

  // Session Queue (Rapid mode)
  queueSheet: { backgroundColor: "rgba(8,8,14,0.95)", borderTopWidth: 1, borderColor: "#222233", zIndex: 12 },
  queueHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  queueHeaderLeft: { flex: 1 },
  queueROI: { color: "#22c55e", fontSize: 20, fontWeight: "900", lineHeight: 24 },
  queueCount: { color: "#606078", fontSize: 11, fontWeight: "600" },
  commitBtn: { backgroundColor: ACCENT, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, minWidth: 44, alignItems: "center" },
  commitBtnText: { color: "#0a0a0f", fontWeight: "800", fontSize: 12 },
  queueToggleArrow: { color: "#606078", fontSize: 14, paddingHorizontal: 4 },
  queueList: { maxHeight: 180, paddingHorizontal: 10, paddingBottom: 4 },
  queueItem: { flexDirection: "row", alignItems: "center", paddingVertical: 7, borderTopWidth: 1, borderColor: "#111120", gap: 10 },
  queueThumb: { width: 34, height: 47, borderRadius: 4, backgroundColor: "#12121a" },
  queueThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  queueItemName: { flex: 1, color: "#f0f0f8", fontSize: 13, fontWeight: "600" },
  queueItemPrice: { color: "#22c55e", fontSize: 13, fontWeight: "700" },

  // Bottom bar
  bottomBar: { paddingHorizontal: 16, paddingBottom: 36, paddingTop: 12, backgroundColor: "rgba(10,10,15,0.8)", alignItems: "center", zIndex: 11 },
  actionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  captureBtn: { backgroundColor: "#12121a", borderRadius: 24, paddingHorizontal: 20, paddingVertical: 14, borderWidth: 1, borderColor: "#222233" },
  captureBtnActive: { backgroundColor: "rgba(200, 155, 60, 0.2)", borderColor: ACCENT },
  captureBtnText: { color: "#f0f0f8", fontWeight: "700", fontSize: 13 },
  manualBtn: { backgroundColor: "#12121a", borderRadius: 24, paddingHorizontal: 20, paddingVertical: 14, borderWidth: 1, borderColor: "#222233" },
  manualBtnText: { color: "#f0f0f8", fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.35 },

  // Toast
  toast: { position: "absolute", top: 130, alignSelf: "center", backgroundColor: "rgba(15,15,25,0.95)", borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: "#ef4444", zIndex: 50 },
  toastText: { color: "#f0f0f8", fontWeight: "700", fontSize: 14 },

  // Set Picker Modal
  pickerContainer: { flex: 1, backgroundColor: "#0a0a0f" },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderColor: "#222233" },
  pickerTitle: { color: "#f0f0f8", fontSize: 20, fontWeight: "800" },
  pickerClose: { backgroundColor: "#12121a", borderRadius: 20, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  pickerCloseText: { color: "#a0a0b8", fontWeight: "700" },
  pickerSearchBar: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#222233" },
  pickerSearchInput: { backgroundColor: "#12121a", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#222233" },
  pickerList: { flex: 1 },
  pickerEmpty: { color: "#606078", textAlign: "center", marginTop: 40, fontSize: 15 },
  pickerItem: { paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderColor: "#111120" },
  pickerItemActive: { backgroundColor: "rgba(200,155,60,0.1)" },
  pickerItemName: { color: "#f0f0f8", fontSize: 16, fontWeight: "600", marginBottom: 2 },
  pickerItemNameActive: { color: ACCENT },
  pickerItemMeta: { color: "#606078", fontSize: 12 },

  // Set selection gate screen
  gateContainer: { flex: 1, backgroundColor: "#0a0a0f", paddingTop: 60 },
  gateHeader: { alignItems: "center", paddingHorizontal: 24, paddingBottom: 24 },
  gateEmoji: { fontSize: 52, marginBottom: 12 },
  gateTitle: { color: "#f0f0f8", fontSize: 24, fontWeight: "900", textAlign: "center", marginBottom: 6 },
  gateSub: { color: "#606078", fontSize: 15, textAlign: "center" },
  gateSearchWrap: { paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, borderColor: "#222233" },
  gateSearchInput: { backgroundColor: "#12121a", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: "#f0f0f8", fontSize: 16, borderWidth: 1, borderColor: "#222233" },
  gateList: { flex: 1 },
  gateEmpty: { color: "#606078", textAlign: "center", marginTop: 40, fontSize: 15 },
  gateItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderColor: "#111120" },
  gateItemLeft: { flex: 1 },
  gateItemName: { color: "#f0f0f8", fontSize: 16, fontWeight: "700", marginBottom: 2 },
  gateItemMeta: { color: "#606078", fontSize: 12 },
  gateItemArrow: { color: ACCENT, fontSize: 18, fontWeight: "700", paddingLeft: 12 },
  gateItemRecent: { backgroundColor: "rgba(200,155,60,0.06)", borderLeftWidth: 3, borderLeftColor: ACCENT },
  gateSection: { color: "#606078", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: "#0d0d16" },

  // Active set chip (inside scanner, above session badge)
  setChip: { flexDirection: "row", alignSelf: "center", alignItems: "center", gap: 8, backgroundColor: "rgba(200,155,60,0.12)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: ACCENT, zIndex: 10, maxWidth: "90%" },
  setChipText: { color: ACCENT, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  setChipChange: { color: "#606078", fontSize: 11, fontWeight: "600" },

  // Review Scan modal
  reviewSearchRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderColor: "#222233" },
  reviewInput: { flex: 1, backgroundColor: "#12121a", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, color: "#f0f0f8", fontSize: 15, borderWidth: 1, borderColor: "#222233" },
  reviewSearchBtn: { backgroundColor: ACCENT, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  reviewSearchBtnText: { color: "#0a0a0f", fontWeight: "800", fontSize: 14 },
  reviewEmptyState: { padding: 24, alignItems: "center" },
  reviewEmptyText: { color: "#606078", fontSize: 14, textAlign: "center" },

  // Single-mode Result Picker Modal
  resultModalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  resultSheet: { backgroundColor: "#0a0a0f", borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", borderTopWidth: 1, borderColor: "#222233" },
  resultSheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderColor: "#222233" },
  resultSheetTitle: { color: "#f0f0f8", fontSize: 17, fontWeight: "800" },
  resultSheetClose: { backgroundColor: "#12121a", borderRadius: 20, width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  resultSheetCloseText: { color: "#a0a0b8", fontWeight: "700", fontSize: 13 },
  resultCard: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#111120" },
  resultThumb: { width: 54, height: 75, borderRadius: 6, marginRight: 14, backgroundColor: "#12121a" },
  resultThumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  resultInfo: { flex: 1 },
  resultName: { color: "#f0f0f8", fontSize: 15, fontWeight: "700", marginBottom: 3 },
  resultMeta: { color: "#a0a0b8", fontSize: 12, marginBottom: 2 },
  resultTypeLine: { color: "#606078", fontSize: 11 },
  resultPriceChip: { backgroundColor: "rgba(34,197,94,0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#22c55e" },
  resultPrice: { color: "#22c55e", fontWeight: "700", fontSize: 13 },
  resultCancelBtn: { margin: 16, paddingVertical: 14, alignItems: "center" },
  resultCancelText: { color: "#606078", fontWeight: "600" },

  // Debug Panel
  debugPanel: { position: "absolute", top: 180, left: 20, right: 20, backgroundColor: "rgba(10,10,20,0.9)", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#333344", zIndex: 60 },
  debugHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  debugTitle: { color: "#606078", fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  debugClose: { color: "#606078", fontSize: 12, padding: 4 },
  debugText: { color: "#f0f0f8", fontSize: 13, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  debugExtraction: { color: "#a0a0b8", fontSize: 11, marginTop: 4, fontWeight: "600" },

  debugImageContainer: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: "#333344" },
  debugImgLabel: { color: "#606078", fontSize: 9, fontWeight: "800", marginBottom: 4, textTransform: "uppercase" },
  debugImg: { width: "100%", height: 40, backgroundColor: "#000", borderRadius: 4 },

  // ── Review-Needed queue items (Feature 2) ──────────────────────────────────
  reviewNeededItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
    gap: 10,
    backgroundColor: "rgba(245,158,11,0.06)",
  },
  reviewNeededText: {
    color: "#f0f0f8",
    fontSize: 12,
    fontWeight: "600",
    fontStyle: "italic",
  },
  reviewNeededBadge: {
    alignSelf: "flex-start",
    marginTop: 3,
    backgroundColor: "rgba(245,158,11,0.18)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "#f59e0b",
  },
  reviewNeededBadgeText: {
    color: "#f59e0b",
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // ── Auto-capture stability bar (Feature 3) ─────────────────────────────────
  cardFrameActive: {
    borderColor: "#22c55e",
  },
  stabilityBarContainer: {
    width: CARD_WIDTH,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 2,
    marginTop: 10,
    overflow: "hidden",
  },
  stabilityBarFill: {
    height: 4,
    backgroundColor: "#22c55e",
    borderRadius: 2,
  },
  stabilityLabel: {
    color: "#22c55e",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },

  // Web side panel overrides
  resultModalBgWeb: { 
    position: "absolute", 
    top: 56, // below topBar
    bottom: 0, 
    left: 0, 
    right: 0, 
    backgroundColor: "transparent", 
    alignItems: "flex-end",
    pointerEvents: "box-none" 
  },
  resultSheetWeb: { 
    width: 400, 
    height: "100%", 
    backgroundColor: "rgba(10,10,15,0.95)", 
    borderLeftWidth: 1, 
    borderColor: "#222233",
    paddingTop: 60, // Don't impede top toolbar
    shadowColor: "#000",
    shadowOffset: { width: -5, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
  },
});
