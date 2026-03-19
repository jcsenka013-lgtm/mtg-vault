import { Tabs } from "expo-router";
import { View, Text } from "react-native";
import { useAppStore } from "@/store/appStore";
import { themes } from "@/theme";

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
    </View>
  );
}

export default function TabsLayout() {
  const { activeTheme } = useAppStore();
  const t = themes[activeTheme];

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.border + "88",
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerTitleStyle: { fontWeight: "800", fontSize: 18 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Collection",
          headerTitle: "✦ The Vault",
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="scanner"
        options={{
          title: "Scry",
          headerTitle: "👁 Scry Glass",
          headerShown: false,
          tabBarIcon: ({ focused }) => <TabIcon emoji="👁" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Library",
          headerTitle: "📚 Library",
          tabBarIcon: ({ focused }) => <TabIcon emoji="📚" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="export"
        options={{
          title: "Share",
          headerTitle: "⚡ Export List",
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚡" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
