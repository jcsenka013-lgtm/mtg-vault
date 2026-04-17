
import React, { useMemo, useEffect, useState } from 'react';
import { View, Dimensions, StyleSheet, Pressable, Text } from 'react-native';
import {
  Canvas,
  Circle,
  Line,
  Group,
  Text as SkiaText,
  useFont,
  vec,
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
  
  // Font for labels
  const font = useFont(null, 12); // Use default font

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await getForensicGraphData();
        setData(result);
      } catch (err) {
        console.error("Failed to fetch graph data:", err);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!data) return;

    // Initialize simulation nodes with positions
    const nodes = data.nodes.map(n => ({ ...n, x: Math.random() * CANVAS_WIDTH, y: Math.random() * CANVAS_HEIGHT }));
    const links = data.links.map(l => ({ ...l }));

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2))
      .force("collision", d3.forceCollide().radius(30));

    simulation.on("tick", () => {
      setSimulationNodes([...nodes]);
      setSimulationLinks([...links]);
    });

    return () => simulation.stop();
  }, [data]);

  if (!data) return <View style={styles.loading}><Text style={styles.text}>Loading Meta Graph...</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Forensic Knowledge Graph</Text>
      <View style={styles.canvasContainer}>
        <Canvas style={{ flex: 1 }}>
          {/* Render Links */}
          {simulationLinks.map((link, index) => (
            <Line
              key={`link-${index}`}
              p1={vec(link.source.x, link.source.y)}
              p2={vec(link.target.x, link.target.y)}
              color="rgba(255, 255, 255, 0.2)"
              strokeWidth={1}
            />
          ))}

          {/* Render Nodes */}
          {simulationNodes.map((node, index) => (
            <Group key={`node-${index}`}>
              <Circle
                cx={node.x}
                cy={node.y}
                r={node.val}
                color={node.color || '#fff'}
              />
              {font && (
                <SkiaText
                  x={node.x + node.val + 5}
                  y={node.y + 5}
                  text={node.label}
                  font={font}
                  color="rgba(255, 255, 255, 0.7)"
                />
              )}
            </Group>
          ))}
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
};

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
