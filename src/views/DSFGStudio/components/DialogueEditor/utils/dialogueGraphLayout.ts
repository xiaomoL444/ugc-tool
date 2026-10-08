import { graphlib, layout } from "@dagrejs/dagre";
import type { FlowLayout } from "../types/FileStruct";

export type GraphNodeSize = { width: number; height: number };

/** Dagre returns node centres; Vue Flow stores their top-left corners. */
export function layoutDialogueGraph(
  graph: FlowLayout,
  measured: ReadonlyMap<string, GraphNodeSize> = new Map(),
  outletOrder: ReadonlyMap<string, readonly string[]> = new Map(),
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
  // Dagre otherwise sees every edge at the node centre and may reverse siblings.
  // In LR layouts, its left/right ordering constraints become top/bottom order.
  const constraints: { left: string; right: string }[] = [];
  const successors = new Map<string, Set<string>>();
  function reaches(from: string, target: string) {
    const pending = [from];
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === target) return true;
      if (visited.has(id)) continue;
      visited.add(id);
      pending.push(...(successors.get(id) ?? []));
    }
    return false;
  }
  for (const node of graph.nodes) {
    if (!dagre.hasNode(node.id)) continue;
    const handles = outletOrder.get(node.id);
    if (!handles || handles.length < 2) continue;
    const edges = graph.edges.filter(edge => !edge.hidden && edge.source === node.id
      && edge.target !== node.id && dagre.hasNode(edge.target));
    const targets = [...new Set(handles.flatMap(handle => edges
      .filter(edge => (edge.sourceHandle ?? "next") === handle).map(edge => edge.target)))];
    for (let i = 1; i < targets.length; i++) {
      const left = targets[i - 1], right = targets[i];
      // Shared targets can request contradictory orders. Keep earlier constraints
      // instead of giving Dagre a cyclic ordering graph (which loses nodes).
      if (reaches(right, left) || successors.get(left)?.has(right)) continue;
      if (!successors.has(left)) successors.set(left, new Set());
      successors.get(left)!.add(right);
      constraints.push({ left, right });
    }
  }
  layout(dagre, { constraints });
  return graph.nodes.map((node) => {
    const position = dagre.node(node.id);
    return position ? { ...node, position: { x: position.x - position.width / 2, y: position.y - position.height / 2 } } : node;
  });
}
