
import React, { useMemo, useEffect, useState } from 'react';
import { View, Dimensions, StyleSheet, Pressable, Text, ActivityIndicator } from 'react-native';
import {
  Canvas,
  Circle,
  Line,
  Group,
  Text as SkiaText,
  useFont,
  vec,
  Shadow,
} from '@shopify/react-native-skia';
import * as d3 from 'd3-force';
import { GraphNode, GraphLink, getForensicGraphData } from '../../db/graphQueries';

const { width: WINDOW_WIDTH, height: WINDOW_HEIGHT } = Dimensions.get('window');
const CANVAS_WIDTH = WINDOW_WIDTH;
const CANVAS_HEIGHT = 400;

export default function KnowledgeGraphInternal() {
  const [data, setData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [simulationNodes, setSimulationNodes] = useState<any[]>([]);
  const [simulationLinks, setSimulationLinks] = useState<any[]>([]);
  
  // Font for labels - using a more robust loading approach
  const font = useFont(null, 12); 

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await getForensicGraphData();
        console.log("Graph Data Fetched:", result.nodes.length, "nodes");
        setData(result);
      } catch (err) {
        console.error("Failed to fetch graph data:", err);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!data || data.nodes.length === 0) return;

    // Initialize simulation nodes with centered random positions
    const nodes = data.nodes.map(n => ({ 
      ...n, 
      x: (CANVAS_WIDTH / 2) + (Math.random() - 0.5) * 100, 
      y: (CANVAS_HEIGHT / 2) + (Math.random() - 0.5) * 100 
    }));
    const links = data.links.map(l => ({ ...l }));

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2))
      .force("collision", d3.forceCollide().radius(40));

    simulation.on("tick", () => {
      // Force refresh with new arrays to trigger Skia update
      setSimulationNodes([...nodes]);
      setSimulationLinks([...links]);
    });

    // Run a few ticks immediately to prevent (0,0) flicker
    for (let i = 0; i < 20; i++) simulation.tick();

    return () => simulation.stop();
  }, [data]);

  if (!data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#D1B000" />
        <Text style={styles.text}>Initializing Forge Visualization...</Text>
      </View>
    );
  }

  if (data.nodes.length === 0) {
    return (
      <View style={styles.loading}>
        <Text style={styles.text}>No meta data found to project.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Forensic Knowledge Graph</Text>
      <View style={styles.canvasContainer}>
        <Canvas style={{ flex: 1 }}>
          {/* Render Links */}
          {simulationLinks.map((link, index) => {
            // Safety check for D3 link expansion
            const x1 = typeof link.source === 'object' ? link.source.x : 0;
            const y1 = typeof link.source === 'object' ? link.source.y : 0;
            const x2 = typeof link.target === 'object' ? link.target.x : 0;
            const y2 = typeof link.target === 'object' ? link.target.y : 0;

            if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return null;

            return (
              <Line
                key={`link-${index}`}
                p1={vec(x1, y1)}
                p2={vec(x2, y2)}
                color="rgba(209, 176, 0, 0.15)"
                strokeWidth={1}
              />
            );
          })}

          {/* Render Nodes */}
          {simulationNodes.map((node, index) => {
            if (isNaN(node.x) || isNaN(node.y)) return null;

            return (
              <Group key={`node-${index}`}>
                <Circle
                  cx={node.x}
                  cy={node.y}
                  r={node.val || 10}
                  color={node.color || '#4A90E2'}
                >
                  {/* Outer Glow */}
                  <Shadow dx={0} dy={0} blur={10} color={node.color || '#4A90E2'} />
                </Circle>
                {font && (
                  <SkiaText
                    x={node.x + (node.val || 10) + 6}
                    y={node.y + 4}
                    text={node.label || ""}
                    font={font}
                    color="rgba(240, 240, 248, 0.8)"
                  />
                )}
              </Group>
            );
          })}
        </Canvas>
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendItem}>🟡 Season</Text>
        <Text style={styles.legendItem}>🔵 Player</Text>
        <Text style={styles.legendItem}>🟤 Archetype</Text>
        <Text style={styles.legendItem}>🟣 Vault Card</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#0a0a0f',
    borderRadius: 20,
    margin: 10,
    borderWidth: 1,
    borderColor: '#1a1a25',
  },
  title: {
    color: '#D1B000',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 15,
    textAlign: 'center',
    letterSpacing: 1.2,
  },
  canvasContainer: {
    height: CANVAS_HEIGHT,
    backgroundColor: '#050508',
    borderRadius: 15,
    overflow: 'hidden',
  },
  loading: {
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: '#555',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 15,
    gap: 10,
  },
  legendItem: {
    color: '#888',
    fontSize: 12,
  }
});
