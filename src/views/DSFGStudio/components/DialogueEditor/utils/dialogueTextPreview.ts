import type { DialogueProject } from "../types/FileStruct";
import type { DialogueNode } from "../types/DialogueNode";
import { normalizeSourceHandle, resolveGroupOutlets } from "./groupOutlets";

export interface TextPreviewLine {
  nodeId: string;
  name: string;
  speaker: string;
  content: string;
  subtitle: string;
  hasDialogue: boolean;
}

export interface TextPreviewOutlet {
  id: string;
  label: string;
  text: string;
  kind: "next" | "select" | "condition" | "entry";
  connected: boolean;
}

export interface TextPreviewBlock {
  id: string;
  kind: "entry" | "dialogue" | "select" | "condition" | "output";
  title: string;
  nodeIds: string[];
  lines: TextPreviewLine[];
  outlets: TextPreviewOutlet[];
  reachable: boolean;
  warnings: string[];
}

export interface TextPreviewEdge {
  id: string;
  source: string;
  target: string;
  outletIndex: number;
}

export interface DialogueTextPreview {
  blocks: TextPreviewBlock[];
  edges: TextPreviewEdge[];
}

interface PreviewVertex {
  id: string;
  nodeId: string;
  kind: TextPreviewBlock["kind"];
  title: string;
  line?: TextPreviewLine;
  outlets: TextPreviewOutlet[];
  targets: Array<string | undefined>;
  warnings: string[];
  reachable: boolean;
}

/**
 * 只读的文本流程投影。连线来自画布，文本与出口来自业务数据；
 * 不读取布局坐标或旧 next 缓存，也不解析、执行条件表达式。
 */
export function buildDialogueTextPreview(project: DialogueProject): DialogueTextPreview {
  const vertices = new Map<string, PreviewVertex>();
  const graphReferences = new Map<string, string>();
  const businessReferences = new Map<string, string>();

  function addGroup(nodeId: string, node: DialogueNode) {
    const id = `group:${nodeId}`;
    if (vertices.has(id)) return id;
    const state = resolveGroupOutlets(node);
    vertices.set(id, {
      id,
      nodeId,
      kind: node.select ? "select" : "dialogue",
      title: node.name,
      line: {
        nodeId,
        name: node.name,
        speaker: node.dialogue?.speaker ?? "",
        content: node.dialogue?.content ?? "",
        subtitle: node.dialogue?.subtitle ?? "",
        hasDialogue: Boolean(node.dialogue),
      },
      outlets: state.outlets.map((outlet) => ({
        id: outlet.id,
        label: outlet.label,
        text: outlet.kind === "Select"
          ? node.select?.options.find((option) => option.id === outlet.optionId)?.content ?? ""
          : "",
        kind: outlet.kind === "Select" ? "select" : "next",
        connected: false,
      })),
      targets: [],
      warnings: [...state.warnings],
      reachable: false,
    });
    businessReferences.set(nodeId, id);
    return id;
  }

  function addCondition(nodeId: string) {
    const id = `condition:${nodeId}`;
    if (vertices.has(id)) return id;
    const node = project.dialogue.conditionBranches[nodeId];
    vertices.set(id, {
      id,
      nodeId,
      kind: "condition",
      title: node.name,
      outlets: node.outputs.map((outlet) => ({
        id: outlet.id,
        label: outlet.label,
        text: outlet.condition,
        kind: "condition",
        connected: false,
      })),
      targets: [],
      warnings: node.outputs.length ? [] : ["当前条件分支没有出口。"],
      reachable: false,
    });
    if (!businessReferences.has(nodeId)) businessReferences.set(nodeId, id);
    return id;
  }

  function addTerminal(nodeId: string, kind: "entry" | "output") {
    const id = `${kind}:${nodeId}`;
    if (!vertices.has(id)) {
      vertices.set(id, {
        id,
        nodeId,
        kind,
        title: kind === "entry" ? "开始" : "结束",
        outlets: kind === "entry"
          ? [{ id: "next", label: "开始", text: "", kind: "entry", connected: false }]
          : [],
        targets: [],
        warnings: [],
        reachable: false,
      });
    }
    return id;
  }

  // 保留注册顺序，但一个业务节点被多个画布引用时只投影一次。
  for (const graphNode of project.graph.nodes) {
    let id: string | undefined;
    if (graphNode.type === "entry" || graphNode.type === "output") {
      id = addTerminal(graphNode.id, graphNode.type);
    } else if (graphNode.type === "condition" || graphNode.data?.conditionBranchNodeId) {
      const nodeId = graphNode.data?.conditionBranchNodeId ?? graphNode.id;
      if (project.dialogue.conditionBranches[nodeId]) id = addCondition(nodeId);
    } else {
      const nodeId = graphNode.data?.dialogueNodeId ?? graphNode.id;
      const node = project.dialogue.nodes[nodeId];
      if (node) id = addGroup(nodeId, node);
    }
    if (id) graphReferences.set(graphNode.id, id);
  }
  for (const [nodeId, node] of Object.entries(project.dialogue.nodes)) addGroup(nodeId, node);
  for (const nodeId of Object.keys(project.dialogue.conditionBranches)) addCondition(nodeId);

  const resolveReference = (id: string) => graphReferences.get(id) ?? businessReferences.get(id);
  const declaredEntry = project.dialogue.entryNodeId
    ? graphReferences.get(project.dialogue.entryNodeId)
    : undefined;
  const entryId = declaredEntry && vertices.get(declaredEntry)?.kind === "entry"
    ? declaredEntry
    : [...vertices.values()].find((vertex) => vertex.kind === "entry")?.id;

  // 每个合法出口只保留最后一条连线，与编辑器重连/导出的规则一致。
  const connections = new Map<string, Map<string, string>>();
  for (const edge of project.graph.edges) {
    const sourceId = resolveReference(edge.source);
    const source = sourceId ? vertices.get(sourceId) : undefined;
    if (!source) continue;
    const handle = source.kind === "condition"
      ? edge.sourceHandle
      : source.kind === "entry" && edge.sourceHandle === "output"
        ? "next" // 旧开始节点使用 output；当前入口组件使用 next。
        : normalizeSourceHandle(edge.sourceHandle);
    if (!handle || !source.outlets.some((outlet) => outlet.id === handle)) continue;
    let outlets = connections.get(source.id);
    if (!outlets) connections.set(source.id, outlets = new Map());
    outlets.set(handle, edge.target);
  }
  const incomingCount = new Map<string, number>();
  for (const vertex of vertices.values()) {
    vertex.targets = vertex.outlets.map((outlet) => {
      const targetReference = connections.get(vertex.id)?.get(outlet.id);
      const targetId = targetReference === undefined ? undefined : resolveReference(targetReference);
      outlet.connected = targetId !== undefined;
      if (targetId !== undefined) {
        incomingCount.set(targetId, (incomingCount.get(targetId) ?? 0) + 1);
      } else if (targetReference !== undefined) {
        vertex.warnings.push(`出口「${outlet.label}」的目标节点不存在。`);
      }
      return targetId;
    });
  }

  const ordered: string[] = [];
  const colors = new Map<string, "active" | "complete">();
  const returnTargets = new Set<string>();
  function visit(rootId: string, reachable: boolean) {
    if (colors.has(rootId)) return;
    // 显式栈避免长对话/环路递归溢出；同一出口顺序也决定分支阅读顺序。
    const stack = [{ id: rootId, outletIndex: 0 }];
    colors.set(rootId, "active");
    ordered.push(rootId);
    vertices.get(rootId)!.reachable = reachable;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const vertex = vertices.get(frame.id)!;
      if (frame.outletIndex >= vertex.targets.length) {
        colors.set(frame.id, "complete");
        stack.pop();
        continue;
      }
      const targetId = vertex.targets[frame.outletIndex++];
      if (targetId === undefined) continue;
      if (colors.get(targetId) === "active") returnTargets.add(targetId);
      if (colors.has(targetId)) continue;
      vertices.get(targetId)!.reachable = reachable;
      colors.set(targetId, "active");
      ordered.push(targetId);
      stack.push({ id: targetId, outletIndex: 0 });
    }
  }
  if (entryId) visit(entryId, true);
  for (const id of vertices.keys()) visit(id, false);

  const mergeNext = new Map<string, string>();
  const mergePrevious = new Map<string, string>();
  for (const vertex of vertices.values()) {
    if (vertex.kind !== "dialogue" || vertex.outlets.length !== 1 || vertex.outlets[0].kind !== "next") continue;
    const targetId = vertex.targets[0];
    const target = targetId === undefined ? undefined : vertices.get(targetId);
    if (!target || (target.kind !== "dialogue" && target.kind !== "select")) continue;
    if (incomingCount.get(target.id) !== 1 || returnTargets.has(target.id)) continue;
    mergeNext.set(vertex.id, target.id);
    mergePrevious.set(target.id, vertex.id);
  }

  const blocks: TextPreviewBlock[] = [];
  const vertexBlocks = new Map<string, string>();
  const blockTails = new Map<string, PreviewVertex>();
  for (const orderedId of ordered) {
    if (vertexBlocks.has(orderedId)) continue;
    let headId = orderedId;
    while (mergePrevious.has(headId)) headId = mergePrevious.get(headId)!;
    const head = vertices.get(headId)!;
    const block: TextPreviewBlock = {
      id: head.id,
      kind: head.kind,
      title: head.title,
      nodeIds: [],
      lines: [],
      outlets: [],
      reachable: head.reachable,
      warnings: [],
    };
    let currentId: string | undefined = headId;
    while (currentId !== undefined) {
      const vertex = vertices.get(currentId)!;
      vertexBlocks.set(currentId, block.id);
      block.nodeIds.push(vertex.nodeId);
      if (vertex.line) block.lines.push(vertex.line);
      block.kind = vertex.kind;
      block.outlets = vertex.outlets;
      block.warnings.push(...vertex.warnings.map((warning) => `「${vertex.title}」${warning}`));
      blockTails.set(block.id, vertex);
      currentId = mergeNext.get(currentId);
    }
    blocks.push(block);
  }

  const edges: TextPreviewEdge[] = [];
  for (const block of blocks) {
    blockTails.get(block.id)!.targets.forEach((targetId, outletIndex) => {
      if (targetId === undefined) return;
      const target = vertexBlocks.get(targetId);
      if (target === undefined) return;
      // 相同目标的多个出口及收缩后的自环都必须保留。
      edges.push({ id: `${block.id}:outlet:${outletIndex}`, source: block.id, target, outletIndex });
    });
  }
  return { blocks, edges };
}
