import type { UINode } from "./types";

export interface CanvasMaskLayer {
  node: UINode;
  children: CanvasMaskLayer[];
  maskId: string | null;
}

export function canvasImageMaskId(id: string): string {
  return `canvas-image-mask-${Array.from(id, character => character.codePointAt(0)!.toString(16)).join("-")}`;
}

/** Preserve the existing bottom-to-top paint order while grouping masked subtrees. */
export function buildCanvasMaskLayers(nodes: UINode[], maskedIds: Set<string>): CanvasMaskLayer[] {
  const byId = new Map(nodes.map(node => [node.id, { node, children: [], maskId: maskedIds.has(node.id) ? canvasImageMaskId(node.id) : null } as CanvasMaskLayer]));
  const roots: CanvasMaskLayer[] = [];
  for (const node of nodes) {
    const layer = byId.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(layer);
    else roots.push(layer);
  }
  return roots;
}

/** Place the mask texture in the same projected canvas pose as its control. */
export function canvasImageMaskTransform(node: UINode, world: { x: number; y: number; matrix: { a: number; b: number; c: number; d: number } }, canvasHeight: number): string {
  const { a, b, c, d } = world.matrix;
  const x = node.width * node.pivotX, y = node.height * (1 - node.pivotY);
  return `matrix(${a}, ${-b}, ${-c}, ${d}, ${world.x - a * x + c * y}, ${canvasHeight - world.y + b * x - d * y})`;
}
