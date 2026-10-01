import { graphlib, layout } from "@dagrejs/dagre";
import type { QuestProject } from "./types";

export const QUEST_FLOW_PAGE_SIZE = 50;
const NODE_LIMIT = 100;
const EDGE_LIMIT = 300;
export type QuestFlowLink = { sourceId: number; targetId: number | null; kind: "next" | "failure"; index: number };
export type QuestFlowNode = { id: string; questId: number | null; mainQuestId: number | null; title: string; parent: string; boundary: boolean; missing: boolean; finish: boolean };
export type QuestFlowGroup = { id: string; kind: "chapter" | "main"; entityId: number | null; parentId?: string; title: string; count: number; total: number };
export type QuestFlowEdge = QuestFlowLink & { id: string; source: string; target: string };
export const questNodeId = (id: number) => `quest:${id}`;

/** Bounded projection only; omitted relationships remain intact in the project. */
export function buildQuestFlow(project: QuestProject, mainId: number | null, page: number) {
  const all = new Map(project.subQuests.map(sub => [sub.id, sub]));
  const mains = new Map(project.mainQuests.map(main => [main.id, main]));
  const matches = mainId === null ? project.subQuests : project.subQuests.filter(sub => sub.mainQuestId === mainId);
  const pageCount = Math.max(1, Math.ceil(matches.length / QUEST_FLOW_PAGE_SIZE));
  const currentPage = Math.min(Math.max(0, page), pageCount - 1);
  const visible = matches.slice(currentPage * QUEST_FLOW_PAGE_SIZE, (currentPage + 1) * QUEST_FLOW_PAGE_SIZE);
  const nodes: QuestFlowNode[] = [];
  const edges: QuestFlowEdge[] = [];
  const nodeIds = new Set<string>();
  function addNode(id: string, questId: number | null, boundary: boolean) {
    if (nodeIds.has(id)) return true;
    if (nodes.length >= NODE_LIMIT) return false;
    const sub = questId === null ? undefined : all.get(questId);
    nodes.push({ id, questId, mainQuestId: sub?.mainQuestId ?? null, title: sub?.title || (sub ? "未命名子任务" : questId === null ? "空引用" : `未找到任务 #${questId}`),
      parent: sub ? mains.get(sub.mainQuestId)?.title || "未命名主任务" : "请在任务属性中检查此引用",
      boundary, missing: !sub, finish: sub?.finishMainQuest ?? false });
    nodeIds.add(id);
    return true;
  }
  visible.forEach(sub => addNode(questNodeId(sub.id), sub.id, false));
  let omitted = 0;
  for (const sub of visible) {
    const links: QuestFlowLink[] = sub.nextQuestIds.map((targetId, index) => ({ sourceId: sub.id, targetId, index, kind: "next" }));
    if (sub.failureQuestId !== -1) links.push({ sourceId: sub.id, targetId: sub.failureQuestId, index: -1, kind: "failure" });
    for (const link of links) {
      const id = `${link.kind}:${sub.id}:${link.index}`;
      const target = link.targetId === null ? `empty:${id}` : questNodeId(link.targetId);
      if (edges.length >= EDGE_LIMIT || !addNode(target, link.targetId, true)) { omitted++; continue; }
      edges.push({ ...link, id, source: questNodeId(sub.id), target });
    }
  }
  const totals = new Map<number, number>();
  project.subQuests.forEach(sub => totals.set(sub.mainQuestId, (totals.get(sub.mainQuestId) ?? 0) + 1));
  const represented = new Set(nodes.flatMap(node => node.mainQuestId === null ? [] : [node.mainQuestId]));
  // Include empty containers without repeating them on every page of a large project.
  project.mainQuests.forEach(main => {
    if ((mainId === main.id || (mainId === null && currentPage === 0)) && !totals.get(main.id)) represented.add(main.id);
  });
  const groups: QuestFlowGroup[] = [];
  const chapters = new Map(project.chapters.map(chapter => [chapter.id, chapter]));
  const containers = new Map<string, QuestFlowGroup>();
  function addChapter(chapterId: number | null) {
    const chapter = chapterId === null ? undefined : chapters.get(chapterId);
    const id = chapter ? `chapter:${chapter.id}` : "chapter:unassigned";
    if (!containers.has(id)) containers.set(id, { id, kind: "chapter", entityId: chapter?.id ?? null,
      title: chapter?.title || (chapter ? "未命名章节" : "直属主任务"), count: 0,
      total: project.mainQuests.filter(main => chapter ? main.chapterId === chapter.id : main.chapterId === null || !chapters.has(main.chapterId)).length });
    return id;
  }
  for (const main of project.mainQuests) {
    if (!represented.has(main.id)) continue;
    const parentId = addChapter(main.chapterId);
    containers.get(parentId)!.count++;
    groups.push({ id: `main:${main.id}`, kind: "main", entityId: main.id, parentId, title: main.title || "未命名主任务",
      count: nodes.filter(node => node.mainQuestId === main.id).length, total: totals.get(main.id) ?? 0 });
  }
  if (mainId === null && currentPage === 0) project.chapters.forEach(chapter => {
    if (!project.mainQuests.some(main => main.chapterId === chapter.id)) addChapter(chapter.id);
  });
  return { nodes, edges, groups: [...containers.values(), ...groups], pageCount, page: currentPage, total: matches.length, omitted };
}

export type QuestFlowBox = { position: { x: number; y: number }; width: number; height: number; parentId?: string };

export function questFlowAbsolutePositions(boxes: ReadonlyMap<string, QuestFlowBox>) {
  const result = new Map<string, { x: number; y: number }>();
  function resolve(id: string): { x: number; y: number } {
    const saved = result.get(id);
    if (saved) return saved;
    const box = boxes.get(id)!;
    const parent = box.parentId && boxes.has(box.parentId) ? resolve(box.parentId) : { x: 0, y: 0 };
    const position = { x: parent.x + box.position.x, y: parent.y + box.position.y };
    result.set(id, position);
    return position;
  }
  boxes.forEach((_, id) => resolve(id));
  return result;
}

/** Rebase containers around their children without moving any child in canvas coordinates. */
export function fitQuestFlowGroupBounds(boxes: Map<string, QuestFlowBox>, groups: QuestFlowGroup[]) {
  for (const kind of ["main", "chapter"] as const) {
    for (const group of groups.filter(group => group.kind === kind)) {
      const parent = boxes.get(group.id);
      if (!parent) continue;
      const children = [...boxes.values()].filter(box => box.parentId === group.id);
      if (!children.length) { parent.width = 320; parent.height = 160; continue; }
      const side = kind === "main" ? 26 : 32, top = kind === "main" ? 60 : 64;
      const left = Math.min(...children.map(box => box.position.x)) - side;
      const upper = Math.min(...children.map(box => box.position.y)) - top;
      const right = Math.max(...children.map(box => box.position.x + box.width)) + side;
      const bottom = Math.max(...children.map(box => box.position.y + box.height)) + side;
      parent.position = { x: parent.position.x + left, y: parent.position.y + upper };
      parent.width = Math.max(320, right - left);
      parent.height = Math.max(160, bottom - upper);
      children.forEach(box => { box.position = { x: box.position.x - left, y: box.position.y - upper }; });
    }
  }
  return boxes;
}

/** Lay out each main quest, then chapters, then the whole canvas. Child positions are parent-relative. */
export function layoutQuestFlowGroups(nodes: QuestFlowNode[], edges: QuestFlowEdge[], groups: QuestFlowGroup[]) {
  const boxes = new Map<string, QuestFlowBox>();
  const groupIds = new Set(groups.map(group => group.id));
  nodes.forEach(node => boxes.set(node.id, { position: { x: 0, y: 0 }, width: 226, height: 132,
    parentId: node.mainQuestId !== null && groupIds.has(`main:${node.mainQuestId}`) ? `main:${node.mainQuestId}` : undefined }));
  groups.forEach(group => boxes.set(group.id, { position: { x: 0, y: 0 }, width: 320, height: 160, parentId: group.parentId }));

  function ancestorAt(id: string, parentId?: string): string | undefined {
    let box = boxes.get(id);
    while (box && box.parentId !== parentId) {
      if (!box.parentId) return undefined;
      id = box.parentId;
      box = boxes.get(id);
    }
    return box ? id : undefined;
  }
  function arrange(parentId?: string) {
    const children = [...boxes.entries()].filter(([, box]) => box.parentId === parentId);
    if (!children.length) return;
    const graph = new graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: 46, ranksep: 100, marginx: 0, marginy: 0 });
    graph.setDefaultEdgeLabel(() => ({}));
    children.forEach(([id, box]) => graph.setNode(id, { width: box.width, height: box.height }));
    for (const edge of edges) {
      const source = ancestorAt(edge.source, parentId), target = ancestorAt(edge.target, parentId);
      if (source && target && source !== target) graph.setEdge(source, target);
    }
    layout(graph);
    const padding = parentId?.startsWith("main:") ? { x: 26, top: 60, bottom: 26 } : { x: 32, top: 64, bottom: 32 };
    let width = 320, height = 160;
    children.forEach(([id, box]) => {
      const position = graph.node(id);
      box.position = { x: position.x - box.width / 2 + padding.x, y: position.y - box.height / 2 + padding.top };
      width = Math.max(width, box.position.x + box.width + padding.x);
      height = Math.max(height, box.position.y + box.height + padding.bottom);
    });
    const parent = parentId ? boxes.get(parentId) : undefined;
    if (parent) { parent.width = width; parent.height = height; }
  }
  groups.filter(group => group.kind === "main").forEach(group => arrange(group.id));
  groups.filter(group => group.kind === "chapter").forEach(group => arrange(group.id));
  arrange();
  return boxes;
}

export function layoutQuestFlow(nodes: QuestFlowNode[], edges: QuestFlowEdge[]) {
  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: "LR", nodesep: 42, ranksep: 110, edgesep: 20, marginx: 30, marginy: 30 });
  graph.setDefaultEdgeLabel(() => ({}));
  nodes.forEach(node => graph.setNode(node.id, { width: 226, height: 132 }));
  edges.forEach(edge => graph.setEdge(edge.source, edge.target, {}, edge.id));
  if (nodes.length) layout(graph);
  return new Map(nodes.map(node => {
    const position = graph.node(node.id);
    return [node.id, { x: position.x - 113, y: position.y - 66 }];
  }));
}

export function connectQuestFlow(project: QuestProject, sourceId: number, targetId: number, kind: QuestFlowLink["kind"]) {
  const source = project.subQuests.find(sub => sub.id === sourceId);
  if (!source || !project.subQuests.some(sub => sub.id === targetId)) return "任务已不存在，请重新选择。";
  if (kind === "failure") {
    if (targetId === -1) return "ID -1 是无回溯标记，不能作为失败回溯目标。";
    source.failureQuestId = targetId;
  } else {
    if (source.nextQuestIds.includes(targetId)) return "该任务已在后续任务中，不能重复添加";
    if (source.nextQuestIds.length >= 100) return "每个子任务最多关联 100 项后续任务。";
    source.nextQuestIds.push(targetId);
  }
  return "";
}

/** Check the captured slot again so a stale selection cannot remove a different reference. */
export function disconnectQuestFlow(project: QuestProject, link: QuestFlowLink) {
  const source = project.subQuests.find(sub => sub.id === link.sourceId);
  if (!source) return false;
  if (link.kind === "failure") {
    if (source.failureQuestId !== link.targetId) return false;
    source.failureQuestId = -1;
  } else {
    if (source.nextQuestIds[link.index] !== link.targetId) return false;
    source.nextQuestIds.splice(link.index, 1);
  }
  return true;
}
