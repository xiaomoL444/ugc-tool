import type { DialogueTextPreview } from "./dialogueTextPreview";

export interface TextPreviewLayout {
  width: number;
  height: number;
  blocks: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  edges: Array<{ id: string; path: string; isReturn: boolean; labelX: number; labelY: number }>;
}

const BLOCK_WIDTH = 380;
const DEFAULT_HEIGHT = 160;
const COLUMN_GAP = 72;
const ROW_GAP = 128;
const COMPONENT_GAP = 80;
const PADDING = 64;
const SIDE_GAP = 32;
const SIDE_LANE_GAP = 24;

type PreviewBlock = DialogueTextPreview["blocks"][number];
type PreviewEdge = DialogueTextPreview["edges"][number];
type PositionedBlock = TextPreviewLayout["blocks"][number];

interface Layer {
  blocks: PreviewBlock[];
  component: number;
  top: number;
  bottom: number;
}

/**
 * A read-only projection: positions never feed back into the editable node graph.
 * DFS removes only cycle-closing edges for ranking; every edge is still rendered.
 * Long and returning edges travel outside the card columns, not through text.
 */
export function layoutDialogueTextPreview(
  preview: DialogueTextPreview,
  heights: Readonly<Record<string, number>> = {},
): TextPreviewLayout {
  if (!preview.blocks.length) return { width: BLOCK_WIDTH + PADDING * 2, height: PADDING * 2, blocks: [], edges: [] };

  const byId = new Map(preview.blocks.map((block) => [block.id, block]));
  const edges = preview.edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  const order = new Map(preview.blocks.map((block, index) => [block.id, index]));
  const outgoing = new Map<string, PreviewEdge[]>();
  const neighbors = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  for (const block of preview.blocks) {
    outgoing.set(block.id, []);
    neighbors.set(block.id, []);
    incomingCount.set(block.id, 0);
  }
  for (const edge of edges) {
    outgoing.get(edge.source)!.push(edge);
    // Unreachable conversations get their own lower section, even when an
    // unconnected fragment eventually jumps back into a reachable conversation.
    if (byId.get(edge.source)!.reachable === byId.get(edge.target)!.reachable) {
      neighbors.get(edge.source)!.push(edge.target);
      neighbors.get(edge.target)!.push(edge.source);
      incomingCount.set(edge.target, incomingCount.get(edge.target)! + 1);
    }
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.outletIndex - b.outletIndex);

  const components: PreviewBlock[][] = [];
  const visited = new Set<string>();
  for (const block of preview.blocks) {
    if (visited.has(block.id)) continue;
    const pending = [block.id];
    const component: PreviewBlock[] = [];
    visited.add(block.id);
    for (let index = 0; index < pending.length; index += 1) {
      const id = pending[index];
      component.push(byId.get(id)!);
      for (const neighbor of neighbors.get(id)!) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    component.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    components.push(component);
  }
  const priority = (component: PreviewBlock[]) => component.some((block) => block.kind === "entry") ? 0 : component[0].reachable ? 1 : 2;
  components.sort((a, b) => priority(a) - priority(b) || order.get(a[0].id)! - order.get(b[0].id)!);

  const cycleEdges = new Set<PreviewEdge>();
  const layers: Layer[] = [];
  const layerById = new Map<string, Layer>();
  const heightOf = (id: string) => Number.isFinite(heights[id]) && heights[id] > 0 ? heights[id] : DEFAULT_HEIGHT;
  let nextY = PADDING;
  let widestRow = BLOCK_WIDTH;

  components.forEach((component, componentIndex) => {
    const componentIds = new Set(component.map((block) => block.id));
    const localOutgoing = new Map(component.map((block) => [block.id, outgoing.get(block.id)!.filter((edge) => componentIds.has(edge.target))]));
    const rootPriority = (block: PreviewBlock) => block.kind === "entry" ? 0 : incomingCount.get(block.id) === 0 ? 1 : 2;
    const roots = [...component].sort((a, b) => rootPriority(a) - rootPriority(b) || order.get(a.id)! - order.get(b.id)!);
    const colors = new Map<string, number>();
    const preorder = new Map<string, number>();

    // Iterative DFS also works for conversations with thousands of blocks.
    for (const root of roots) {
      if (colors.has(root.id)) continue;
      colors.set(root.id, 1);
      preorder.set(root.id, preorder.size);
      const stack = [{ id: root.id, nextEdge: 0 }];
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const list = localOutgoing.get(frame.id)!;
        if (frame.nextEdge >= list.length) {
          colors.set(frame.id, 2);
          stack.pop();
          continue;
        }
        const edge = list[frame.nextEdge++];
        if (colors.get(edge.target) === 1) {
          cycleEdges.add(edge);
        } else if (!colors.has(edge.target)) {
          colors.set(edge.target, 1);
          preorder.set(edge.target, preorder.size);
          stack.push({ id: edge.target, nextEdge: 0 });
        }
      }
    }

    const indegree = new Map(component.map((block) => [block.id, 0]));
    const ranks = new Map(component.map((block) => [block.id, 0]));
    for (const list of localOutgoing.values()) {
      for (const edge of list) {
        if (!cycleEdges.has(edge)) indegree.set(edge.target, indegree.get(edge.target)! + 1);
      }
    }
    const pending = component.filter((block) => indegree.get(block.id) === 0).map((block) => block.id);
    for (let index = 0; index < pending.length; index += 1) {
      const id = pending[index];
      for (const edge of localOutgoing.get(id)!) {
        if (cycleEdges.has(edge)) continue;
        ranks.set(edge.target, Math.max(ranks.get(edge.target)!, ranks.get(id)! + 1));
        indegree.set(edge.target, indegree.get(edge.target)! - 1);
        if (indegree.get(edge.target) === 0) pending.push(edge.target);
      }
    }

    const rows = new Map<number, PreviewBlock[]>();
    for (const block of component) {
      const rank = ranks.get(block.id)!;
      if (!rows.has(rank)) rows.set(rank, []);
      rows.get(rank)!.push(block);
    }
    if (componentIndex) nextY += COMPONENT_GAP;
    for (const rank of [...rows.keys()].sort((a, b) => a - b)) {
      const blocks = rows.get(rank)!.sort((a, b) => preorder.get(a.id)! - preorder.get(b.id)!);
      let rowHeight = 0;
      for (const block of blocks) rowHeight = Math.max(rowHeight, heightOf(block.id));
      const layer: Layer = { blocks, component: componentIndex, top: nextY, bottom: nextY + rowHeight };
      layers.push(layer);
      for (const block of blocks) layerById.set(block.id, layer);
      widestRow = Math.max(widestRow, blocks.length * BLOCK_WIDTH + (blocks.length - 1) * COLUMN_GAP);
      nextY = layer.bottom + ROW_GAP;
    }
  });

  const layerIndices = new Map(layers.map((layer, index) => [layer, index]));
  const routes = edges.map((edge) => {
    const sourceLayer = layerById.get(edge.source)!;
    const targetLayer = layerById.get(edge.target)!;
    const sourceRank = layerIndices.get(sourceLayer)!;
    const targetRank = layerIndices.get(targetLayer)!;
    const isReturn = cycleEdges.has(edge) || targetRank <= sourceRank;
    const adjacent = !isReturn && sourceLayer.component === targetLayer.component && targetRank === sourceRank + 1;
    return { edge, sourceLayer, targetLayer, isReturn, adjacent };
  });
  const leftLaneCount = routes.filter((route) => !route.adjacent && !route.isReturn).length;
  const rightLaneCount = routes.filter((route) => route.isReturn).length;
  const cardLeft = PADDING + (leftLaneCount ? SIDE_GAP + (leftLaneCount - 1) * SIDE_LANE_GAP : 0);
  const result: TextPreviewLayout = {
    width: cardLeft + widestRow + PADDING + (rightLaneCount ? SIDE_GAP + (rightLaneCount - 1) * SIDE_LANE_GAP : 0),
    height: layers[layers.length - 1].bottom + PADDING,
    blocks: [],
    edges: [],
  };
  const positioned = new Map<string, PositionedBlock>();
  for (const layer of layers) {
    const rowWidth = layer.blocks.length * BLOCK_WIDTH + (layer.blocks.length - 1) * COLUMN_GAP;
    layer.blocks.forEach((block, index) => {
      positioned.set(block.id, {
        id: block.id,
        x: cardLeft + (widestRow - rowWidth) / 2 + index * (BLOCK_WIDTH + COLUMN_GAP),
        y: layer.top,
        width: BLOCK_WIDTH,
        height: heightOf(block.id),
      });
    });
  }
  // Preserve model order for keyed DOM rendering and stable ResizeObserver data.
  result.blocks = preview.blocks.map((block) => positioned.get(block.id)!);

  const layerRouteCounts = new Map<Layer, number>();
  const layerRouteIndices = new Map<Layer, number>();
  for (const route of routes) layerRouteCounts.set(route.sourceLayer, (layerRouteCounts.get(route.sourceLayer) ?? 0) + 1);
  let leftLane = 0;
  let rightLane = 0;
  for (const route of routes) {
    const { edge, sourceLayer, targetLayer, isReturn, adjacent } = route;
    const source = positioned.get(edge.source)!;
    const target = positioned.get(edge.target)!;
    const outletCount = Math.max(byId.get(edge.source)!.outlets.length, edge.outletIndex + 1, 1);
    const sourceX = source.x + source.width * (edge.outletIndex + 1) / (outletCount + 1);
    const sourceY = source.y + source.height;
    const targetX = target.x + target.width / 2;
    const targetY = target.y;
    const laneIndex = layerRouteIndices.get(sourceLayer) ?? 0;
    layerRouteIndices.set(sourceLayer, laneIndex + 1);
    const laneFraction = (laneIndex + 1) / (layerRouteCounts.get(sourceLayer)! + 1);
    let points: Array<[number, number]>;
    if (adjacent) {
      const middleY = sourceLayer.bottom + 36 + laneFraction * (ROW_GAP - 72);
      points = [[sourceX, sourceY], [sourceX, middleY], [targetX, middleY], [targetX, targetY]];
    } else {
      const sideX = isReturn
        ? cardLeft + widestRow + SIDE_GAP + rightLane++ * SIDE_LANE_GAP
        : PADDING + (leftLaneCount - 1 - leftLane++) * SIDE_LANE_GAP;
      const departureY = sourceLayer.bottom + 20 + laneFraction * 28;
      const arrivalY = targetLayer.top - 20 - laneFraction * 28;
      points = [[sourceX, sourceY], [sourceX, departureY], [sideX, departureY], [sideX, arrivalY], [targetX, arrivalY], [targetX, targetY]];
    }
    result.edges.push({
      id: edge.id,
      path: points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" "),
      isReturn,
      labelX: sourceX + 9,
      labelY: sourceY + 17,
    });
  }
  return result;
}
