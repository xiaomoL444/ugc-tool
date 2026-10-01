import type { SceneProject } from "./sceneProject";

export type SceneSelection = { kind: "world" | "main" | "sub"; index: number };
export interface SceneGraphBox {
  id: string;
  parentId?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  data: { kind: SceneSelection["kind"]; title: string; entityId?: string; selection?: SceneSelection; count: number; missing?: boolean };
}
export interface SceneGraphLink { id: string; source: string; target: string; label: string }

const PAD = 24, HEADER = 64, GAP = 20, SUB_WIDTH = 180, SUB_HEIGHT = 76;
// Runtime IDs are integer strings; imported values may contain leading zeros.
const key = (id: string) => String(Number(id));

/** A view-only projection: positions never change scene IDs, parents or connection coordinates. */
export function buildSceneGraph(project: SceneProject) {
  const boxes: SceneGraphBox[] = [];
  const edges: SceneGraphLink[] = [];
  const warnings: string[] = [];
  const worlds = new Map<string, SceneGraphBox>();
  const mains = new Map<string, SceneGraphBox>();
  const children = new Map<string, SceneGraphBox[]>();
  const roots: SceneGraphBox[] = [];
  function append(box: SceneGraphBox) {
    boxes.push(box);
    if (box.parentId) {
      const list = children.get(box.parentId) ?? [];
      list.push(box); children.set(box.parentId, list);
    } else roots.push(box);
    return box;
  }
  function box(id: string, kind: SceneSelection["kind"], title: string, entityId?: string, selection?: SceneSelection, parentId?: string): SceneGraphBox {
    return { id, parentId, position: { x: 0, y: 0 }, width: SUB_WIDTH, height: SUB_HEIGHT,
      data: { kind, title, entityId, selection, count: 0 } };
  }
  project.worlds.forEach((world, index) => {
    const item = append(box(`world:${index}`, "world", world.name || "未命名世界", world.id, { kind: "world", index }));
    if (!worlds.has(key(world.id))) worlds.set(key(world.id), item);
  });
  let unassigned: SceneGraphBox | undefined;
  function orphanWorld() {
    if (!unassigned) {
      unassigned = append(box("unassigned-world", "world", "未关联区域"));
      unassigned.data.missing = true;
    }
    return unassigned;
  }
  project.mainAreas.forEach((area, index) => {
    const parent = worlds.get(key(area.worldId)) ?? orphanWorld();
    const item = append(box(`main:${index}`, "main", area.name || "未命名一级区域", area.id, { kind: "main", index }, parent.id));
    if (!mains.has(key(area.id))) mains.set(key(area.id), item);
  });
  let orphanMain: SceneGraphBox | undefined;
  project.subAreas.forEach((area, index) => {
    let parent = mains.get(key(area.mainAreaId));
    if (!parent) {
      if (!orphanMain) {
        orphanMain = append(box("unassigned-main", "main", "未关联一级区域", undefined, undefined, orphanWorld().id));
        orphanMain.data.missing = true;
      }
      parent = orphanMain;
    }
    append(box(`sub:${index}`, "sub", area.name || "未命名二级区域", area.id, { kind: "sub", index }, parent.id));
  });
  function sizeGroup(group: SceneGraphBox) {
    const list = children.get(group.id) ?? [];
    group.data.count = list.length;
    const columns = Math.min(2, Math.max(1, list.length));
    const widths = Array(columns).fill(0) as number[];
    const heights: number[] = [];
    list.forEach((item, index) => {
      widths[index % columns] = Math.max(widths[index % columns], item.width);
      const row = Math.floor(index / columns);
      heights[row] = Math.max(heights[row] ?? 0, item.height);
    });
    list.forEach((item, index) => {
      const col = index % columns, row = Math.floor(index / columns);
      item.position = { x: PAD + widths.slice(0, col).reduce((a, b) => a + b + GAP, 0),
        y: HEADER + heights.slice(0, row).reduce((a, b) => a + b + GAP, 0) };
    });
    group.width = Math.max(320, PAD * 2 + widths.reduce((a, b) => a + b, 0) + GAP * (columns - 1));
    group.height = HEADER + (heights.length ? heights.reduce((a, b) => a + b, 0) + GAP * (heights.length - 1) : 52) + PAD;
  }
  boxes.filter(item => item.data.kind === "main").forEach(sizeGroup);
  roots.forEach(sizeGroup);
  const columns = Math.max(1, Math.ceil(Math.sqrt(roots.length)));
  const rootWidths = Array(columns).fill(0) as number[];
  const rootHeights: number[] = [];
  roots.forEach((item, index) => {
    rootWidths[index % columns] = Math.max(rootWidths[index % columns], item.width);
    const row = Math.floor(index / columns);
    rootHeights[row] = Math.max(rootHeights[row] ?? 0, item.height);
  });
  roots.forEach((item, index) => {
    item.position = { x: rootWidths.slice(0, index % columns).reduce((a, b) => a + b + 160, 0),
      y: rootHeights.slice(0, Math.floor(index / columns)).reduce((a, b) => a + b + 160, 0) };
  });
  project.worlds.forEach((world, worldIndex) => world.contacts.forEach((contact, index) => {
    const target = worlds.get(key(contact.key));
    if (!target) { warnings.push(`${world.name || world.id} → #${contact.key}：目标世界不存在`); return; }
    edges.push({ id: `contact:${worldIndex}:${index}`, source: `world:${worldIndex}`, target: target.id,
      label: `连接点 (${contact.x}, ${contact.y}, ${contact.z})` });
  }));
  // Vue Flow resolves parents in array order, including the synthetic orphan groups.
  const ordered: SceneGraphBox[] = [];
  function visit(item: SceneGraphBox) { ordered.push(item); (children.get(item.id) ?? []).forEach(visit); }
  roots.forEach(visit);
  return { boxes: ordered, edges, warnings };
}
