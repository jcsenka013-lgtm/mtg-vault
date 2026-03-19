import "../global.css";
import { Stack, router, useSegments } from "expo-router";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuthStore } from "@store/authStore";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
    },
  },
});

export default function RootLayout() {
  const { session, isLoading } = useAuthStore();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;

    // Use string check for segments to avoid strict type mismatches in static analysis
    const inAuthGroup = (segments as any).includes("(auth)");

    if (!session && !inAuthGroup) {
      // Redirect to login if not authenticated
      router.replace("/login" as any);
    } else if (session && inAuthGroup) {
      // Redirect to tabs if authenticated and in auth group
      router.replace("/(tabs)" as any);
    }
  }, [session, segments, isLoading]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0a0a0f" }}>
      <QueryClientProvider client={queryClient}>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#12121a" },
            headerTintColor: "#f0f0f8",
            headerTitleStyle: { fontWeight: "700" },
            contentStyle: { backgroundColor: "#0a0a0f" },
          }}
        >
          <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="session/new"
            options={{ title: "New Opening", presentation: "modal" }}
          />
          <Stack.Screen
            name="manual-entry"
            options={{ title: "✏️ Manual Card Entry", presentation: "modal" }}
          />
          <Stack.Screen
            name="session/[id]"
            options={{ title: "Session Details" }}
          />
          <Stack.Screen
            name="card/[id]"
            options={{ title: "Card Details" }}
          />
          <Stack.Screen
            name="confirm"
            options={{
              title: "Confirm Card",
              presentation: "modal",
              gestureEnabled: false,
            }}
          />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
