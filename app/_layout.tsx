import "../global.css";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 2,
    },
  },
});

export default function RootLayout() {

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
