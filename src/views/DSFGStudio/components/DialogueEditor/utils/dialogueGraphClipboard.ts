import type { Edge, Node } from "@vue-flow/core";
import type { DialogueNode } from "../types/DialogueNode";
import type { ConditionBranchNode } from "../types/ConditionBranchNode";
import type { DialogueProject, FlowNodeData } from "../types/FileStruct";
import { toSerializableDialogueProject } from "./dialogueProjectCodec";
import { normalizeSourceHandle, resolveGroupOutlets, selectOutletId } from "./groupOutlets";
import { getDialogueClips } from "./dialogueClips";

type ClipboardNode =
  | { kind: "group"; graph: Node<FlowNodeData>; node: DialogueNode }
  | { kind: "condition"; graph: Node<FlowNodeData>; node: ConditionBranchNode };

export interface DialogueGraphClipboard {
  kind: "dsfg-dialogue-nodes";
  version: 1;
  nodes: ClipboardNode[];
  edges: Edge[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

/** Copy exact editor drafts, omitting Vue Flow state and external connections. */
export function copyDialogueGraphNodes(project: DialogueProject, selectedIds: string[]): DialogueGraphClipboard | undefined {
  const selected = new Set(selectedIds);
  const snapshot = toSerializableDialogueProject(project);
  const nodes: ClipboardNode[] = [];
  for (const graph of snapshot.graph.nodes) {
    if (!selected.has(graph.id) || project.graph.nodes.find(node => node.id === graph.id)?.hidden) continue;
    if (graph.type === "condition") {
      const node = snapshot.dialogue.conditionBranches[graph.data?.conditionBranchNodeId ?? graph.id];
      if (node) nodes.push({ kind: "condition", graph, node });
    } else if (graph.type === "group") {
      const node = snapshot.dialogue.nodes[graph.data?.dialogueNodeId ?? graph.id];
      if (node) nodes.push({ kind: "group", graph, node });
    }
  }
  if (!nodes.length) return;
  const copiedIds = new Set(nodes.map(item => item.graph.id));
  return { kind: "dsfg-dialogue-nodes", version: 1, nodes,
    edges: clone(snapshot.graph.edges.filter(edge => copiedIds.has(edge.source) && copiedIds.has(edge.target))) };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: Record<string, unknown>, ...keys: string[]) => keys.every(key => typeof value[key] === "string");
const numbers = (value: Record<string, unknown>, ...keys: string[]) => keys.every(key => typeof value[key] === "number" && Number.isFinite(value[key]));
const list = (value: unknown, check: (item: unknown) => boolean) => Array.isArray(value) && value.every(check);
const stringList = (value: unknown) => list(value, item => typeof item === "string");
const identified = (value: unknown): value is Record<string, unknown> & { id: string } => record(value) && typeof value.id === "string" && !!value.id;

function validDialogue(value: unknown) {
  return identified(value) && strings(value, "style", "speaker", "content", "subtitle")
    && numbers(value, "startTime", "continueDelayTime", "autoContinue")
    && (value.duration === undefined || numbers(value, "duration"))
    && ["PlayerInput", "None"].includes(String(value.advanceMode)) && stringList(value.nodeGraphEvent);
}

function validGroup(value: unknown) {
  if (!identified(value) || !strings(value, "name") || !["Dialogue", "Option", "Branch"].includes(String(value.nodeType))
    || !["Auto", "Fixed"].includes(String(value.durationMode)) || !record(value.timeline) || !numbers(value.timeline, "duration")) return false;
  if (value.dialogue !== undefined && !validDialogue(value.dialogue)) return false;
  if (value.additionalDialogues !== undefined && !list(value.additionalDialogues, validDialogue)) return false;
  if (value.select !== undefined && (!identified(value.select) || !strings(value.select, "style")
    || !numbers(value.select, "startTime", "continueDelayTime") || !stringList(value.select.params)
    || !list(value.select.options, item => identified(item) && strings(item, "content") && numbers(item, "icon")))) return false;
  if (value.focusPush !== undefined && (!identified(value.focusPush) || !numbers(value.focusPush, "startTime", "sharedOutletIndex")
    || !["Self", "Shared"].includes(String(value.focusPush.outputMode)))) return false;
  return list(value.lines, line => identified(line) && strings(line, "name", "type")
    && list(line.clips, clip => identified(clip) && strings(clip, "name", "type") && numbers(clip, "startTime", "duration")
      && list(clip.components, component => identified(component) && strings(component, "name", "templateId")
        && typeof component.enabled === "boolean" && record(component.properties))));
}

function validCondition(value: unknown) {
  return identified(value) && strings(value, "name") && value.nodeType === "ConditionBranch"
    && list(value.outputs, output => identified(output) && strings(output, "label", "condition"));
}

/** Unrelated clipboard text stays available to the browser's normal paste. */
export function parseDialogueGraphClipboard(text: string): DialogueGraphClipboard | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return; }
  if (!record(value) || value.kind !== "dsfg-dialogue-nodes" || value.version !== 1) return;
  const invalid = () => { throw new Error("复制的节点数据不完整，请重新复制节点。"); };
  if (!Array.isArray(value.nodes) || !value.nodes.length || !Array.isArray(value.edges)) return invalid();
  const ids = new Set<string>();
  for (const item of value.nodes) {
    if (!record(item) || !identified(item.graph) || !record(item.graph.position) || !numbers(item.graph.position, "x", "y")
      || !record(item.graph.data) || (item.graph.data.annotation !== undefined && typeof item.graph.data.annotation !== "string")
      || ids.has(item.graph.id)
      || !(item.kind === "group" && item.graph.type === "group" && validGroup(item.node)
        || item.kind === "condition" && item.graph.type === "condition" && validCondition(item.node))) return invalid();
    ids.add(item.graph.id);
  }
  if (!value.edges.every(edge => record(edge) && strings(edge, "id", "source", "target")
    && ids.has(String(edge.source)) && ids.has(String(edge.target))
    && (edge.sourceHandle == null || typeof edge.sourceHandle === "string")
    && (edge.targetHandle == null || typeof edge.targetHandle === "string"))) return invalid();
  return value as unknown as DialogueGraphClipboard;
}

/** Only structural editor identities change; GUIDs, presets and event parameters retain their values. */
export function pasteDialogueGraphNodes(source: DialogueProject, clipboard: DialogueGraphClipboard, offset: number) {
  const project = toSerializableDialogueProject(source);
  // Preserve existing canvas measurements while committing all pasted data at once.
  project.graph.nodes = [...source.graph.nodes];
  project.graph.edges = [...source.graph.edges];
  const nodeIds: string[] = [];
  const ids = new Map<string, string>();
  const handles = new Map<string, Map<string, string>>();
  for (const item of clipboard.nodes) {
    const id = newId(item.kind);
    ids.set(item.graph.id, id);
    nodeIds.push(id);
    const mapping = new Map<string, string>();
    handles.set(item.graph.id, mapping);
    const node = clone(item.node);
    node.id = id;
    if (item.kind === "condition") {
      const branch = node as ConditionBranchNode;
      for (const output of branch.outputs) {
        const oldId = output.id;
        output.id = newId("condition-output");
        mapping.set(oldId, output.id);
      }
      project.dialogue.conditionBranches[id] = branch;
    } else {
      const group = node as DialogueNode;
      group.next = [];
      for (const dialogue of getDialogueClips(group)) dialogue.id = newId("dialogue");
      if (group.select) {
        group.select.id = newId("select");
        for (const option of group.select.options) {
          const oldId = option.id;
          option.id = newId("option");
          mapping.set(selectOutletId(oldId), selectOutletId(option.id));
        }
      }
      if (group.focusPush) group.focusPush.id = newId("focus-push");
      for (const line of group.lines) {
        line.id = newId("line");
        for (const clip of line.clips) {
          clip.id = newId("clip");
          for (const component of clip.components) component.id = newId("component");
        }
      }
      for (const outlet of resolveGroupOutlets(group).outlets) {
        if (outlet.kind !== "Select") mapping.set(outlet.id, outlet.id);
      }
      project.dialogue.nodes[id] = group;
    }
    project.graph.nodes.push({ id, type: item.kind,
      position: { x: item.graph.position.x + offset, y: item.graph.position.y + offset },
      data: { ...(typeof item.graph.data?.annotation === "string" ? { annotation: item.graph.data.annotation } : {}),
        ...(item.kind === "condition" ? { conditionBranchNodeId: id } : { dialogueNodeId: id }) },
      sourcePosition: item.graph.sourcePosition, targetPosition: item.graph.targetPosition, deletable: item.graph.deletable });
  }
  for (const edge of clipboard.edges) {
    const sourceId = ids.get(edge.source), targetId = ids.get(edge.target);
    const sourceHandle = handles.get(edge.source)?.get(normalizeSourceHandle(edge.sourceHandle));
    if (sourceId && targetId && sourceHandle) project.graph.edges.push({ ...clone(edge), id: newId("edge"),
      source: sourceId, target: targetId, sourceHandle });
  }
  return { project, nodeIds };
}
