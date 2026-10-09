import type { DialogueClip, DialogueNode } from "../types/DialogueNode";

/** Return the complete dialogue lane in chronological order without mutating saved order. */
export function getDialogueClips(node: DialogueNode): DialogueClip[] {
  return [...(node.dialogue ? [node.dialogue] : []), ...(node.additionalDialogues ?? [])]
    .sort((left, right) => left.startTime - right.startTime);
}

export function appendDialogueClip(node: DialogueNode, clip: DialogueClip): void {
  if (!node.dialogue) node.dialogue = clip;
  else (node.additionalDialogues ??= []).push(clip);
}

export function removeDialogueClip(node: DialogueNode, clipId: string): boolean {
  if (node.dialogue?.id === clipId) {
    node.dialogue = node.additionalDialogues?.shift();
    if (!node.additionalDialogues?.length) delete node.additionalDialogues;
    return true;
  }
  const index = node.additionalDialogues?.findIndex(clip => clip.id === clipId) ?? -1;
  if (index < 0) return false;
  node.additionalDialogues!.splice(index, 1);
  if (!node.additionalDialogues!.length) delete node.additionalDialogues;
  return true;
}

/** Empty means placement is allowed; waiting dialogue is the lane's final input boundary. */
export function getDialogueClipPlacementHint(
  node: DialogueNode,
  clip: DialogueClip,
  startTime = clip.startTime,
): string {
  const waiting = getDialogueClips(node).filter(item => item.advanceMode === "PlayerInput");
  if (clip.advanceMode === "PlayerInput" && waiting.length) return "对话行只允许一个玩家按下 Clip";
  if (waiting.some(item => startTime >= item.startTime)) return "不能在玩家按下 Clip 的右侧添加台词";
  return "";
}
