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
} from "react-native";
import { supabase } from "@/lib/supabase";
import { router } from "expo-router";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  async function handleAuth() {
    if (!email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        Alert.alert("Success", "Check your email for the confirmation link!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.replace("/(tabs)");
      }
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.logoEmoji}>🛡️</Text>
          <Text style={styles.title}>The Vault</Text>
          <Text style={styles.subtitle}>
            {isSignUp ? "Create your Planeswalker account" : "Welcome back, Planeswalker"}
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>Email address</Text>
            <TextInput
              style={styles.input}
              placeholder="jace.beleren@ravnica.com"
              placeholderTextColor="#606078"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#606078"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
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
              <Text style={styles.authButtonText}>
                {isSignUp ? "Begin Your Journey" : "Enter The Vault"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setIsSignUp(!isSignUp)}
          >
            <Text style={styles.toggleText}>
              {isSignUp
                ? "Already have an account? Log in"
                : "New here? Create an account"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Built with Magic in mind.</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0f",
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
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  subtitle: {
    color: "#a0a0b8",
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
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
  toggleButton: {
    alignItems: "center",
    marginTop: 10,
  },
  toggleText: {
    color: "#a0a0b8",
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 24,
    right: 24,
    alignItems: "center",
  },
  footerText: {
    color: "#404050",
    fontSize: 12,
    fontStyle: "italic",
  },
});
