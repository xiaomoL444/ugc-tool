import { graphlib, layout } from "@dagrejs/dagre";
import type { FlowLayout } from "../types/FileStruct";

export type GraphNodeSize = { width: number; height: number };

/** Dagre returns node centres; Vue Flow stores their top-left corners. */
export function layoutDialogueGraph(
  graph: FlowLayout,
  measured: ReadonlyMap<string, GraphNodeSize> = new Map(),
): FlowLayout["nodes"] {
  const dagre = new graphlib.Graph({ multigraph: true });
  dagre.setGraph({ rankdir: "LR", ranksep: 110, nodesep: 64, edgesep: 24, marginx: 40, marginy: 40 });
  dagre.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) {
    if (node.hidden) continue;
    const size = measured.get(node.id);
    const fallback = node.type === "entry" ? { width: 114, height: 46 }
      : node.type === "condition" ? { width: 302, height: 240 } : { width: 252, height: 180 };
    dagre.setNode(node.id, {
      width: size && Number.isFinite(size.width) && size.width > 0 ? size.width : fallback.width,
      height: size && Number.isFinite(size.height) && size.height > 0 ? size.height : fallback.height,
    });
  }
  for (const edge of graph.edges) {
    if (!edge.hidden && dagre.hasNode(edge.source) && dagre.hasNode(edge.target)) {
      dagre.setEdge(edge.source, edge.target, {}, edge.id);
    }
  }
  if (!dagre.nodeCount()) return graph.nodes;
  layout(dagre);
  return graph.nodes.map((node) => {
    const position = dagre.node(node.id);
    return position ? { ...node, position: { x: position.x - position.width / 2, y: position.y - position.height / 2 } } : node;
  });
}
