import { useState, useEffect } from "react";
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Platform,
    Pressable,
} from "react-native";
import { router } from "expo-router";
import { supabase } from "@/lib/supabase";

export default function SettingsScreen() {
    const [isLoading, setIsLoading] = useState(true);
    const [isConnected, setIsConnected] = useState(false);
    const [user, setUser] = useState<any>(null);

    useEffect(() => {
        fetchUserData();
    }, []);

    const fetchUserData = async () => {
        setIsLoading(true);
        try {
            const { data: authResponse, error: authError } = await supabase.auth.getUser();
            if (authError) throw authError;

            setUser(authResponse?.user);

            if (authResponse?.user) {
                const { data, error } = await supabase
                    .from("ebay_tokens")
                    .select("*")
                    .eq("user_id", authResponse.user.id)
                    .single();

                if (error) {
                    if (error.code === "P2002" && error.message.includes("duplicate")) {
                        setIsConnected(false);
                    } else {
                        console.error("Error checking eBay tokens:", error);
                        setIsConnected(false);
                    }
                } else {
                    const now = Math.floor(Date.now() / 1000);
                    if (data.ebay_expires_at > now) {
                        setIsConnected(true);
                    } else {
                        setIsConnected(false);
                    }
                }
            } else {
                setIsConnected(false);
            }
        } catch (error) {
            console.error("Failed to load user data:", error);
            setIsConnected(false);
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnectEbay = async () => {
        if (!user) return;

        try {
            const { data, error } = await supabase.functions.invoke("ebay-auth", {
                body: { userId: user.id },
            });

            if (error) throw error;

            if (Platform.OS === "web" && data?.url) {
                window.location.href = data.url;
            }
        } catch (error) {
            console.error("Ebay connection failed:", error);
            Alert.alert("Connection Failed", "Failed to connect to eBay. Please try again.");
        }
    };

    if (isLoading) {
        return (
            <View style={styles.container}>
                <ActivityIndicator size="large" color="#c89b3c" />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.profileHeader}>
                <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{user?.email?.charAt(0) || "U"}</Text>
                </View>
                <View style={styles.profileInfo}>
                    <Text style={styles.profileName}>{user?.email || "Guest"}</Text>
                    <Text style={styles.profileEmail}>{user?.user_metadata?.name || ""}</Text>
                </View>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>eBay Integration</Text>
                <View style={styles.statusCard}>
                    <Text style={styles.statusText}>
                        {isConnected
                            ? "✅ Your eBay account is connected and authenticated"
                            : "🔌 Not connected to eBay"}
                    </Text>
                    {isConnected && (
                        <View style={styles.badge}>
                            <Text style={styles.badgeText}>Connected</Text>
                        </View>
                    )}
                </View>
                <Pressable
                    style={[styles.connectButton, !isConnected && styles.connectButtonEnabled]}
                    onPress={handleConnectEbay}
                    disabled={isConnected || isLoading}
                >
                    {!isConnected ? (
                        <>
                            <Text style={styles.connectButtonText}>Connect to eBay</Text>
                            <Text style={styles.connectButtonSubtext}>Authorize to list bundles</Text>
                        </>
                    ) : (
                        <Text style={styles.connectButtonText}>Disconnect eBay</Text>
                    )}
                </Pressable>
            </View>

            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Appearance</Text>
                <Pressable style={styles.settingItem}>
                    <Text style={styles.settingText}>Change Theme Color</Text>
                    <Text style={styles.settingIcon}>↻</Text>
                </Pressable>
                <Pressable style={styles.settingItem}>
                    <Text style={styles.settingText}>Notification Preferences</Text>
                    <Text style={styles.settingIcon}>→</Text>
                </Pressable>
            </View>

        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: "#0a0a0f",
        padding: 20,
    },
    profileHeader: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 30,
        padding: 20,
        backgroundColor: "rgba(18, 18, 26, 0.8)",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#222233",
    },
    avatar: {
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: "#c89b3c",
        alignItems: "center",
        justifyContent: "center",
        marginRight: 16,
    },
    avatarText: {
        fontSize: 28,
        fontWeight: "bold",
        color: "#0a0a0f",
    },
    profileInfo: {
        flex: 1,
    },
    profileName: {
        fontSize: 18,
        fontWeight: "600",
        color: "#f0f0f8",
        marginBottom: 4,
    },
    profileEmail: {
        fontSize: 14,
        color: "#a0a0b8",
    },
    section: {
        marginBottom: 28,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: "700",
        color: "#c89b3c",
        marginBottom: 16,
        letterSpacing: 0.5,
    },
    statusCard: {
        backgroundColor: "rgba(18, 18, 26, 0.8)",
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    statusText: {
        fontSize: 15,
        color: "#f0f0f8",
        flex: 1,
    },
    badge: {
        backgroundColor: "#22c55e",
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 4,
        marginLeft: 12,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: "700",
        color: "#0a0a0f",
    },
    connectButton: {
        backgroundColor: "#1a1a26",
        borderRadius: 12,
        padding: 16,
        alignItems: "center",
        borderWidth: 1,
        borderColor: "#222233",
        opacity: 0.7,
    },
    connectButtonEnabled: {
        backgroundColor: "#c89b3c",
        borderColor: "#c89b3c",
        opacity: 1,
    },
    connectButtonText: {
        fontSize: 16,
        fontWeight: "700",
        color: "#f0f0f8",
        marginBottom: 4,
    },
    connectButtonSubtext: {
        fontSize: 12,
        color: "#a0a0b8",
    },
    settingItem: {
        backgroundColor: "rgba(18, 18, 26, 0.8)",
        borderRadius: 10,
        padding: 16,
        marginBottom: 8,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    settingText: {
        fontSize: 15,
        color: "#f0f0f8",
    },
    settingIcon: {
        fontSize: 18,
        color: "#606078",
    },
});