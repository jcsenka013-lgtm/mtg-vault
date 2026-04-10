import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ImageBackground,
  Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";

// ── Playgroup identity quick-select (Step 1) ─────────────────────────────────
const PLAYGROUP = [
  { name: "JC",      emoji: "⚔️" },
  { name: "Leslie",  emoji: "🌿" },
  { name: "Richard", emoji: "💀" },
  { name: "Ben",     emoji: "🔥" },
  { name: "Geoff",   emoji: "💧" },
  { name: "Garrett", emoji: "☀️" },
];

// Email helper so users don't type raw @cole.tech
const toEmail = (name: string) => `${name.toLowerCase()}@cole.tech`;

type Mode = "select" | "signin" | "signup";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>("select");
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // Form fields
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isNewAccount, setIsNewAccount] = useState(false);

  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  // ── Step 1: Select identity from playgroup grid ──────────────────────────
  const handleSelectPlayer = (name: string) => {
    setSelectedName(name);
    setEmail(toEmail(name));
    setDisplayName(name);
    setIsNewAccount(false);
    setError("");
    setMode("signin");
  };

  const handleGuestMode = () => {
    setSelectedName(null);
    setEmail("");
    setDisplayName("");
    setPassword("");
    setError("");
    setMode("signup");
    setIsNewAccount(true);
  };

  // ── Auth action ───────────────────────────────────────────────────────────
  const handleAuth = async () => {
    setError("");
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedName = displayName.trim();

    if (!trimmedEmail || !trimmedPassword) {
      setError("Please enter both email and password.");
      return;
    }
    if (isNewAccount && !trimmedName) {
      setError("Please enter a display name so your tournament record can be linked.");
      return;
    }

    setLoading(true);
    try {
      if (isNewAccount) {
        // Sign up — pass display_name in metadata so the DB trigger can link
        // the new auth user to the existing seeded `players` row.
        const { error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: trimmedPassword,
          options: {
            data: { display_name: trimmedName },
          },
        });
        if (signUpError) throw signUpError;

        // Auto sign-in after signup (email confirm disabled for local dev)
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPassword,
        });
        if (signInError) {
          // Account was created but needs email confirmation
          setError("Account created! Check your email to confirm, then sign in.");
          setIsNewAccount(false);
          return;
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPassword,
        });
        if (signInError) throw signInError;
      }

      router.replace("/(tabs)");
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Invalid login credentials")) {
        setError("Wrong password. Try again, or create an account.");
      } else if (msg.includes("Email not confirmed")) {
        setError("Check your email and click the confirmation link first.");
      } else if (msg.includes("User already registered")) {
        setError("This email already has an account. Sign in instead.");
        setIsNewAccount(false);
      } else {
        setError(msg || "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Render: Identity picker ───────────────────────────────────────────────
  if (mode === "select") {
    return (
      <ImageBackground
        source={require("../../assets/bg-planeswalkers.jpg")}
        style={styles.bg}
        resizeMode="cover"
      >
        <View style={styles.overlay} />
        <View style={[styles.selContainer, { paddingTop: Math.max(insets.top + 16, 48) }]}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.logoEmoji}>🛡️</Text>
            <Text style={styles.title}>The Vault</Text>
            <Text style={styles.subtitle}>Select your identity, Planeswalker</Text>
          </View>

          {/* Playgroup grid */}
          <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
            {PLAYGROUP.map((p) => (
              <TouchableOpacity
                key={p.name}
                style={styles.playerCard}
                onPress={() => handleSelectPlayer(p.name)}
                activeOpacity={0.75}
              >
                <Text style={styles.playerEmoji}>{p.emoji}</Text>
                <Text style={styles.playerName}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Guest / new member option */}
          <Pressable style={styles.guestBtn} onPress={handleGuestMode}>
            <Text style={styles.guestText}>🆕  New member / join with custom email</Text>
          </Pressable>

        </View>
      </ImageBackground>
    );
  }

  // ── Render: Sign-in / Sign-up form ────────────────────────────────────────
  return (
    <ImageBackground
      source={require("../../assets/bg-planeswalkers.jpg")}
      style={styles.bg}
      resizeMode="cover"
    >
      <View style={styles.overlay} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            styles.formScroll,
            { paddingTop: Math.max(insets.top + 16, 48), paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back */}
          <Pressable style={styles.backBtn} onPress={() => { setMode("select"); setError(""); }}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.logoEmoji}>🛡️</Text>
            <Text style={styles.title}>
              {selectedName ? `Welcome, ${selectedName}` : "Join The Vault"}
            </Text>
            <Text style={styles.subtitle}>
              {isNewAccount
                ? "Create your account to join the playgroup"
                : "Enter your password to unlock the Vault"}
            </Text>
          </View>

          {/* Sign-in / Sign-up toggle */}
          <View style={styles.toggleRow}>
            <Pressable
              style={[styles.toggleBtn, !isNewAccount && styles.toggleBtnActive]}
              onPress={() => { setIsNewAccount(false); setError(""); }}
            >
              <Text style={[styles.toggleText, !isNewAccount && styles.toggleTextActive]}>
                Sign In
              </Text>
            </Pressable>
            <Pressable
              style={[styles.toggleBtn, isNewAccount && styles.toggleBtnActive]}
              onPress={() => { setIsNewAccount(true); setError(""); }}
            >
              <Text style={[styles.toggleText, isNewAccount && styles.toggleTextActive]}>
                Create Account
              </Text>
            </Pressable>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Display name — only shown when creating an account */}
            {isNewAccount && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Display Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Geoff"
                  placeholderTextColor="#606078"
                  value={displayName}
                  onChangeText={setDisplayName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
                <Text style={styles.hint}>
                  ⚡ Use your playgroup name (JC, Leslie, etc.) to auto-link your tournament history.
                </Text>
              </View>
            )}

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#606078"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#606078"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleAuth}
              />
            </View>

            {/* Error message */}
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Primary CTA */}
            <TouchableOpacity
              style={[styles.ctaBtn, loading && styles.ctaBtnDisabled]}
              onPress={handleAuth}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#0a0a0f" />
              ) : (
                <Text style={styles.ctaText}>
                  {isNewAccount ? "Join the Playgroup 🎴" : "Unlock Vault 🔓"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,5,12,0.75)" },

  // ── Select screen
  selContainer: { flex: 1, paddingHorizontal: 24 },
  header: { alignItems: "center", marginBottom: 32 },
  logoEmoji: { fontSize: 60, marginBottom: 12 },
  title: {
    color: "#f0f0f8", fontSize: 30, fontWeight: "900", letterSpacing: 1.5,
    textTransform: "uppercase",
    textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
  },
  subtitle: {
    color: "#c89b3c", fontSize: 14, fontWeight: "600", marginTop: 8, textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  grid: {
    flexDirection: "row", flexWrap: "wrap", gap: 12,
    justifyContent: "center", paddingBottom: 16,
  },
  playerCard: {
    width: "44%", backgroundColor: "rgba(18,18,26,0.88)",
    borderRadius: 16, paddingVertical: 20, paddingHorizontal: 12,
    alignItems: "center", borderWidth: 1, borderColor: "rgba(200,155,60,0.35)",
  },
  playerEmoji: { fontSize: 32, marginBottom: 8 },
  playerName: { color: "#c89b3c", fontSize: 17, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
  guestBtn: {
    marginTop: 8, marginBottom: 24, paddingVertical: 14, alignItems: "center",
    borderRadius: 12, borderWidth: 1, borderColor: "#333345",
  },
  guestText: { color: "#a0a0b8", fontSize: 14, fontWeight: "600" },

  // ── Form screen
  formScroll: { flexGrow: 1, paddingHorizontal: 24 },
  backBtn: { marginBottom: 16 },
  backText: { color: "#a0a0b8", fontSize: 15, fontWeight: "600" },

  toggleRow: { flexDirection: "row", backgroundColor: "#12121a", borderRadius: 12, padding: 4, marginBottom: 28, borderWidth: 1, borderColor: "#222233" },
  toggleBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  toggleBtnActive: { backgroundColor: "#1e1a10" },
  toggleText: { color: "#606078", fontSize: 14, fontWeight: "700" },
  toggleTextActive: { color: "#c89b3c" },

  form: { gap: 20 },
  fieldGroup: { gap: 6 },
  label: { color: "#c89b3c", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  input: {
    backgroundColor: "rgba(18,18,26,0.92)", borderRadius: 12, padding: 16,
    color: "#f0f0f8", borderWidth: 1, borderColor: "#222233", fontSize: 16,
  },
  hint: { color: "#606078", fontSize: 12, lineHeight: 16, marginTop: 2 },

  errorBox: {
    backgroundColor: "rgba(239,68,68,0.12)", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "rgba(239,68,68,0.3)",
  },
  errorText: { color: "#fca5a5", fontSize: 14, fontWeight: "600", textAlign: "center" },

  ctaBtn: {
    backgroundColor: "#c89b3c", borderRadius: 14, paddingVertical: 18,
    alignItems: "center", marginTop: 4,
    shadowColor: "#c89b3c", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 14, elevation: 6,
  },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaText: { color: "#0a0a0f", fontSize: 17, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1 },
});
