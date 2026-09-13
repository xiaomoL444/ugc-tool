import { createControlProperties } from "./controlRegistry";
import type { UINode } from "./types";

export function primitiveImageSource(value: unknown): string {
  if (typeof value !== "string") return "";
  const source = value.trim();
  return /^(https?:\/\/|data:image\/(png|jpe?g|webp|gif|svg\+xml|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,])/i.test(source) ? source : "";
}

/** Temporary native export rule; keep the editor node and image reference intact. */
export function toNativeExportNode(node: UINode): UINode {
  return node.type === "primitive" ? { ...node, type: "container", properties: createControlProperties("container") } : node;
}
