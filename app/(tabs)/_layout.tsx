import { Tabs } from "expo-router";
import { View, Text } from "react-native";

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: "#12121a",
          borderTopColor: "#2a1f0a",
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: "#c89b3c",
        tabBarInactiveTintColor: "#606078",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: "#12121a" },
        headerTintColor: "#f0f0f8",
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
