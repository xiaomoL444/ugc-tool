import type { DialogueProject } from "../types/FileStruct";
import type { TextPreviewLine } from "./dialogueTextPreview";

export type DialogueTextField = "speaker" | "subtitle" | "content" | "style";

export interface DialogueTextEdit {
  nodeId: string;
  field: DialogueTextField;
  value: string;
}

export function applyDialogueOptionIconEdit(project: DialogueProject, nodeId: string, optionId: string, icon: number): boolean {
  if (!Number.isInteger(icon) || icon < 0 || icon > 2147483647) return false;
  if (!Object.prototype.hasOwnProperty.call(project.dialogue.nodes, nodeId)) return false;
  const option = project.dialogue.nodes[nodeId]?.select?.options.find(item => item.id === optionId);
  if (!option || option.icon === icon) return false;
  option.icon = icon;
  return true;
}

/** 更新现有 Dialogue 的文本或样式；业务 ID 不经画布引用转换。 */
export function applyDialogueTextEdit(project: DialogueProject, edit: DialogueTextEdit): boolean {
  if (!edit || typeof edit !== "object" || typeof edit.nodeId !== "string" || typeof edit.value !== "string") {
    return false;
  }
  const { nodeId, field, value } = edit;
  if (field !== "speaker" && field !== "subtitle" && field !== "content" && field !== "style") return false;

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

/** 仅省略相邻且说话人、副标题、样式完全相同的重复标签。 */
export function shouldShowDialogueSpeaker(lines: readonly TextPreviewLine[], index: number): boolean {
  const line = lines[index];
  if (!line) return false;
  const previous = lines[index - 1];
  return !previous || !line.hasDialogue || !previous.hasDialogue ||
    line.speaker !== previous.speaker || line.subtitle !== previous.subtitle || line.style !== previous.style;
}
