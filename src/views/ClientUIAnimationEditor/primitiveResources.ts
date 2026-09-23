import { normalizePrimitiveProperties, type PrimitiveProperties } from "./primitiveData";
import type { UINode } from "./types";

export interface PrimitiveImageResource extends PrimitiveProperties {
  id: string;
  name: string;
}

export function normalizePrimitiveResources(value: unknown): PrimitiveImageResource[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap(raw => {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || ids.has(raw.id)) return [];
    ids.add(raw.id);
    return [{ ...normalizePrimitiveProperties(raw), id: raw.id, name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "未命名图片" }];
  });
}

/** Migrate inline images once. References never carry their own copies of the image/fit. */
export function migratePrimitiveResources(nodes: UINode[], value: unknown) {
  const resources = normalizePrimitiveResources(value);
  const migrated = nodes.map(node => {
    if (node.type !== "primitive") return node;
    const p = node.properties;
    let resource = resources.find(asset => asset.id === p.imageResourceId);
    if (!resource && p.imageUrl) {
      resource = resources.find(asset => asset.imageUrl === p.imageUrl);
      if (!resource) {
        let suffix = resources.length + 1;
        while (resources.some(asset => asset.id === `image-${suffix}`)) suffix++;
        resource = { ...normalizePrimitiveProperties(p), id: `image-${suffix}`, name: node.name || `图片 ${suffix}` };
        resources.push(resource);
      } else if (!resource.fitData && p.fitData) {
        Object.assign(resource, normalizePrimitiveProperties(p));
      }
    }
    return { ...node, properties: { imageUrl: "", imageResourceId: resource?.id ?? p.imageResourceId ?? null, previewMode: p.previewMode === "primitives" ? "primitives" as const : "image" as const } };
  });
  return { nodes: migrated, resources };
}
