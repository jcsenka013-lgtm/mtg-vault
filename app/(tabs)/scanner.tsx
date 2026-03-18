import { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { CameraView, useCameraPermissions, CameraType } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useAppStore } from "@store/appStore";
import { searchCardByName } from "@api/scryfall";
import type { ScryfallCard } from "@mtgtypes/index";

// Regex patterns for OCR text extraction
const COLLECTOR_PATTERN = /(\d{1,4})\s*\/\s*(\d{1,4})/;
const SET_CODE_PATTERN = /\b([A-Z]{3,5})\b/g;

function extractCardInfo(text: string): { name: string; collectorNumber?: string } | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Best candidate: longest line that looks like a card name (title case, 3-50 chars)
  const nameLine = lines.find(
    (l) => l.length >= 3 && l.length <= 50 && /^[A-Z][a-zA-Z,' -]+$/.test(l)
  );

  const collectorMatch = text.match(COLLECTOR_PATTERN);

  if (!nameLine) return null;
  return {
    name: nameLine,
    collectorNumber: collectorMatch ? collectorMatch[1] : undefined,
  };
}

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const { activeSession, setPendingCard } = useAppStore();
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const cooldownRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      setScanning(true);
      return () => setScanning(false);
    }, [])
  );

  const handleOcrResult = useCallback(
    async (recognizedText: string) => {
      if (cooldownRef.current) return;
      if (!activeSession) {
        router.push("/session/new");
        return;
      }

      const info = extractCardInfo(recognizedText);
      if (!info || info.name === lastScanned) return;

      cooldownRef.current = true;
      setLastScanned(info.name);

      try {
        const results = await searchCardByName(info.name);
        if (results.length > 0) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          setPendingCard(null); // will be set on confirm screen
          router.push({ pathname: "/confirm", params: { candidates: JSON.stringify(results), sessionId: activeSession.id } });
        }
      } catch (e) {
        console.error("Scryfall search error:", e);
      } finally {
        // Reset cooldown after 3s
        setTimeout(() => {
          cooldownRef.current = false;
        }, 3000);
      }
    },
    [activeSession, lastScanned, setPendingCard]
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Checking camera permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>📷</Text>
        <Text style={styles.permTitle}>Camera Access Needed</Text>
        <Text style={styles.permSubtitle}>
          MTG Scanner needs the camera to scan cards.
        </Text>
        <Pressable style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera */}
      {scanning && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          flash={flash ? "on" : "off"}
          onBarcodeScanned={undefined}
        />
      )}

      {/* Overlay */}
      <View style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.topBarTitle}>🔍 Scan Card</Text>
          <Pressable onPress={() => setFlash((f) => !f)} style={styles.flashBtn}>
            <Text style={styles.flashText}>{flash ? "⚡ On" : "⚡ Off"}</Text>
          </Pressable>
        </View>

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

        {/* Scan frame */}
        <View style={styles.frameWrapper}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.frameTip}>Point at the card name</Text>
        </View>

        {/* Manual search button */}
        <View style={styles.bottomBar}>
          <Pressable
            style={styles.manualBtn}
            onPress={() =>
              router.push({
                pathname: "/confirm",
                params: { manual: "true", sessionId: activeSession?.id ?? "" },
              })
            }
          >
            <Text style={styles.manualBtnText}>🔤 Search Manually</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const ACCENT = "#c89b3c";
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
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12, backgroundColor: "rgba(10,10,15,0.7)" },
  topBarTitle: { color: "#f0f0f8", fontSize: 20, fontWeight: "800" },
  flashBtn: { backgroundColor: "rgba(200,155,60,0.2)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: ACCENT },
  flashText: { color: ACCENT, fontWeight: "700", fontSize: 13 },
  sessionBadge: { alignSelf: "center", backgroundColor: "rgba(10,10,15,0.8)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: "#222233" },
  sessionBadgeText: { color: "#a0a0b8", fontSize: 13, fontWeight: "600" },
  noSessionBanner: { flexDirection: "row", alignSelf: "center", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.15)", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: "#ef4444" },
  noSessionText: { color: "#ef4444", fontWeight: "600" },
  noSessionLink: { color: ACCENT, fontWeight: "700" },
  frameWrapper: { alignItems: "center" },
  frame: { width: 280, height: 180, position: "relative", marginBottom: 12 },
  corner: { position: "absolute", width: 24, height: 24, borderColor: ACCENT, borderWidth: 3 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  frameTip: { color: "rgba(160,160,184,0.7)", fontSize: 13 },
  bottomBar: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16, backgroundColor: "rgba(10,10,15,0.8)", alignItems: "center" },
  manualBtn: { backgroundColor: "#12121a", borderRadius: 24, paddingHorizontal: 28, paddingVertical: 14, borderWidth: 1, borderColor: "#222233" },
  manualBtnText: { color: "#f0f0f8", fontWeight: "700", fontSize: 15 },
});
