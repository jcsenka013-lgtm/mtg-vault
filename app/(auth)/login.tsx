import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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

  async function handleAuth() {
    if (!selectedUser || !password) {
      Alert.alert("Error", "Please provide the password for this account.");
      return;
    }

    setLoading(true);
    try {
      // Always sign in, sign up is removed for security
      const { error } = await supabase.auth.signInWithPassword({
        email: selectedUser.email,
        password,
      });
      if (error) throw error;
      router.replace("/(tabs)");
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  }

  if (!selectedUser) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.logoEmoji}>🛡️</Text>
          <Text style={styles.title}>The Vault</Text>
          <Text style={styles.subtitle}>Select your identity</Text>
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
    );
  }

  return (
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
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0f",
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
  },
  subtitle: {
    color: "#a0a0b8",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  grid: {
    padding: 24,
    gap: 12,
  },
  userCard: {
    backgroundColor: "#12121a",
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: "#222233",
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
    backgroundColor: "#12121a",
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
    shadowOpacity: 0.3,
    shadowRadius: 8,
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
