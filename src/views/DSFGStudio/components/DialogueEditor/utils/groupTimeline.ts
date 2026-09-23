import type {
  DialogueNode,
  DialogueClip,
  SelectClip,
  PerformanceClip,
} from "../types/DialogueNode";

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

/**
 * Dialogue 与 Select 是流程型 Clip：它们只保存开始时间和内部延迟，
 * 右边界统一贴合 Group Timeline 的实际结束时间。
 */
export function getGroupTimelineEnd(node: DialogueNode) {
  let end = Math.max(MIN_CLIP_DURATION, node.timeline.duration);

  if (node.dialogue) {
    end = Math.max(
      end,
      node.dialogue.startTime + node.dialogue.continueDelayTime,
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
  return Math.max(MIN_CLIP_DURATION, getGroupTimelineEnd(node) - clip.startTime);
}
