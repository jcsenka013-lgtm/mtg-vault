
import React from 'react';
import { Platform, Text, View, StyleSheet } from 'react-native';

// For Web, we need to load Skia dynamically
export const KnowledgeGraph = (props: any) => {
  if (Platform.OS === 'web') {
    const { WithSkiaWeb } = require("@shopify/react-native-skia/lib/module/web");
    return (
      <WithSkiaWeb
        getComponent={() => import("./KnowledgeGraphInternal")}
        fallback={
          <View style={styles.loading}>
            <Text style={styles.text}>Initializing Forge Visualization...</Text>
          </View>
        }
      />
    );
  }

  // For Native (iOS/Android), we can import and use directly
  const KnowledgeGraphInternal = require("./KnowledgeGraphInternal").default;
  return <KnowledgeGraphInternal {...props} />;
};

const styles = StyleSheet.create({
  loading: {
    height: 400,
    backgroundColor: '#050508',
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 10,
  },
  text: {
    color: '#D1B000',
    fontSize: 14,
    fontWeight: '600',
  }
});
