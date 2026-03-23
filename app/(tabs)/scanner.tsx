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

import { searchCardByNameInSet, fetchMtgSets, normalizeScryfallCard, getCardBySetAndNumber } from "@api/scryfall";
import type { ScryfallCard } from "@mtgtypes/index";
import type { ScryfallSet } from "@api/scryfall";
import { bulkAddCards } from "@db/queries";
import Tesseract from "tesseract.js";
import * as ImageManipulator from "expo-image-manipulator";

// Regex patterns for OCR text extraction (used for future set code detection)
const COLLECTOR_PATTERN = /(\d{1,4})\s*\/\s*(\d{1,4})/;
const SET_CODE_PATTERN = /\b([A-Z]{3,5})\b/g;

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

function extractCardInfo(text: string): { name: string; collectorNumber?: string } | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const cleanedLines = lines.map(l => l.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''));
  const nameLine = cleanedLines.find(
    (l) => l.length >= 2 && /[a-zA-Z]/.test(l) && !/^\d+$/.test(l)
  );

  let collectorNumber: string | undefined;
  for (const line of lines) {
    const match = line.match(COLLECTOR_PATTERN);
    if (match) {
      collectorNumber = match[1];
      break;
    }
  }

  if (!nameLine && !collectorNumber) return null;
  return { name: nameLine || "", collectorNumber };
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
  const aL = a.toLowerCase();
  const bL = b.toLowerCase();
  const dist = levenshteinDistance(aL, bL);
  const maxLen = Math.max(aL.length, bL.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

export default function ScannerScreen() {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [webPermissionGranted, setWebPermissionGranted] = useState(false);
  const [webPermissionDenied, setWebPermissionDenied] = useState(false);
  const [isSecureContext, setIsSecureContext] = useState(true);
  const [webChecking, setWebChecking] = useState(Platform.OS === "web");

  const { activeSession, setPendingCard } = useAppStore();
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [autoScan, setAutoScan] = useState(false);

  // Scan mode
  const [scanMode, setScanMode] = useState<"single" | "rapid">("single");

  // Set selection
  const [selectedSet, setSelectedSet] = useState<{ code: string; name: string } | null>(null);
  const [setList, setSetList] = useState<ScryfallSet[]>([]);
  const [setsLoading, setSetsLoading] = useState(false);
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [setFilter, setSetFilter] = useState("");

  // Single-mode result picker modal
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [resultCandidates, setResultCandidates] = useState<ScryfallCard[]>([]);

  // Rapid mode queue
  const [rapidQueue, setRapidQueue] = useState<QueuedCard[]>([]);
  const [queueExpanded, setQueueExpanded] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);

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

  const cooldownRef = useRef(false);
  const cameraRef = useRef<CameraView>(null);
  const videoRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);

  // Fetch set list on mount
  useEffect(() => {
    setSetsLoading(true);
    fetchMtgSets()
      .then(sets => setSetList(sets))
      .catch(console.error)
      .finally(() => setSetsLoading(false));
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

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

  const handleOcrResult = useCallback(
    async (recognizedText: string) => {
      if (cooldownRef.current) return;
      if (!activeSession) {
        router.push("/session/new");
        return;
      }
      if (!selectedSet) return;

      const info = extractCardInfo(recognizedText);
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

        // 1. Try exact match by collector number if found
        if (info.collectorNumber) {
          const exactCard = await getCardBySetAndNumber(selectedSet.code, info.collectorNumber);
          if (exactCard) results = [exactCard];
        }

        // 2. Fallback to name search
        if (results.length === 0 && sanitizedName) {
          results = await searchCardByNameInSet(sanitizedName, selectedSet.code);
        }

        if (scanMode === "rapid") {
          if (results.length === 0) {
            // No match → open Review Scan modal
            setReviewEditText(sanitizedName);
            setReviewResults([]);
            setReviewModalVisible(true);
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
            // Low confidence → open Review Scan modal with pre-loaded results
            setReviewEditText(sanitizedName);
            setReviewResults(results);
            setReviewModalVisible(true);
          }
        } else {
          // Single mode: show result picker
          if (results.length === 0) {
            showToast("No match in set — try again");
            return;
          }
          if (autoScan) setAutoScan(false);
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
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingCard(null);
    // Put tapped card first so confirm screen shows it selected by default
    const reordered = [tappedCard, ...resultCandidates.filter(c => c.id !== tappedCard.id)];
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
    setRapidQueue(prev => [queued, ...prev]);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    triggerSuccessFlash();
  }, [triggerSuccessFlash]);

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

  const captureManual = async (silent = false) => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      if (Platform.OS === "web") {
        if (videoRef.current && canvasRef.current) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          const vW = video.videoWidth;
          const vH = video.videoHeight;
          const scale = Math.min(vW / SCREEN_WIDTH, vH / SCREEN_HEIGHT);
          const cropW = CARD_WIDTH * scale;
          const cardHCanvas = CARD_HEIGHT * scale;
          const topCropH = cardHCanvas * 0.15;
          const botCropH = cardHCanvas * 0.12;

          const sx = (vW - cropW) / 2;
          const sy = (vH - cardHCanvas) / 2;

          canvas.width = cropW;
          canvas.height = topCropH + botCropH;
          const ctx = canvas.getContext("2d");

          // Draw top (Card Name)
          ctx?.drawImage(video, sx, sy, cropW, topCropH, 0, 0, cropW, topCropH);
          // Draw bottom (Collector Info)
          ctx?.drawImage(video, sx, sy + cardHCanvas - botCropH, cropW, botCropH, 0, topCropH, cropW, botCropH);

          const base64Data = canvas.toDataURL("image/jpeg", 0.9);
          console.log("Starting Web OCR analysis on Cropped Image...");
          const worker = await Tesseract.createWorker("eng");
          const { data: { text } } = await worker.recognize(base64Data);
          await worker.terminate();
          console.log("OCR Text Extracted:\n", text);
          if (text.trim()) {
            await handleOcrResult(text);
          } else if (!silent) {
            if (window) window.alert("Could not read any text. Try getting closer or improving lighting.");
          }
        }
      } else {
        if (cameraRef.current) {
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          const photo = await cameraRef.current.takePictureAsync({ base64: true });
          if (photo?.uri) {
            console.log("Starting Native OCR analysis on Cropped Image...");
            const cropW = photo.width * 0.75;
            const cardH = cropW / CARD_RATIO;
            const originX = (photo.width - cropW) / 2;
            const originY = (photo.height - cardH) / 2;
            const cropped = await ImageManipulator.manipulateAsync(
              photo.uri,
              [{ crop: { originX, originY, width: cropW, height: cardH } }],
              { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
            );
            const worker = await Tesseract.createWorker("eng");
            const { data: { text } } = await worker.recognize(`data:image/jpeg;base64,${cropped.base64}`);
            await worker.terminate();
            console.log("OCR Text Extracted:\n", text);
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
  };

  // Continuous background scanner hook
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const performAutoScan = async () => {
      if (!autoScan || isProcessing || !scanning) {
        if (autoScan) timeoutId = setTimeout(performAutoScan, 1000);
        return;
      }
      await captureManual(true);
      timeoutId = setTimeout(performAutoScan, 2000);
    };
    if (autoScan) performAutoScan();
    return () => clearTimeout(timeoutId);
  }, [autoScan, isProcessing, scanning]);

  const filteredSets = setFilter.trim()
    ? setList.filter(s =>
        s.name.toLowerCase().includes(setFilter.toLowerCase()) ||
        s.code.toLowerCase().includes(setFilter.toLowerCase())
      )
    : setList;

  const queueTotalValue = rapidQueue.reduce((sum, c) => sum + (c.priceUsd ?? 0), 0);

  const isNativePermGranted = permission?.granted;
  const isWebPermGranted = webPermissionGranted;
  const isWeb = Platform.OS === "web";
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
            {filteredSets.map(s => (
              <Pressable
                key={s.code}
                style={styles.gateItem}
                onPress={() => {
                  setSelectedSet({ code: s.code, name: s.name });
                  setSetFilter("");
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
              </Pressable>
              <Pressable
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
            <View style={styles.cardFrame}>
              <View style={styles.targetBoxTop}>
                <Text style={styles.targetLabel}>Card Name</Text>
              </View>
              <View style={styles.targetBoxBottom}>
                <Text style={styles.targetLabel}>Collector #</Text>
              </View>
            </View>
            <View style={styles.overlayDim} />
          </View>
          <View style={[styles.overlayDim, { paddingTop: 20, alignItems: "center" }]}>
            <Text style={styles.frameHelper}>Webcams generally have fixed focus lenses.</Text>
            <Text style={styles.frameHelperSub}>Hold MTG card 8-12 inches away</Text>
          </View>
        </View>

        {/* Session Queue — Rapid Mode only */}
        {scanMode === "rapid" && (
          <View style={styles.queueSheet}>
            <Pressable style={styles.queueHeader} onPress={() => setQueueExpanded(q => !q)}>
              <View style={styles.queueHeaderLeft}>
                <Text style={styles.queueROI}>
                  ${queueTotalValue.toFixed(2)}
                </Text>
                <Text style={styles.queueCount}>
                  {rapidQueue.length === 0
                    ? "Queue empty — start scanning"
                    : `${rapidQueue.length} card${rapidQueue.length !== 1 ? "s" : ""} queued`}
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

            {queueExpanded && rapidQueue.length > 0 && (
              <ScrollView style={styles.queueList} showsVerticalScrollIndicator={false}>
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
              </ScrollView>
            )}
          </View>
        )}

        {/* Bottom Bar: Action Buttons */}
        <View style={styles.bottomBar}>
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.captureBtn, autoScan && styles.captureBtnActive, !canScan && styles.btnDisabled]}
              onPress={() => setAutoScan(!autoScan)}
              disabled={!canScan}
            >
              <Text style={styles.captureBtnText}>
                {autoScan ? "⏱ Auto-Scan: ON" : "⏱ Auto-Scan: OFF"}
              </Text>
            </Pressable>

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

      {/* ── Single-Mode Result Picker Modal ── */}
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
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 56, paddingBottom: 10, backgroundColor: "rgba(10,10,15,0.7)", zIndex: 10 },
  topBarTitle: { color: "#f0f0f8", fontSize: 18, fontWeight: "800" },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  flashBtn: { backgroundColor: "rgba(200,155,60,0.2)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: ACCENT },
  flashText: { color: ACCENT, fontWeight: "700", fontSize: 12 },

  // Mode toggle
  modeToggle: { flexDirection: "row", backgroundColor: "#12121a", borderRadius: 20, padding: 3, borderWidth: 1, borderColor: "#222233" },
  modeBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 17 },
  modeBtnActive: { backgroundColor: ACCENT },
  modeBtnRapid: { backgroundColor: RAPID },
  modeBtnText: { color: "#a0a0b8", fontWeight: "700", fontSize: 12 },
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
  overlayRow: { flexDirection: "row", height: CARD_HEIGHT },
  cardFrame: { width: CARD_WIDTH, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)", borderRadius: 12, justifyContent: "space-between" },
  targetBoxTop: { height: "15%", borderBottomWidth: 1, borderColor: "rgba(255,255,255,0.5)", borderStyle: "dashed", padding: 6 },
  targetBoxBottom: { height: "12%", borderTopWidth: 1, borderColor: "rgba(255,255,255,0.5)", borderStyle: "dashed", padding: 6, justifyContent: "flex-end" },
  targetLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
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
  resultCancelBtn: { margin: 16, paddingVertical: 14, alignItems: "center", borderTopWidth: 1, borderColor: "#222233" },
  resultCancelText: { color: "#606078", fontWeight: "600" },
});
