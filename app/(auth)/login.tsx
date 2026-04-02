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
} from "react-native";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";

const ALLOWED_USERS = [
  { name: "JC", email: "jc@cole.tech" },
  { name: "Leslie", email: "leslie@cole.tech" },
  { name: "Ben", email: "ben@cole.tech" },
  { name: "Richard", email: "richard@cole.tech" },
  { name: "Garrett", email: "garrett@cole.tech" },
  { name: "Brian", email: "brian@cole.tech" },
  { name: "Geoff", email: "geoff@cole.tech" },
  { name: "Guest", email: "guest@cole.tech" },
];

export default function LoginScreen() {
  const [selectedUser, setSelectedUser] = useState<typeof ALLOWED_USERS[0] | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleAuth() {
    setErrorMessage("");
    try {
      if (!selectedUser || !password) {
        setErrorMessage("Please provide the password for this account.");
        return;
      }
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: selectedUser.email,
        password,
      });
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          throw new Error("Incorrect password. Please try again.");
        }
        if (error.message.includes("Email not confirmed")) {
          throw new Error("Your account is waiting to be confirmed. JC needs to click 'Confirm' on your user.");
        }
        throw error;
      }
      router.replace("/(tabs)");
    } catch (error: any) {
      setErrorMessage(error?.message || "An unexpected error occurred during login.");
    } finally {
      setLoading(false);
    }
  }

  if (!selectedUser) {
    return (
      <ImageBackground
        source={require("../../assets/bg-planeswalkers.jpg")}
        style={styles.bgImage}
        resizeMode="cover"
      >
        <View style={styles.overlay} />
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.logoEmoji}>🛡️</Text>
            <Text style={styles.title}>The Vault</Text>
            <Text style={styles.subtitle}>Select your identity, Planeswalker</Text>
          </View>

          <ScrollView contentContainerStyle={styles.grid}>
            {ALLOWED_USERS.map((user) => (
              <TouchableOpacity
                key={user.name}
                style={styles.userCard}
                onPress={() => setSelectedUser(user)}
              >
                <Text style={styles.userCardText}>{user.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground
      source={require("../../assets/bg-planeswalkers.jpg")}
      style={styles.bgImage}
      resizeMode="cover"
    >
      <View style={styles.overlay} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.container}
      >
        <View style={styles.content}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setSelectedUser(null)}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.logoEmoji}>🛡️</Text>
            <Text style={styles.title}>Welcome, {selectedUser.name}</Text>
            <Text style={styles.subtitle}>Enter your password to unlock the Vault</Text>
          </View>

          <View style={styles.form}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                placeholderTextColor="#606078"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoFocus
                onSubmitEditing={handleAuth}
              />
            </View>

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.authButton}
              onPress={handleAuth}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#0a0a0f" />
              ) : (
                <Text style={styles.authButtonText}>Enter The Vault</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bgImage: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 10, 15, 0.72)",
  },
  container: {
    flex: 1,
    paddingTop: 60,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    marginBottom: 40,
  },
  logoEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    color: "#f0f0f8",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  subtitle: {
    color: "#c89b3c",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
    fontWeight: "600",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  errorBox: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "#ef4444",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    textAlign: "center",
    fontWeight: "600",
  },
  grid: {
    padding: 24,
    gap: 12,
  },
  userCard: {
    backgroundColor: "rgba(18, 18, 26, 0.85)",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(200, 155, 60, 0.4)",
    alignItems: "center",
  },
  userCardText: {
    color: "#c89b3c",
    fontSize: 18,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  backBtn: {
    position: "absolute",
    top: 0,
    left: 24,
  },
  backBtnText: {
    color: "#a0a0b8",
    fontSize: 16,
    fontWeight: "600",
  },
  form: {
    gap: 20,
  },
  inputContainer: {
    gap: 8,
  },
  label: {
    color: "#c89b3c",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  input: {
    backgroundColor: "rgba(18, 18, 26, 0.9)",
    borderRadius: 12,
    padding: 16,
    color: "#f0f0f8",
    borderWidth: 1,
    borderColor: "#222233",
    fontSize: 16,
  },
  authButton: {
    backgroundColor: "#c89b3c",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#c89b3c",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 5,
  },
  authButtonText: {
    color: "#0a0a0f",
    fontSize: 16,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
});
