import type { DialogueProject } from "../types/FileStruct";
import { encodeDialogueProject, toSerializableDialogueProject } from "./dialogueProjectCodec";

/** One deletion can be restored until another content edit occurs. */
export function captureDialogueDeletion(before: DialogueProject, after: DialogueProject, nodeId: string, blockId?: string) {
  const project = toSerializableDialogueProject(before);
  project.graph.nodes = before.graph.nodes.map(node => ({ ...node, position: { ...node.position }, data: { ...node.data } }));
  project.graph.edges = before.graph.edges.map(edge => ({ ...edge }));
  return { project, nodeId, blockId, expected: encodeDialogueProject(after) };
}

export function canUndoDialogueDeletion(snapshot: ReturnType<typeof captureDialogueDeletion>, current: DialogueProject) {
  return snapshot.expected === encodeDialogueProject(current);
}
