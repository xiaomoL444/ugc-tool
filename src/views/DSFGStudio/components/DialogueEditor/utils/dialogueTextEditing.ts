import type { DialogueProject } from "../types/FileStruct";
import type { TextPreviewLine } from "./dialogueTextPreview";

export type DialogueTextField = "speaker" | "subtitle" | "content";

export interface DialogueTextEdit {
  nodeId: string;
  field: DialogueTextField;
  value: string;
}

/** 文本预览只能更新现有 Dialogue 的三项文本；业务 ID 不经画布引用转换。 */
export function applyDialogueTextEdit(project: DialogueProject, edit: DialogueTextEdit): boolean {
  if (!edit || typeof edit !== "object" || typeof edit.nodeId !== "string" || typeof edit.value !== "string") {
    return false;
  }
  const { nodeId, field, value } = edit;
  if (field !== "speaker" && field !== "subtitle" && field !== "content") return false;

  const nodes = project?.dialogue?.nodes;
  if (!nodes || !Object.prototype.hasOwnProperty.call(nodes, nodeId)) return false;
  const node = nodes[nodeId];
  if (!node || !Object.prototype.hasOwnProperty.call(node, "dialogue")) return false;
  const dialogue = node.dialogue;
  if (!dialogue || typeof dialogue !== "object" || Array.isArray(dialogue)) return false;
  if (dialogue[field] === value) return false;

  dialogue[field] = value;
  return true;
}

/** 仅省略相邻且说话人/字幕完全相同的重复标签，不跨越无台词 Group。 */
export function shouldShowDialogueSpeaker(lines: readonly TextPreviewLine[], index: number): boolean {
  const line = lines[index];
  if (!line) return false;
  const previous = lines[index - 1];
  return !previous || !line.hasDialogue || !previous.hasDialogue ||
    line.speaker !== previous.speaker || line.subtitle !== previous.subtitle;
}
