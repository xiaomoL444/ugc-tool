import type {
  DialogueNode,
  DialogueClip,
  SelectClip,
  PerformanceClip,
} from "../types/DialogueNode";
import { getDialogueClips } from "./dialogueClips";

export const DEFAULT_TIMELINE_DURATION = 2;
export const DEFAULT_CONTINUE_DELAY_TIME = 0.5;
export const MIN_CLIP_DURATION = 0.1;

export function getGroupTimelineDisplayDuration(node: DialogueNode) {
  const end = getGroupTimelineEnd(node);
  const display = node.timeline.displayDuration;
  return typeof display === "number" && Number.isFinite(display) && display > 0
    ? display
    : Math.max(10, Math.ceil(end + 2));
}

export function isInstantPerformanceClip(clip: { type?: string }) {
  return clip.type === "Custom";
}

export function getPerformanceClipDuration(clip: PerformanceClip) {
  return isInstantPerformanceClip(clip) ? 0 : clip.duration;
}

export type FlowClip = DialogueClip | SelectClip;

export function isFreeDialogueClip(clip: unknown): clip is DialogueClip & { advanceMode: "None" } {
  return typeof clip === "object" && clip !== null && "advanceMode" in clip && clip.advanceMode === "None";
}

/**
 * 玩家按下的 Dialogue 与 Select 延伸到 Group 的实际结束时间；
 * 不触发按下的 Dialogue 使用独立时长。
 */
export function getGroupTimelineEnd(node: DialogueNode) {
  let end = Math.max(MIN_CLIP_DURATION, node.timeline.duration);

  for (const dialogue of getDialogueClips(node)) {
    end = Math.max(
      end,
      dialogue.startTime + (isFreeDialogueClip(dialogue)
        ? getFreeDialogueDuration(dialogue)
        : dialogue.continueDelayTime),
    );
  }
  if (node.select) {
    end = Math.max(
      end,
      node.select.startTime + node.select.continueDelayTime,
    );
  }

  if (node.focusPush) end = Math.max(end, node.focusPush.startTime);

  for (const line of node.lines) {
    for (const clip of line.clips) {
      end = Math.max(end, clip.startTime + getPerformanceClipDuration(clip));
    }
  }

  return end;
}

export function getFlowClipDuration(node: DialogueNode, clip: FlowClip) {
  if (isFreeDialogueClip(clip)) return getFreeDialogueDuration(clip);
  return Math.max(MIN_CLIP_DURATION, getGroupTimelineEnd(node) - clip.startTime);
}

function getFreeDialogueDuration(clip: DialogueClip) {
  return typeof clip.duration === "number" && Number.isFinite(clip.duration)
    ? Math.max(MIN_CLIP_DURATION, clip.duration)
    : DEFAULT_TIMELINE_DURATION;
}
