import type { DialogueProject } from "../types/FileStruct";
import type { EntityPreset } from "../../EntityPresetEditor/entityPresets";
import { buildDialogueTextPreview, isDialogueCollectionNode, type TextPreviewBlock } from "./dialogueTextPreview";
import { toSerializableDialogueProject } from "./dialogueProjectCodec";
import { createConditionBranchNode, createDialogueClip, createDialogueNode, createSelectClip, createSelectOption } from "./dialogueProject";
import { normalizeSourceHandle, selectOutletId } from "./groupOutlets";

export type DialogueTextAction =
  | { type: "create" }
  | { type: "insert"; nodeId: string; before?: boolean }
  | { type: "delete"; nodeId: string }
  | { type: "delete-outlet"; blockId: string; outletId: string }
  | { type: "delete-block"; blockId: string }
  | { type: "move"; nodeId: string; targetId: string }
  | { type: "add-option"; nodeId: string }
  | { type: "edit-condition"; nodeId: string; outletId: string; condition: string }
  | { type: "append"; blockId: string; outletId: string; kind: "dialogue" | "select" | "condition"; preset?: Pick<EntityPreset, "talker" | "subtitle"> }
  | { type: "add-dialogue"; nodeId: string }
  | { type: "connect"; blockId: string; outletId: string; targetId: string };

/** Structural edits commit as one project update, so the synchronous edge/save
 * watchers never see half a rewire. Clip identities and settings travel with
 * their sentence; only the sequence's graph endpoints change when reordering. */
export function applyDialogueTextAction(source: DialogueProject, action: DialogueTextAction): { project: DialogueProject; nodeId?: string; focusBlockId?: string } | undefined {
  const project = toSerializableDialogueProject(source);
  // Existing canvas nodes are not edited here. Keep visibility/selection and
  // presentation metadata that the file serializer intentionally omits.
  project.graph.nodes = [...source.graph.nodes];
  project.graph.edges = source.graph.edges.map((edge) => ({ ...edge }));
  const preview = buildDialogueTextPreview(project);
  const vertexOf = (node: DialogueProject["graph"]["nodes"][number]) => {
    if (node.type === "entry" || node.type === "output") return `${node.type}:${node.id}`;
    if (node.type === "condition" || node.data?.conditionBranchNodeId) return `condition:${node.data?.conditionBranchNodeId ?? node.id}`;
    return `group:${node.data?.dialogueNodeId ?? node.id}`;
  };
  const references = new Map(project.graph.nodes.map((node) => [node.id, vertexOf(node)]));
  const vertexForReference = (id: string) => references.get(id) ?? (Object.prototype.hasOwnProperty.call(project.dialogue.nodes, id)
    ? `group:${id}` : Object.prototype.hasOwnProperty.call(project.dialogue.conditionBranches, id) ? `condition:${id}` : undefined);
  const graphForVertex = (vertex: string, fallback: string) => project.graph.nodes.find((node) => vertexOf(node) === vertex)?.id ?? fallback;
  const graphId = (id: string) => graphForVertex(`group:${id}`, id);
  const businessId = (id: string) => {
    const vertex = vertexForReference(id);
    return vertex?.startsWith("group:") ? vertex.slice("group:".length) : undefined;
  };
  const blockVertex = (block: TextPreviewBlock, id: string) => `${block.lines.length ? "group" : block.kind}:${id}`;
  const matches = (reference: string, id: string) => businessId(reference) === id;
  const addNode = (nearId?: string, lane = 0) => {
    const id = `group_${crypto.randomUUID()}`;
    const node = createDialogueNode(id);
    node.name = `对话 ${Object.keys(project.dialogue.nodes).length + 1}`;
    node.dialogue!.content = "";
    node.dialogue!.speaker = nearId ? project.dialogue.nodes[nearId]?.dialogue?.speaker ?? "" : "";
    project.dialogue.nodes[id] = node;
    const near = project.graph.nodes.find((item) => item.id === graphId(nearId ?? ""));
    const position = {
      x: (near?.position.x ?? 120) + lane * 420,
      y: (near?.position.y ?? project.graph.nodes.length * 120) + 240,
    };
    while (project.graph.nodes.some((item) => Math.abs(item.position.x - position.x) < 360 && Math.abs(item.position.y - position.y) < 220)) position.x += 420;
    project.graph.nodes.push({ id, type: "group", data: { dialogueNodeId: id }, position });
    return id;
  };
  const connectGraph = (from: string, handle: string, to: string) => project.graph.edges.push({
    id: `edge_${crypto.randomUUID()}`, source: from, sourceHandle: handle, target: to, targetHandle: "input",
  });
  const connect = (from: string, handle: string, to: string) => connectGraph(graphId(from), handle, graphId(to));
  let focusId: string | undefined;
  let focusBlockId: string | undefined;
  if (action.type === "edit-condition") {
    const branch = project.dialogue.conditionBranches[action.nodeId];
    const output = branch?.outputs.find(item => item.id === action.outletId);
    if (!output) return;
    output.condition = action.condition;
    focusId = action.nodeId;
    focusBlockId = `condition:${action.nodeId}`;
  } else if (action.type === "create") {
    focusId = addNode();
    const entry = preview.blocks.find((block) => block.kind === "entry");
    if (entry && !entry.outlets[0]?.connected) connectGraph(entry.nodeIds[0], "next", focusId);
  } else if (action.type === "delete-outlet") {
    const block = preview.blocks.find(item => item.id === action.blockId);
    const outlet = block?.outlets.find(item => item.id === action.outletId);
    if (!block || !outlet || (block.kind !== "select" && block.kind !== "condition")) return;
    const tail = block.nodeIds[block.nodeIds.length - 1];
    if (outlet.kind === "select") {
      const select = project.dialogue.nodes[tail]?.select;
      if (!select) return;
      select.options = select.options.filter(option => selectOutletId(option.id) !== action.outletId);
    } else if (outlet.kind === "condition") {
      const condition = project.dialogue.conditionBranches[tail];
      if (!condition) return;
      condition.outputs = condition.outputs.filter(output => output.id !== action.outletId);
    } else return;
    const vertex = blockVertex(block, tail);
    project.graph.edges = project.graph.edges.filter(edge => !(vertexForReference(edge.source) === vertex && edge.sourceHandle === action.outletId));
    focusBlockId = block.id;
  } else if (action.type === "delete-block") {
    const block = preview.blocks.find(item => item.id === action.blockId);
    if (!block || block.kind === "entry") return;
    const removed = new Set(block.nodeIds.map(id => blockVertex(block, id)));
    const isRemoved = (reference: string) => removed.has(vertexForReference(reference) ?? "");
    // A dialogue collection has a single continuation. Branch nodes never
    // choose one of their children on behalf of the author when removed.
    const next = block.kind === "dialogue" && block.outlets.length === 1 && block.outlets[0].kind === "next"
      ? preview.edges.find(edge => edge.source === block.id && edge.target !== block.id) : undefined;
    const target = next ? preview.blocks.find(item => item.id === next.target) : undefined;
    const tailVertex = blockVertex(block, block.nodeIds[block.nodeIds.length - 1]);
    const outgoing = target ? project.graph.edges.filter(edge => vertexForReference(edge.source) === tailVertex && normalizeSourceHandle(edge.sourceHandle) === block.outlets[0].id) : [];
    const continuation = outgoing[outgoing.length - 1];
    project.graph.edges = project.graph.edges.flatMap(edge => {
      if (isRemoved(edge.source)) return [];
      if (!isRemoved(edge.target)) return [edge];
      return continuation && !isRemoved(continuation.target) ? [{ ...edge, target: continuation.target, targetHandle: continuation.targetHandle ?? "input" }] : [];
    });
    project.graph.nodes = project.graph.nodes.filter(node => !removed.has(vertexOf(node)));
    for (const id of block.nodeIds) {
      if (block.kind === "condition") delete project.dialogue.conditionBranches[id];
      else if (block.lines.length) delete project.dialogue.nodes[id];
    }
    focusBlockId = target?.id;
  } else if (action.type === "append") {
    const block = preview.blocks.find((item) => item.id === action.blockId);
    if (!block || !block.outlets.some((outlet) => outlet.id === action.outletId)) return;
    const tail = block.nodeIds[block.nodeIds.length - 1];
    const sourceVertex = blockVertex(block, tail);
    const outgoing = project.graph.edges.filter((edge) => vertexForReference(edge.source) === sourceVertex &&
      (block.kind === "condition" ? edge.sourceHandle : block.kind === "entry" && edge.sourceHandle === "output" ? "next" : normalizeSourceHandle(edge.sourceHandle)) === action.outletId);
    const continuation = outgoing[outgoing.length - 1];
    focusId = addNode(tail);
    if (action.kind === "dialogue" && action.preset) {
      if (typeof action.preset.talker !== "string" || !action.preset.talker.trim() || typeof action.preset.subtitle !== "string") return;
      const dialogue = project.dialogue.nodes[focusId].dialogue!;
      dialogue.speaker = action.preset.talker;
      dialogue.subtitle = action.preset.subtitle;
    }
    let nextHandle = "next";
    if (action.kind === "select") {
      const node = project.dialogue.nodes[focusId];
      delete node.dialogue;
      node.name = "选项卡";
      node.select = createSelectClip();
      node.select.options.push(createSelectOption());
      node.select.options.forEach((option, index) => { option.content = `选项 ${index + 1}`; });
      nextHandle = selectOutletId(node.select.options[0].id);
    } else if (action.kind === "condition") {
      delete project.dialogue.nodes[focusId];
      const condition = createConditionBranchNode(focusId);
      project.dialogue.conditionBranches[focusId] = condition;
      const graphNode = project.graph.nodes[project.graph.nodes.length - 1];
      graphNode.type = "condition";
      graphNode.data = { conditionBranchNodeId: focusId };
      nextHandle = condition.outputs[0].id;
    }
    project.graph.edges = project.graph.edges.filter((edge) => !outgoing.includes(edge));
    connectGraph(graphForVertex(sourceVertex, tail), action.outletId, focusId);
    if (continuation) project.graph.edges.push({ ...continuation, source: focusId, sourceHandle: nextHandle });
  } else if (action.type === "connect") {
    const block = preview.blocks.find((item) => item.id === action.blockId);
    const target = preview.blocks.find((item) => item.id === action.targetId);
    if (!block || !block.outlets.some((outlet) => outlet.id === action.outletId)) return;
    if (action.targetId && (!target || target.kind === "entry" || target.id === block.id)) return;
    const tail = block.nodeIds[block.nodeIds.length - 1];
    const sourceVertex = blockVertex(block, tail);
    project.graph.edges = project.graph.edges.filter((edge) => !(
      vertexForReference(edge.source) === sourceVertex &&
      ((block.kind === "condition" ? edge.sourceHandle : normalizeSourceHandle(edge.sourceHandle)) === action.outletId || (block.kind === "entry" && edge.sourceHandle === "output"))
    ));
    if (target) connectGraph(graphForVertex(sourceVertex, tail), action.outletId, graphForVertex(blockVertex(target, target.nodeIds[0]), target.nodeIds[0]));
  } else {
    const node = project.dialogue.nodes[action.nodeId];
    const block = preview.blocks.find((item) => item.lines.some((line) => line.nodeId === action.nodeId));
    if (!node || !block) return;
    if (action.type === "delete") {
      if (!node.dialogue) return;
      if (node.select) {
        // A sentence inside a choice node is not the choice node itself.
        delete node.dialogue;
        project.graph.edges = project.graph.edges.filter(edge => !(matches(edge.source, action.nodeId) && normalizeSourceHandle(edge.sourceHandle) === "next"));
        focusId = action.nodeId;
      } else {
        const outgoing = project.graph.edges.filter(edge => matches(edge.source, action.nodeId) && normalizeSourceHandle(edge.sourceHandle) === "next");
        const continuation = node.dialogue.advanceMode === "PlayerInput" ? outgoing[outgoing.length - 1] : undefined;
        const targetVertex = continuation ? vertexForReference(continuation.target) : undefined;
        const targetExists = targetVertex && preview.blocks.some(item => item.nodeIds.some(id => blockVertex(item, id) === targetVertex));
        const reconnect = continuation && targetExists && !matches(continuation.target, action.nodeId) ? continuation : undefined;
        const incoming = project.graph.edges.filter(edge => matches(edge.target, action.nodeId) && !matches(edge.source, action.nodeId));
        project.graph.edges = project.graph.edges.flatMap(edge => {
          if (matches(edge.source, action.nodeId)) return [];
          if (!matches(edge.target, action.nodeId)) return [edge];
          return reconnect ? [{ ...edge, target: reconnect.target, targetHandle: reconnect.targetHandle ?? "input" }] : [];
        });
        project.graph.nodes = project.graph.nodes.filter(item => vertexOf(item) !== `group:${action.nodeId}`);
        delete project.dialogue.nodes[action.nodeId];
        focusId = (reconnect ? businessId(reconnect.target) : undefined) ?? incoming.map(edge => businessId(edge.source)).find(Boolean);
      }
    } else if (action.type === "add-dialogue") {
      if (node.dialogue) return;
      node.dialogue = createDialogueClip();
      node.dialogue.content = "";
      if (node.select) node.dialogue.advanceMode = "None";
      focusId = action.nodeId;
    } else if (action.type === "insert") {
      if (!action.before && (node.select || node.dialogue?.advanceMode !== "PlayerInput")) return;
      focusId = addNode(action.nodeId);
      if (action.before) {
        for (const edge of project.graph.edges) if (matches(edge.target, action.nodeId)) edge.target = focusId;
        connect(focusId, "next", action.nodeId);
      } else {
        for (const edge of project.graph.edges) {
          if (matches(edge.source, action.nodeId) && normalizeSourceHandle(edge.sourceHandle) === "next") edge.source = focusId;
        }
        connect(action.nodeId, "next", focusId);
      }
    } else if (action.type === "move") {
      const ids = block.lines.map((line) => line.nodeId);
      const from = ids.indexOf(action.nodeId);
      const to = ids.indexOf(action.targetId);
      if (to < 0 || to === from) return;
      // A branching/non-continuing tail is a boundary, not a movable sentence.
      const movable = (id: string) => isDialogueCollectionNode(project.dialogue.nodes[id]) && project.dialogue.nodes[id].dialogue?.advanceMode === "PlayerInput";
      if (ids.slice(Math.min(from, to), Math.max(from, to) + 1).some((id) => !movable(id))) return;
      const reordered = [...ids];
      reordered.splice(to, 0, reordered.splice(from, 1)[0]);
      const replacements = new Map(ids.map((id, index) => [id, reordered[index]]));
      for (const edge of project.graph.edges) {
        const sourceId = businessId(edge.source);
        const targetId = businessId(edge.target);
        const newSource = sourceId === undefined ? undefined : replacements.get(sourceId);
        const newTarget = targetId === undefined ? undefined : replacements.get(targetId);
        if (newSource) edge.source = graphId(newSource);
        if (newTarget) edge.target = graphId(newTarget);
      }
      focusId = action.nodeId;
    } else if (action.type === "add-option") {
      if (!node.select) return;
      const option = createSelectOption();
      option.content = `选项 ${node.select.options.length + 1}`;
      node.select.options.push(option);
      focusId = action.nodeId;
    }
  }
  return { project, nodeId: focusId, focusBlockId };
}
