import { getControlDefinition } from "./controlRegistry";
import type { ControlType, UINode } from "./types";

export type PropertyGroup = "transform" | "image" | "control" | "creation" | "editor";

export interface PropertyGroupSnapshot {
  group: PropertyGroup;
  type: ControlType;
  values: Record<string, unknown>;
}

const transformKeys = [
  "anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY", "pivotX", "pivotY",
  "anchorOffsetX", "anchorOffsetY", "sizeDeltaX", "sizeDeltaY",
  "scaleX", "scaleY", "scaleZ", "rotationX", "rotationY", "rotation",
] as const;
const creationKeys = ["active", "visible"] as const;
const editorKeys = ["locked", "canControllerFocus"] as const;

// The editor supplies reactive objects; recursively copying plain property data
// also works for Vue proxies, which structuredClone cannot accept.
function cloneValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValues(item)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValues(item)])) as T;
  }
  return value;
}

function pickValues(source: object, keys: readonly string[]): Record<string, unknown> {
  const values = source as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, cloneValues(values[key])]));
}

export function capturePropertyGroup(node: UINode, group: PropertyGroup): PropertyGroupSnapshot | null {
  let values: Record<string, unknown>;
  switch (group) {
    case "transform": values = pickValues(node, transformKeys); break;
    case "creation": values = pickValues(node, creationKeys); break;
    case "editor": values = pickValues(node, editorKeys); break;
    case "image":
      if (node.type !== "image") return null;
      values = { imageId: node.properties.imageId };
      break;
    case "control": values = cloneValues(node.properties) as unknown as Record<string, unknown>; break;
  }
  return { group, type: node.type, values };
}

export function canPastePropertyGroup(node: UINode, group: PropertyGroup, clipboard: PropertyGroupSnapshot | null): boolean {
  if (!clipboard || clipboard.group !== group) return false;
  if (group === "image") return node.type === "image" && clipboard.type === "image";
  return group !== "control" || node.type === clipboard.type;
}

export function pastePropertyGroup(node: UINode, group: PropertyGroup, clipboard: PropertyGroupSnapshot | null): boolean {
  if (!clipboard || !canPastePropertyGroup(node, group, clipboard)) return false;
  switch (group) {
    // x/y/width/height are derived layout values. The caller recomputes them
    // from these anchors and offsets after applying a transform operation.
    case "transform": Object.assign(node, pickValues(clipboard.values, transformKeys)); break;
    case "creation": Object.assign(node, pickValues(clipboard.values, creationKeys)); break;
    case "editor": Object.assign(node, pickValues(clipboard.values, editorKeys)); break;
    case "image":
      if (node.type !== "image") return false;
      node.properties.imageId = clipboard.values.imageId as number | null;
      break;
    case "control": node.properties = cloneValues(clipboard.values) as unknown as UINode["properties"]; break;
  }
  return true;
}

export function resetPropertyGroup(node: UINode, group: PropertyGroup): boolean {
  switch (group) {
    case "transform": {
      const definition = getControlDefinition(node.type);
      Object.assign(node, {
        anchorMinX: 0.5, anchorMinY: 0.5, anchorMaxX: 0.5, anchorMaxY: 0.5,
        pivotX: 0.5, pivotY: 0.5, anchorOffsetX: 0, anchorOffsetY: 0,
        sizeDeltaX: definition.defaultWidth, sizeDeltaY: definition.defaultHeight,
        scaleX: 1, scaleY: 1, scaleZ: 1, rotationX: 0, rotationY: 0, rotation: 0,
      });
      break;
    }
    case "image":
      if (node.type !== "image") return false;
      node.properties.imageId = getControlDefinition("image").createProperties().imageId;
      break;
    case "control": node.properties = getControlDefinition(node.type).createProperties(); break;
    case "creation": Object.assign(node, { active: true, visible: true }); break;
    case "editor": Object.assign(node, { locked: false, canControllerFocus: false }); break;
  }
  return true;
}
