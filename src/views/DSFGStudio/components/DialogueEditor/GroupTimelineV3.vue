<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  DialogueClip,
  FocusPushClip,
  DialogueNode,
  PerformanceClip,
  PerformanceLine,
  PerformanceLineType,
  SelectClip,
} from "./types/DialogueNode";
import {
  createDialogueClip,
  createFocusPushClip,
  createPerformanceClip,
  createPerformanceLine,
  createSelectClip,
} from "./utils/dialogueProject";
import {
  getLineDefinition,
  getLineDefinitions,
} from "./config/lineRegistry";
import DialogueClipEditor from "./components/clip-editors/DialogueClipEditor.vue";
import FocusPushClipEditor from "./components/clip-editors/FocusPushClipEditor.vue";
import SelectClipEditor from "./components/clip-editors/SelectClipEditor.vue";
import PerformanceClipEditor from "./components/clip-editors/PerformanceClipEditor.vue";
import TimelineContextMenu from "./components/TimelineContextMenu.vue";
import {
  captureTimelineClip,
  findTimelineClip,
  pasteTimelineClip,
  timelineClipClipboard,
  timelinePasteHint,
  type TimelineLane,
} from "./utils/timelineClipClipboard";
import { usePublicEventPresets } from "../EntityPresetEditor/usePublicEventPresets";
import { getPublicEventClipLabel } from "./utils/publicEventParameters";
import { getCameraClipPreview } from "./config/cameraClip";
import { getGroupOutletWarnings } from "./utils/groupOutlets";
import { getDialogueClips, appendDialogueClip, removeDialogueClip } from "./utils/dialogueClips";
import {
  getFlowClipDuration,
  getGroupTimelineEnd,
  getGroupTimelineDisplayDuration,
  isInstantPerformanceClip,
  getPerformanceClipDuration,
  isFreeDialogueClip,
  MIN_CLIP_DURATION,
  type FlowClip,
} from "./utils/groupTimeline";

type SelectedClip =
  | { kind: "focusPush"; clip: FocusPushClip }
  | { kind: "dialogue"; clip: DialogueClip }
  | { kind: "select"; clip: SelectClip }
  | { kind: "performance"; line: PerformanceLine; clip: PerformanceClip };

const props = defineProps<{ node: DialogueNode; inspectorTarget?: HTMLElement }>();
const emit = defineEmits<{ close: []; inspectorOpen: [open: boolean] }>();
const { availablePresets: publicEventPresets } = usePublicEventPresets();

const viewportWidth = ref(918);
const timelineScrollRef = ref<HTMLElement>();
let timelineResizeObserver: ResizeObserver | undefined;
const labelWidth = 118;
const dialogueClips = computed(() => getDialogueClips(props.node));
const canAddDialogueClip = computed(() => dialogueClips.value.every(clip => clip.advanceMode === "None"));
const selectedId = ref(dialogueClips.value[0]?.id ?? "");
const addLineMenu = ref<HTMLDetailsElement>();
const footerLineMenu = ref<{ x: number; y: number; trigger: HTMLElement }>();
const sectionRef = ref<HTMLElement>();
const editorOpen = ref(false);
let outsideEditorCloseTimer: number | undefined;
let editorPointerDownInside = false;
const hoveredClip = ref<SelectedClip>();
const previewPosition = ref({ left: 0, top: 0 });
const timelineContextMenu = ref<{
  nodeId: string;
  lane: TimelineLane;
  clipId?: string;
  time: number;
  x: number;
  y: number;
  trigger: HTMLElement;
}>();
const contextClip = computed(() => timelineContextMenu.value?.clipId
  ? findTimelineClip(props.node, timelineContextMenu.value.clipId) : undefined);
const contextTrackAvailable = computed(() => {
  const lane = timelineContextMenu.value?.lane;
  return !!lane && (lane.kind === "dialogue" ? canAddDialogueClip.value : lane.kind === "performance"
    ? props.node.lines.some(line => line.id === lane.lineId) : !props.node[lane.kind]);
});
const contextPasteHint = computed(() => timelineContextMenu.value
  ? timelinePasteHint(props.node, timelineContextMenu.value.lane, timelineClipClipboard.value, timelineContextMenu.value.time) : "");
const contextMenuItems = computed(() => timelineContextMenu.value?.clipId ? [
  { id: "copy", label: "复制 Clip", disabled: !contextClip.value },
  { id: "delete", label: "删除 Clip", danger: true, disabled: !contextClip.value },
] : [
  { id: "add", label: "添加 Clip", disabled: !contextTrackAvailable.value },
  { id: "paste", label: "粘贴 Clip", disabled: !!contextPasteHint.value, hint: contextPasteHint.value },
]);
const lineDefinitions = getLineDefinitions().filter(
  (definition) => definition.removable && definition.type !== "Audio",
).sort((a, b) => {
  const priority = (type: PerformanceLineType) => type === "PublicEvent" ? 0 : type === "Custom" ? 1 : 2;
  return priority(a.type) - priority(b.type);
});

const outletWarnings = computed(() =>
  getGroupOutletWarnings(props.node),
);

const selectedClip = computed<SelectedClip | undefined>(() => {
  const dialogue = dialogueClips.value.find(clip => clip.id === selectedId.value);
  if (dialogue) {
    return { kind: "dialogue", clip: dialogue };
  }
  if (props.node.select && selectedId.value === props.node.select.id) {
    return { kind: "select", clip: props.node.select };
  }

  if (props.node.focusPush && selectedId.value === props.node.focusPush.id) {
    return { kind: "focusPush", clip: props.node.focusPush };
  }

  for (const line of props.node.lines) {
    const clip = line.clips.find((item) => item.id === selectedId.value);
    if (clip) return { kind: "performance", line, clip };
  }
  return undefined;
});

watch(() => editorOpen.value && Boolean(selectedClip.value), open => emit("inspectorOpen", open), { immediate: true, flush: "sync" });

const contentDuration = computed(() => getGroupTimelineEnd(props.node));
// Auto-fit must not change the coordinate system while a pointer gesture is active.
const gestureViewport = ref<{ displayDuration: number; pixelsPerSecond: number; canvasDuration: number }>();
const timelineDuration = computed(() =>
  gestureViewport.value?.displayDuration ?? getGroupTimelineDisplayDuration(props.node),
);
const pixelsPerSecond = computed(() => gestureViewport.value?.pixelsPerSecond
  ?? Math.max(1, viewportWidth.value - labelWidth - 24) / timelineDuration.value);
const canvasDuration = computed(() => Math.max(timelineDuration.value, contentDuration.value, gestureViewport.value?.canvasDuration ?? 0));
watch(contentDuration, end => {
  // Keep scrollLeft from being clamped when a dragged Clip shortens the content.
  if (gestureViewport.value) gestureViewport.value.canvasDuration = Math.max(gestureViewport.value.canvasDuration, end);
}, { flush: "sync" });
const timelineWidth = computed(
  () => labelWidth + canvasDuration.value * pixelsPerSecond.value + 24,
);
const tickStep = computed(() => {
  const target = Math.max(70 / pixelsPerSecond.value, canvasDuration.value / 2000);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return ([1, 2, 5, 10].find(value => value * magnitude >= target) ?? 10) * magnitude;
});
const ticks = computed(() => {
  const step = tickStep.value;
  return Array.from({ length: Math.floor(canvasDuration.value / step) + 1 }, (_, index) => Number((index * step).toPrecision(10)));
});
function updateDisplayDuration(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.valueAsNumber;
  if (input.value === "") delete props.node.timeline.displayDuration;
  else if (Number.isFinite(value) && value > 0) props.node.timeline.displayDuration = value;
  input.value = props.node.timeline.displayDuration?.toString() ?? "";
  if (timelineScrollRef.value) timelineScrollRef.value.scrollLeft = 0;
}

watch(
  () => props.node,
  () => {
    stopTimelineGesture();
    cancelOutsideEditorClose();
    resetEditorPointerDown();
    closeFooterLineMenu();
    closeTimelineContextMenu();
    selectedId.value = dialogueClips.value[0]?.id ?? "";
    editorOpen.value = false;
    hoveredClip.value = undefined;
    addLineMenu.value?.removeAttribute("open");
  },
  { flush: "sync" },
);

function closeLineMenu() {
  const footerTrigger = footerLineMenu.value?.trigger;
  closeFooterLineMenu();
  addLineMenu.value?.removeAttribute("open");
  (footerTrigger ?? addLineMenu.value?.querySelector("summary"))?.focus({ preventScroll: true });
}

function closeFooterLineMenu(restoreFocus = false) {
  const trigger = footerLineMenu.value?.trigger;
  footerLineMenu.value = undefined;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function openFooterLineMenu(event: MouseEvent) {
  closeLineMenu();
  closeTimelineContextMenu();
  const trigger = event.currentTarget as HTMLElement;
  const rect = trigger.getBoundingClientRect();
  footerLineMenu.value = { x: rect.left, y: rect.bottom + 6, trigger };
}

function closeLineMenuOutside(event: PointerEvent) {
  const menu = addLineMenu.value;
  if (menu?.open && !event.composedPath().includes(menu)) menu.open = false;
}

function addLine(type: PerformanceLineType) {
  if (!lineDefinitions.some(definition => definition.type === type)) return;
  props.node.lines.push(createPerformanceLine(type));
  closeLineMenu();
}

function addDialogueClip(startTime?: number) {
  if (!canAddDialogueClip.value) return;
  const previousEnd = dialogueClips.value.reduce((end, clip) => Math.max(end, clip.startTime + getFlowClipDuration(props.node, clip)), 0);
  const clip = createDialogueClip();
  clip.startTime = Math.max(previousEnd, Number.isFinite(startTime) ? startTime! : 0);
  appendDialogueClip(props.node, clip);
  selectedId.value = clip.id;
}

function addSelectClip() {
  if (props.node.select) return;
  const clip = createSelectClip();
  props.node.select = clip;
  selectedId.value = clip.id;
}

function addFocusPushClip() {
  if (props.node.focusPush) return;
  const clip = createFocusPushClip();
  props.node.focusPush = clip;
  selectedId.value = clip.id;
}

function deleteLine(line: PerformanceLine) {
  if (getLineDefinition(line.type)?.removable === false) return;
  const index = props.node.lines.findIndex((item) => item.id === line.id);
  if (index < 0) return;
  if (line.clips.some((clip) => clip.id === selectedId.value)) {
    selectedId.value = "";
    editorOpen.value = false;
  }
  props.node.lines.splice(index, 1);
}

function performanceClipLabel(clip: PerformanceClip) {
  if (clip.type === "PublicEvent") return getPublicEventClipLabel(clip, publicEventPresets.value);
  if (clip.type !== "Custom") return clip.name;
  const templateId = "custom.data";
  const value = clip.components.find(component => component.templateId === templateId)?.properties.value;
  return typeof value === "string" && value ? value : "未填写触发字符串";
}

function lineLabel(line: PerformanceLine) {
  return getLineDefinition(line.type)?.label ?? line.type;
}

function addPerformanceClip(line: PerformanceLine) {
  const startTime = line.clips.reduce(
    (maximum, clip) => Math.max(maximum, clip.startTime + (isInstantPerformanceClip(clip) ? 1 : clip.duration)),
    0,
  );
  const clip = createPerformanceClip(line.type, startTime);
  line.clips.push(clip);
  selectedId.value = clip.id;
}

function deleteSelectedClip() {
  const selected = selectedClip.value;
  if (!selected) return;
  if (selected.kind === "dialogue") {
    removeDialogueClip(props.node, selected.clip.id);
  } else if (selected.kind === "select") {
    props.node.select = undefined;
  } else if (selected.kind === "focusPush") {
    props.node.focusPush = undefined;
  } else {
    const index = selected.line.clips.findIndex(
      (clip) => clip.id === selected.clip.id,
    );
    if (index >= 0) selected.line.clips.splice(index, 1);
  }
  selectedId.value = "";
  editorOpen.value = false;
  hoveredClip.value = undefined;
}

function closeTimelineContextMenu(restoreFocus = false) {
  const trigger = timelineContextMenu.value?.trigger;
  timelineContextMenu.value = undefined;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}

function openTrackContextMenu(event: MouseEvent, lane: TimelineLane) {
  const row = event.currentTarget as HTMLElement;
  const onLabel = !!(event.target as Element).closest(".line-label");
  const time = onLabel ? (lane.kind === "focusPush" ? 1 : 0)
    : Math.max(0, Math.round((event.clientX - row.getBoundingClientRect().left - labelWidth) / pixelsPerSecond.value * 10) / 10);
  hoveredClip.value = undefined;
  closeLineMenu();
  timelineContextMenu.value = { nodeId: props.node.id, lane, time, x: event.clientX, y: event.clientY, trigger: row };
}

function openClipContextMenu(event: MouseEvent, selected: SelectedClip) {
  selectedId.value = selected.clip.id;
  hoveredClip.value = undefined;
  closeLineMenu();
  const lane: TimelineLane = selected.kind === "performance"
    ? { kind: "performance", lineId: selected.line.id } : { kind: selected.kind };
  timelineContextMenu.value = {
    nodeId: props.node.id, lane, clipId: selected.clip.id, time: selected.clip.startTime,
    x: event.clientX, y: event.clientY, trigger: event.currentTarget as HTMLElement,
  };
}

function timelineContextAction(action: string) {
  const target = timelineContextMenu.value;
  if (!target || target.nodeId !== props.node.id) {
    closeTimelineContextMenu();
    return;
  }
  if (target.clipId) {
    const selected = findTimelineClip(props.node, target.clipId);
    if (selected && action === "copy") timelineClipClipboard.value = captureTimelineClip(selected);
    if (selected && action === "delete") {
      selectedId.value = selected.clip.id;
      deleteSelectedClip();
    }
  } else if (action === "paste" && timelineClipClipboard.value) {
    const selected = pasteTimelineClip(props.node, target.lane, timelineClipClipboard.value, target.time);
    if (selected) selectedId.value = selected.clip.id;
  } else if (action === "add" && contextTrackAvailable.value) {
    if (target.lane.kind === "dialogue") addDialogueClip(target.time);
    else if (target.lane.kind === "select") addSelectClip();
    else if (target.lane.kind === "focusPush") addFocusPushClip();
    else {
      const lineId = target.lane.lineId;
      const line = props.node.lines.find(line => line.id === lineId);
      if (line) addPerformanceClip(line);
    }
    if (target.lane.kind !== "dialogue" && selectedClip.value) selectedClip.value.clip.startTime = target.time;
  }
  closeTimelineContextMenu(true);
}

function showPreview(event: PointerEvent, selected: SelectedClip) {
  if (gestureViewport.value) return;
  if (timelineContextMenu.value) return;
  if (editorOpen.value && selectedId.value === selected.clip.id) return;
  hoveredClip.value = selected;
  movePreview(event);
}

function movePreview(event: PointerEvent) {
  const section = sectionRef.value;
  if (!section || !hoveredClip.value) return;
  const rect = section.getBoundingClientRect();
  previewPosition.value = {
    left: Math.min(Math.max(8, event.clientX - rect.left + 12), rect.width - 230),
    top: Math.max(8, event.clientY - rect.top - 86),
  };
}

function hidePreview() {
  hoveredClip.value = undefined;
}

function cancelOutsideEditorClose() {
  if (outsideEditorCloseTimer !== undefined) window.clearTimeout(outsideEditorCloseTimer);
  outsideEditorCloseTimer = undefined;
}

function isEditorInteraction(event: Event) {
  const path = event.composedPath();
  return path.includes(props.inspectorTarget!) || path.some(target =>
    (target as Element).matches?.("[data-clip-editor], [data-timeline-clip]"));
}

function trackEditorPointerDown(event: PointerEvent) {
  editorPointerDownInside = event.button === 0 && isEditorInteraction(event);
}

function resetEditorPointerDown() {
  editorPointerDownInside = false;
}

function closeEditorFromOutside(event: MouseEvent) {
  // Dragging a text selection outside can send the click to a shared ancestor.
  const startedInside = event.type === "click" && event.detail > 0 && editorPointerDownInside;
  if (event.type === "click") resetEditorPointerDown();
  if (!editorOpen.value || startedInside || isEditorInteraction(event)) return;
  cancelOutsideEditorClose();
  // Finish the click first, so the graph's pane handler keeps the Timeline open.
  outsideEditorCloseTimer = window.setTimeout(() => {
    outsideEditorCloseTimer = undefined;
    editorOpen.value = false;
  }, 0);
}

function openEditor(_event: MouseEvent, selected: SelectedClip) {
  if (suppressClick) return;
  cancelOutsideEditorClose();
  selectedId.value = selected.clip.id;
  hoveredClip.value = undefined;
  editorOpen.value = true;
}

function updateStartTime(clip: TimelineClip, event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  clip.startTime = Math.max(0, value);
}

function updatePerformanceDuration(clip: PerformanceClip, event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  clip.duration = Math.max(clip.type === "PublicEvent" ? 0 : MIN_CLIP_DURATION, value);
}

function updateDialogueDuration(clip: DialogueClip, event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!isFreeDialogueClip(clip) || !Number.isFinite(value)) return;
  clip.duration = Math.max(MIN_CLIP_DURATION, value);
}

function updateContinueDelay(clip: FlowClip, event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  clip.continueDelayTime = Math.max(0, value);
}

type TimelineClip = DialogueClip | SelectClip | PerformanceClip | FocusPushClip;
type TimelineGesture = {
  pointerId: number;
  pointerStart: number;
  scrollStart: number;
  pixelsPerSecond: number;
  moved: boolean;
};

function beginTimelineGesture(event: PointerEvent): TimelineGesture {
  stopTimelineGesture();
  gestureViewport.value = {
    displayDuration: timelineDuration.value,
    pixelsPerSecond: pixelsPerSecond.value,
    canvasDuration: canvasDuration.value,
  };
  hoveredClip.value = undefined;
  return {
    pointerId: event.pointerId,
    pointerStart: event.clientX,
    scrollStart: timelineScrollRef.value?.scrollLeft ?? 0,
    pixelsPerSecond: pixelsPerSecond.value,
    moved: false,
  };
}

function isTimelineGesturePointer(event: Event | undefined, gesture: TimelineGesture) {
  return !event || !("pointerId" in event) || (event as PointerEvent).pointerId === gesture.pointerId;
}

function timelineGestureDelta(event: PointerEvent, gesture: TimelineGesture) {
  return event.clientX - gesture.pointerStart + (timelineScrollRef.value?.scrollLeft ?? 0) - gesture.scrollStart;
}

function listenTimelineGesture(move: (event: PointerEvent) => void, stop: (event?: Event) => void) {
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  window.addEventListener("blur", stop);
}

function finishTimelineGesture(move: (event: PointerEvent) => void, stop: (event?: Event) => void, moved: boolean) {
  window.removeEventListener("pointermove", move);
  window.removeEventListener("pointerup", stop);
  window.removeEventListener("pointercancel", stop);
  window.removeEventListener("blur", stop);
  gestureViewport.value = undefined;
  suppressClick = moved;
  window.setTimeout(() => { suppressClick = false; });
}

function stopTimelineGesture() {
  stopDrag();
  stopResize();
  stopContinueDelayDrag();
}

let dragging:
  | (TimelineGesture & {
      clip: TimelineClip;
      clipStart: number;
    })
  | undefined;

function startDrag(
  event: PointerEvent,
  clip: TimelineClip,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  selectedId.value = clip.id;
  dragging = {
    ...beginTimelineGesture(event),
    clip,
    clipStart: clip.startTime,
  };
  listenTimelineGesture(dragClip, stopDrag);
}

function dragClip(event: PointerEvent) {
  if (!dragging || !isTimelineGesturePointer(event, dragging)) return;
  const pixelDelta = timelineGestureDelta(event, dragging);
  const delta = pixelDelta / dragging.pixelsPerSecond;
  if (Math.abs(pixelDelta) > 3) {
    dragging.moved = true;
  }
  dragging.clip.startTime = Math.max(
    0,
    Math.round((dragging.clipStart + delta) * 10) / 10,
  );
}

function stopDrag(event?: Event) {
  if (!dragging || !isTimelineGesturePointer(event, dragging)) return;
  const moved = dragging.moved;
  dragging = undefined;
  finishTimelineGesture(dragClip, stopDrag, moved);
}

let resizing:
  | (TimelineGesture & {
      clip: TimelineClip;
      boundary: "start" | "end";
      clipStart: number;
      clipDuration: number;
    })
  | undefined;

function startResize(
  event: PointerEvent,
  clip: TimelineClip,
  boundary: "start" | "end",
) {
  if (event.button !== 0 || ("type" in clip && isInstantPerformanceClip(clip))) return;
  if (boundary === "end" && !("type" in clip) && !isFreeDialogueClip(clip)) return;
  event.preventDefault();
  event.stopPropagation();
  selectedId.value = clip.id;
  resizing = {
    ...beginTimelineGesture(event),
    clip,
    boundary,
    clipStart: clip.startTime,
    clipDuration: clipDisplayDuration(clip),
  };
  listenTimelineGesture(resizeClip, stopResize);
}

function resizeClip(event: PointerEvent) {
  if (!resizing || !isTimelineGesturePointer(event, resizing)) return;
  const pixelDelta = timelineGestureDelta(event, resizing);
  const timeDelta = pixelDelta / resizing.pixelsPerSecond;
  if (Math.abs(pixelDelta) > 3) resizing.moved = true;

  if (resizing.boundary === "start") {
    const originalEnd = resizing.clipStart + resizing.clipDuration;
    const nextStart = Math.min(
      originalEnd - 0.1,
      Math.max(0, Math.round((resizing.clipStart + timeDelta) * 10) / 10),
    );
    resizing.clip.startTime = nextStart;
    if ("type" in resizing.clip || isFreeDialogueClip(resizing.clip)) {
      resizing.clip.duration = Math.max(
        MIN_CLIP_DURATION,
        Math.round((originalEnd - nextStart) * 10) / 10,
      );
    }
    return;
  }

  if ("type" in resizing.clip || isFreeDialogueClip(resizing.clip)) {
    resizing.clip.duration = Math.max(
      MIN_CLIP_DURATION,
      Math.round((resizing.clipDuration + timeDelta) * 10) / 10,
    );
  }
}

function stopResize(event?: Event) {
  if (!resizing || !isTimelineGesturePointer(event, resizing)) return;
  const moved = resizing.moved;
  resizing = undefined;
  finishTimelineGesture(resizeClip, stopResize, moved);
}

function clipDisplayDuration(clip: TimelineClip) {
  return "type" in clip
    ? getPerformanceClipDuration(clip)
    : "continueDelayTime" in clip ? getFlowClipDuration(props.node, clip) : 0;
}

let continueDelayDragging:
  | (TimelineGesture & {
      clip: FlowClip;
      delayStart: number;
    })
  | undefined;

function startContinueDelayDrag(event: PointerEvent, clip: FlowClip) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectedId.value = clip.id;
  continueDelayDragging = {
    ...beginTimelineGesture(event),
    clip,
    delayStart: clip.continueDelayTime,
  };
  listenTimelineGesture(dragContinueDelay, stopContinueDelayDrag);
}

function dragContinueDelay(event: PointerEvent) {
  if (!continueDelayDragging || !isTimelineGesturePointer(event, continueDelayDragging)) return;
  const pixelDelta = timelineGestureDelta(event, continueDelayDragging);
  if (Math.abs(pixelDelta) > 3) continueDelayDragging.moved = true;
  continueDelayDragging.clip.continueDelayTime = Math.max(
    0,
    Math.round(
      (continueDelayDragging.delayStart + pixelDelta / continueDelayDragging.pixelsPerSecond) * 10,
    ) / 10,
  );
}

function stopContinueDelayDrag(event?: Event) {
  if (!continueDelayDragging || !isTimelineGesturePointer(event, continueDelayDragging)) return;
  const moved = continueDelayDragging.moved;
  continueDelayDragging = undefined;
  finishTimelineGesture(dragContinueDelay, stopContinueDelayDrag, moved);
}

let suppressClick = false;

onMounted(() => {
  window.addEventListener("click", closeEditorFromOutside, true);
  window.addEventListener("contextmenu", closeEditorFromOutside, true);
  window.addEventListener("pointerdown", trackEditorPointerDown, true);
  window.addEventListener("pointercancel", resetEditorPointerDown, true);
  window.addEventListener("blur", resetEditorPointerDown);
  window.addEventListener("pointerdown", closeLineMenuOutside, true);
  timelineResizeObserver = new ResizeObserver(() => {
    if (timelineScrollRef.value) viewportWidth.value = timelineScrollRef.value.clientWidth;
  });
  if (timelineScrollRef.value) {
    viewportWidth.value = timelineScrollRef.value.clientWidth;
    timelineResizeObserver.observe(timelineScrollRef.value);
  }
});
onBeforeUnmount(() => {
  closeFooterLineMenu();
  cancelOutsideEditorClose();
  window.removeEventListener("click", closeEditorFromOutside, true);
  window.removeEventListener("contextmenu", closeEditorFromOutside, true);
  window.removeEventListener("pointerdown", trackEditorPointerDown, true);
  window.removeEventListener("pointercancel", resetEditorPointerDown, true);
  window.removeEventListener("blur", resetEditorPointerDown);
  closeTimelineContextMenu();
  window.removeEventListener("pointerdown", closeLineMenuOutside, true);
  emit("inspectorOpen", false);
  timelineResizeObserver?.disconnect();
  stopTimelineGesture();
});
</script>

<template>
  <section ref="sectionRef" class="group-timeline-v3">
    <header class="timeline-toolbar">
      <span class="timeline-eyebrow">GROUP TIMELINE</span>

      <div class="timeline-actions">
        <label class="display-duration-control" title="设置可见宽度内的时长；清空后自动计算。超出部分可横向滚动查看。">
          显示时长（秒）
          <input type="number" min="0.1" step="0.1" aria-label="Timeline 显示时长（秒）" :placeholder="`自动（${timelineDuration}）`" :value="node.timeline.displayDuration ?? ''" @change="updateDisplayDuration" />
        </label>
        <details ref="addLineMenu" class="add-line-menu" @keydown.esc.prevent.stop="closeLineMenu">
          <summary class="primary-button" aria-label="添加事件行">＋ 添加事件</summary>
          <div class="add-line-options">
            <button v-for="definition in lineDefinitions" :key="definition.type" type="button" @click="addLine(definition.type)">添加{{ definition.label }}</button>
          </div>
        </details>
        <button
          type="button"
          :disabled="!selectedClip"
          @click="deleteSelectedClip"
        >
          删除 Clip
        </button>
        <button type="button" aria-label="关闭 Timeline" @click="emit('close')">
          ×
        </button>
      </div>
    </header>

    <div v-if="outletWarnings.length" class="timeline-warnings">
      <span
        v-for="warning in outletWarnings"
        :key="warning"
        class="timeline-warning"
      >
        ⚠ {{ warning }}
      </span>
    </div>

    <div class="timeline-body">
      <div ref="timelineScrollRef" class="timeline-scroll">
        <div class="timeline-canvas" :style="{ width: `${timelineWidth}px`, backgroundSize: `${tickStep * pixelsPerSecond}px 100%` }">
          <div class="timeline-ruler">
            <div class="ruler-corner">LINE / TIME</div>
            <span
              v-for="tick in ticks"
              :key="tick"
              class="timeline-tick"
              :style="{ left: `${labelWidth + tick * pixelsPerSecond}px` }"
            >
              {{ tick }}s
            </span>
          </div>

          <div class="timeline-row dialogue-row" @contextmenu.prevent.stop="openTrackContextMenu($event, { kind: 'dialogue' })">
            <div class="line-label dialogue-label">
              <div><strong>对话</strong><small>{{ dialogueClips.length }} 段台词</small></div>
              <div class="line-buttons">
                <button type="button" aria-label="添加对话 Clip" :disabled="!canAddDialogueClip"
                  :title="canAddDialogueClip ? '在末尾添加对话片段' : '将末尾对话设为不触发按下后，可继续添加'"
                  @click="addDialogueClip()">＋</button>
              </div>
            </div>
            <button
              v-for="clip in dialogueClips"
              :key="clip.id"
              type="button"
              data-timeline-clip
              class="timeline-clip dialogue-clip resizable-clip"
              :class="{ selected: selectedId === clip.id, 'waiting-dialogue-clip': !isFreeDialogueClip(clip) }"
              :style="{
                left: `${labelWidth + clip.startTime * pixelsPerSecond}px`,
                width: isFreeDialogueClip(clip) ? `${getFlowClipDuration(node, clip) * pixelsPerSecond}px` : undefined,
              }"
              @pointerdown="startDrag($event, clip)"
              @contextmenu.prevent.stop="openClipContextMenu($event, { kind: 'dialogue', clip })"
              @pointerenter="
                showPreview($event, { kind: 'dialogue', clip })
              "
              @pointermove="movePreview"
              @pointerleave="hidePreview"
              @click.stop="
                openEditor($event, { kind: 'dialogue', clip })
              "
            >
              <i
                class="clip-resize-handle resize-start"
                title="拖动设置开始时间"
                @pointerdown.stop="startResize($event, clip, 'start')"
              />
              <span>{{ clip.content || "未填写台词" }}</span>
              <small>
                {{ clip.startTime.toFixed(1) }}s
                <template v-if="isFreeDialogueClip(clip)"> + {{ getFlowClipDuration(node, clip).toFixed(1) }}s</template>
                <template v-else> → 时间轴末尾</template>
              </small>
              <i v-if="isFreeDialogueClip(clip)" class="clip-resize-handle resize-end"
                title="拖动设置持续时间" @pointerdown.stop="startResize($event, clip, 'end')" />
              <i
                class="continue-delay-handle"
                :class="{ disabled: clip.advanceMode === 'None' }"
                :style="{
                  left: `${clip.continueDelayTime * pixelsPerSecond}px`,
                }"
                title="拖动设置 ContinueDelayTime"
                @pointerdown.stop="startContinueDelayDrag($event, clip)"
              >
                <em>{{ clip.continueDelayTime.toFixed(1) }}s</em>
              </i>
            </button>
            <button
              v-if="!dialogueClips.length"
              type="button"
              class="empty-line"
              :style="{ left: `${labelWidth + 16}px` }"
              @click="addDialogueClip()"
            >
              ＋ 添加 对话片段
            </button>
          </div>

          <div class="timeline-row select-row" @contextmenu.prevent.stop="openTrackContextMenu($event, { kind: 'select' })">
            <div class="line-label select-label">
              <strong>选项卡</strong>
              <small>可选 · 固定单 Clip</small>
            </div>
            <button
              v-if="node.select"
              type="button"
              data-timeline-clip
              class="timeline-clip select-clip resizable-clip"
              :class="{ selected: selectedId === node.select.id }"
              :style="{
                left: `${labelWidth + node.select.startTime * pixelsPerSecond}px`,
              }"
              @pointerdown="startDrag($event, node.select)"
              @contextmenu.prevent.stop="openClipContextMenu($event, { kind: 'select', clip: node.select })"
              @pointerenter="
                showPreview($event, { kind: 'select', clip: node.select })
              "
              @pointermove="movePreview"
              @pointerleave="hidePreview"
              @click.stop="
                openEditor($event, { kind: 'select', clip: node.select })
              "
            >
              <i
                class="clip-resize-handle resize-start"
                title="拖动设置开始时间"
                @pointerdown.stop="startResize($event, node.select, 'start')"
              />
              <span>{{ node.select.options.length }} 个选项</span>
              <small>
                {{ node.select.startTime.toFixed(1) }}s →
                时间轴末尾
              </small>
              <i
                class="continue-delay-handle"
                :style="{
                  left: `${node.select.continueDelayTime * pixelsPerSecond}px`,
                }"
                title="拖动设置 ContinueDelayTime"
                @pointerdown.stop="startContinueDelayDrag($event, node.select)"
              >
                <em>{{ node.select.continueDelayTime.toFixed(1) }}s</em>
              </i>
            </button>
            <button
              v-else
              type="button"
              class="empty-line"
              :style="{ left: `${labelWidth + 16}px` }"
              @click="addSelectClip"
            >
              ＋ 添加 选项卡片段
            </button>
          </div>

          <div class="timeline-row focus-push-row" @contextmenu.prevent.stop="openTrackContextMenu($event, { kind: 'focusPush' })">
            <div class="line-label">
              <div><strong>强制跳过</strong><small>强制跳过 · 单 Clip</small></div>
            </div>
            <button
              v-if="node.focusPush"
              type="button"
              data-timeline-clip
              class="timeline-clip focus-push-clip"
              :class="{ selected: selectedId === node.focusPush.id }"
              :style="{ left: `${labelWidth + node.focusPush.startTime * pixelsPerSecond}px` }"
              @pointerdown="startDrag($event, node.focusPush)"
              @contextmenu.prevent.stop="openClipContextMenu($event, { kind: 'focusPush', clip: node.focusPush })"
              @pointerenter="showPreview($event, { kind: 'focusPush', clip: node.focusPush })"
              @pointermove="movePreview"
              @pointerleave="hidePreview"
              @click.stop="openEditor($event, { kind: 'focusPush', clip: node.focusPush })"
            >
              <span>◆ 强制跳过</span>
              <small>{{ node.focusPush.startTime.toFixed(1) }}s</small>
            </button>
            <button v-else type="button" class="empty-line"
              :style="{ left: `${labelWidth + 16}px` }" @click="addFocusPushClip">
              ＋ 添加 强制跳过片段
            </button>
          </div>

          <div
            v-for="line in node.lines"
            :key="line.id"
            class="timeline-row"
            @contextmenu.prevent.stop="openTrackContextMenu($event, { kind: 'performance', lineId: line.id })"
          >
            <div class="line-label">
              <div>
                <strong>{{ line.name === line.type ? lineLabel(line) : line.name }}</strong>
                <small>{{ lineLabel(line) }}片段</small>
              </div>
              <div class="line-buttons">
                <button
                  type="button"
                  :aria-label="`在 ${line.name} 添加 Clip`"
                  @click="addPerformanceClip(line)"
                >
                  ＋
                </button>
                <button
                  v-if="getLineDefinition(line.type)?.removable !== false"
                  type="button"
                  :aria-label="`删除 ${line.name} Line`"
                  @click="deleteLine(line)"
                >
                  ×
                </button>
              </div>
            </div>

            <button
              v-for="clip in line.clips"
              :key="clip.id"
              type="button"
              data-timeline-clip
              class="timeline-clip performance-clip resizable-clip"
              :class="[
                `clip-${line.type.toLowerCase()}`,
                { selected: selectedId === clip.id },
              ]"
              :style="{
                left: `${labelWidth + clip.startTime * pixelsPerSecond}px`,
                width: isInstantPerformanceClip(clip) ? undefined : `${Math.max(clip.duration, 0.1) * pixelsPerSecond}px`,
              }"
              @pointerdown="startDrag($event, clip)"
              @contextmenu.prevent.stop="openClipContextMenu($event, { kind: 'performance', line, clip })"
              @pointerenter="
                showPreview($event, { kind: 'performance', line, clip })
              "
              @pointermove="movePreview"
              @pointerleave="hidePreview"
              @click.stop="
                openEditor($event, { kind: 'performance', line, clip })
              "
            >
              <i
                v-if="!isInstantPerformanceClip(clip)"
                class="clip-resize-handle resize-start"
                title="拖动设置开始时间"
                @pointerdown.stop="startResize($event, clip, 'start')"
              />
              <span :title="performanceClipLabel(clip)">{{ performanceClipLabel(clip) }}</span>
              <small>
                {{ clip.startTime.toFixed(1) }}s
                <template v-if="!isInstantPerformanceClip(clip)"> + {{ clip.duration.toFixed(1) }}s</template>
              </small>
              <i
                v-if="!isInstantPerformanceClip(clip)"
                class="clip-resize-handle resize-end"
                title="拖动设置持续时间"
                @pointerdown.stop="startResize($event, clip, 'end')"
              />
            </button>

            <button
              v-if="!line.clips.length"
              type="button"
              class="empty-line"
              :style="{ left: `${labelWidth + 16}px` }"
              @click="addPerformanceClip(line)"
            >
              ＋ 添加 {{ lineLabel(line) }}片段
            </button>
          </div>
          <div class="timeline-add-event">
            <button type="button" class="add-event-button" aria-haspopup="menu" :aria-expanded="!!footerLineMenu"
              @click="openFooterLineMenu">＋ 添加事件</button>
          </div>
        </div>
      </div>

    </div>

    <TimelineContextMenu v-if="footerLineMenu"
      :position="{ x: footerLineMenu.x, y: footerLineMenu.y }" title="添加事件"
      :items="lineDefinitions.map(definition => ({ id: definition.type, label: `添加${definition.label}` }))"
      @select="addLine" @close="closeFooterLineMenu" />

    <TimelineContextMenu v-if="timelineContextMenu"
      :position="{ x: timelineContextMenu.x, y: timelineContextMenu.y }"
      :title="timelineContextMenu.clipId ? 'Clip 操作' : `轨道 · ${timelineContextMenu.time.toFixed(1)}s`"
      :items="contextMenuItems" @select="timelineContextAction" @close="closeTimelineContextMenu" />

    <div
      v-if="hoveredClip && !editorOpen && !timelineContextMenu"
      class="clip-preview"
      :style="{
        left: `${previewPosition.left}px`,
        top: `${previewPosition.top}px`,
      }"
    >
      <strong>
        {{
          hoveredClip.kind === "dialogue"
            ? "对话片段"
            : hoveredClip.kind === "select"
              ? "选项卡片段"
              : hoveredClip.kind === "focusPush" ? "强制跳过片段" : `${lineLabel(hoveredClip.line)}片段`
        }}
      </strong>
      <span v-if="hoveredClip.kind === 'dialogue'">
        {{ hoveredClip.clip.speaker || "未设置说话人" }}：{{
          hoveredClip.clip.content || "未填写台词"
        }}
      </span>
      <span v-else-if="hoveredClip.kind === 'select'">
        {{ hoveredClip.clip.options.length }} 个选项 · {{ hoveredClip.clip.style }}
      </span>
      <span v-else-if="hoveredClip.kind === 'focusPush'">时间到达后强制播放连接的下一句话</span>
      <span v-else>{{ performanceClipLabel(hoveredClip.clip) }}</span>
      <template v-if="hoveredClip.kind === 'performance' && hoveredClip.clip.type === 'Camera'">
        <span v-for="(summary, index) in getCameraClipPreview(hoveredClip.clip)" :key="index">
          {{ summary }}
        </span>
      </template>
      <small>
        开始 {{ hoveredClip.clip.startTime.toFixed(1) }}s
        <template v-if="clipDisplayDuration(hoveredClip.clip) > 0">
          · 持续 {{ clipDisplayDuration(hoveredClip.clip).toFixed(1) }}s
        </template>
      </small>
    </div>

    <Teleport :to="inspectorTarget || 'body'">
      <aside
        v-if="editorOpen && selectedClip"
        data-clip-editor
        class="clip-editor-popover dsfg-typography"
        :class="{ 'camera-popover': selectedClip.kind === 'performance' && selectedClip.clip.type === 'Camera', 'clip-editor-docked': inspectorTarget }"
        aria-label="Clip 参数"
      >
        <header class="popover-header">
          <span>
            {{
              selectedClip.kind === "dialogue"
                ? "对话片段"
                : selectedClip.kind === "select"
                  ? "选项卡片段"
                  : selectedClip.kind === "focusPush" ? "强制跳过片段" : selectedClip.clip.type === 'Camera' ? '相机设置' : `${lineLabel(selectedClip.line)}片段`
            }}
          </span>
          <button type="button" aria-label="关闭 Clip 参数" @click="editorOpen = false">
            ×
          </button>
        </header>

        <div :key="selectedClip.clip.id" class="popover-content">
          <DialogueClipEditor
            v-if="selectedClip.kind === 'dialogue'"
            :clip="selectedClip.clip"
            :duration="getFlowClipDuration(node, selectedClip.clip)"
          />
          <SelectClipEditor
            v-else-if="selectedClip.kind === 'select'"
            :clip="selectedClip.clip"
          />
          <FocusPushClipEditor
            v-else-if="selectedClip.kind === 'focusPush'"
            :clip="selectedClip.clip"
            :node="node"
          />
          <PerformanceClipEditor
            v-else
            :clip="selectedClip.clip"
          />

          <div v-if="selectedClip.kind !== 'focusPush'" class="number-fields">
            <label>
              开始时间
              <input
                type="number"
                min="0"
                step="0.1"
                :value="selectedClip.clip.startTime"
                @input="updateStartTime(selectedClip.clip, $event)"
              />
            </label>
            <label v-if="selectedClip.kind === 'performance' && !isInstantPerformanceClip(selectedClip.clip)">
              持续时间
              <input
                type="number"
                step="0.1"
                :value="selectedClip.clip.duration"
                :min="selectedClip.clip.type === 'PublicEvent' ? 0 : MIN_CLIP_DURATION"
                @input="updatePerformanceDuration(selectedClip.clip, $event)"
              />
            </label>
            <label v-else-if="selectedClip.kind !== 'performance'">
              ContinueDelayTime
              <input
                type="number"
                min="0"
                step="0.1"
                :value="selectedClip.clip.continueDelayTime"
                @input="updateContinueDelay(selectedClip.clip, $event)"
              />
            </label>
            <label v-if="selectedClip.kind === 'dialogue' && isFreeDialogueClip(selectedClip.clip)">
              持续时间
              <input type="number" :min="MIN_CLIP_DURATION" step="0.1"
                :value="getFlowClipDuration(node, selectedClip.clip)" @input="updateDialogueDuration(selectedClip.clip, $event)" />
            </label>
          </div>
        </div>
      </aside>
    </Teleport>
  </section>
</template>

<style scoped>
/* Variables are also declared on the teleported inspector, so shared editors
   only adopt the light palette when opened from this Timeline. */
.group-timeline-v3, .clip-editor-popover {
  --timeline-field: #fff;
  --timeline-surface: #f7f9fd;
  --timeline-soft: #eef3f9;
  --timeline-border: #cbd7e6;
  --timeline-text: #334155;
  --timeline-muted: #64748b;
  --timeline-subtle: #71839a;
  --timeline-accent: #2877c7;
  --timeline-active: #e2edfc;
  --timeline-active-text: #245a98;
  --timeline-warning: #94651c;
  --timeline-danger: #b45367;
  --timeline-success: #338460;
  --timeline-axis-blue: #3579b8;
  color-scheme: light;
}

.group-timeline-v3 {
  position: relative;
  display: flex;
  flex: 0 0 360px;
  flex-direction: column;
  min-height: 0;
  color: #334155;
  background: #f8faff;
  border-top: 1px solid #cbd7e6;
}

.timeline-toolbar,
.timeline-body,
.timeline-actions,
.number-fields,
.line-label,
.line-buttons {
  display: flex;
}

.timeline-toolbar {
  position: relative;
  z-index: 2;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-height: 46px;
  flex-wrap: wrap;
  flex-shrink: 0;
  border-bottom: 1px solid #dbe3ed;
  padding: 8px 12px;
  background: #eef3f9;
}

.timeline-actions,
.line-label,
.line-buttons {
  align-items: center;
}

.timeline-eyebrow {
  color: #5273a0;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.timeline-actions select,
.clip-editor-popover input,
.clip-editor-popover textarea {
  box-sizing: border-box;
  color: #334155;
  background: #fff;
  border: 1px solid #cbd7e6;
  border-radius: 5px;
}

.timeline-actions {
  flex-wrap: wrap;
  gap: 7px;
}

.display-duration-control {
  display: flex;
  gap: 5px;
  align-items: center;
  color: #64748b;
  font-size: 10px;
  flex-shrink: 0;
  white-space: nowrap;
}

.display-duration-control input {
  box-sizing: border-box;
  width: 140px;
  height: 30px;
  flex-shrink: 0;
  padding: 0 10px;
  font-size: 12px;
  color: #334155;
  background: #fff;
  border: 1px solid #cbd7e6;
  border-radius: 5px;
}

.timeline-actions button,
.timeline-actions summary,
.timeline-actions select,
.line-buttons button {
  height: 30px;
  padding: 0 9px;
  color: #475569;
  background: #fff;
  border: 1px solid #cbd7e6;
  border-radius: 5px;
  cursor: pointer;
}

.timeline-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.timeline-actions .primary-button {
  color: white;
  background: #2877c7;
  border-color: #1764b2;
}

.add-line-menu { position: relative; }
.add-line-menu summary { display: flex; align-items: center; box-sizing: border-box; list-style: none; user-select: none; }
.add-line-menu summary::-webkit-details-marker { display: none; }
.add-line-options { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; display: grid; gap: 4px; width: 160px; padding: 6px; border: 1px solid #cbd7e6; border-radius: 8px; background: #fff; box-shadow: 0 8px 24px #35487420; }
.add-line-options button { width: 100%; border-color: transparent; text-align: left; }
.add-line-options button:hover { background: #edf3ff; color: #245a98; }
.add-line-menu :is(summary, button):focus-visible { outline: 2px solid #54a8ff; outline-offset: 2px; }

.timeline-body {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.timeline-warnings {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  min-height: 30px;
  overflow-x: auto;
  padding: 4px 12px;
  color: #94651c;
  background: #fff8e8;
  border-top: 1px solid #ead7ae;
  border-bottom: 1px solid #ead7ae;
  font-size: 10px;
  white-space: nowrap;
}

.timeline-warning {
  flex: 0 0 auto;
}

.timeline-scroll {
  /* Keep scrolled Clip hit areas inside this viewport, including under
     the filtered SectionLayout ancestor and the sticky ruler. */
  position: relative;
  isolation: isolate;
  contain: paint;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.timeline-canvas {
  min-width: 100%;
  min-height: 100%;
  background-image: linear-gradient(
    90deg,
    transparent calc(100% - 1px),
    rgba(124, 145, 173, 0.14) 0
  );
  background-position-x: 118px;
  background-size: 80px 100%;
}

.timeline-ruler {
  position: sticky;
  top: 0;
  z-index: 5;
  height: 30px;
  color: #64748b;
  background: #f1f5fa;
  border-bottom: 1px solid #dbe3ed;
}

.ruler-corner {
  position: sticky;
  left: 0;
  z-index: 7;
  box-sizing: border-box;
  width: 118px;
  height: 30px;
  padding: 9px 10px;
  color: #64748b;
  background: #eaf0f8;
  border-right: 1px solid #dbe3ed;
  font-size: 9px;
}

.timeline-tick {
  position: absolute;
  top: 8px;
  padding-left: 5px;
  font-size: 10px;
}

.timeline-row {
  position: relative;
  isolation: isolate;
  height: 58px;
  background: rgba(255, 255, 255, 0.55);
  border-bottom: 1px solid #e0e7f0;
}

.timeline-add-event {
  position: sticky;
  left: 0;
  box-sizing: border-box;
  width: 118px;
  padding: 10px 8px 16px;
}
.add-event-button {
  width: 100%;
  padding: 8px 4px;
  border: 1px dashed #a8c2e3;
  border-radius: 6px;
  background: #fff;
  color: #5273a0;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.add-event-button:hover { background: #edf3ff; border-color: #6da0df; color: #245a98; }

.dialogue-row {
  background: rgba(219, 234, 254, 0.3);
}

.focus-push-row { background: rgba(254, 243, 199, 0.25); }
.focus-push-clip { background: #f9ecd4; border: 1px solid #dbbe87; }

.select-row {
  background: rgba(237, 233, 254, 0.35);
}

.line-label {
  position: sticky;
  left: 0;
  z-index: 4;
  box-sizing: border-box;
  justify-content: space-between;
  width: 118px;
  height: 58px;
  padding: 8px;
  background: #eef3f9;
  border-right: 1px solid #dbe3ed;
}

.line-label strong,
.line-label small {
  display: block;
}

.line-label strong {
  font-size: 11px;
}

.line-label small {
  margin-top: 3px;
  color: #7b8ba1;
  font-size: 9px;
}

.line-buttons {
  gap: 3px;
}

.line-buttons button {
  width: 23px;
  height: 23px;
  padding: 0;
}

.timeline-clip {
  position: absolute;
  top: 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 28px;
  height: 36px;
  overflow: hidden;
  padding: 0 8px;
  color: #334155;
  border-radius: 5px;
  cursor: grab;
  user-select: none;
}

.timeline-clip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-clip small {
  margin-left: 8px;
  opacity: 0.72;
}

.waiting-dialogue-clip,
.select-clip {
  /* 流程 Clip 在视觉上延伸至时间轴末尾，不以屏幕宽度改变业务时长。 */
  right: 0;
}

.dialogue-clip {
  background: #dceaff;
  border: 1px solid #94b8e8;
}

.resizable-clip {
  padding-inline: 12px;
}

.clip-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 9px;
  cursor: ew-resize;
}

.clip-resize-handle::after {
  position: absolute;
  top: 8px;
  bottom: 8px;
  width: 2px;
  content: "";
  background: rgba(59, 89, 130, 0.55);
  border-radius: 1px;
}

.resize-start {
  left: 0;
}

.resize-start::after {
  left: 3px;
}

.resize-end {
  right: 0;
}

.resize-end::after {
  right: 3px;
}

.continue-delay-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 3;
  width: 10px;
  cursor: ew-resize;
  transform: translateX(-50%);
}

.continue-delay-handle::after {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 4px;
  width: 2px;
  content: "";
  background: #ffd074;
  border-radius: 1px;
  box-shadow: 0 0 5px rgba(255, 190, 75, 0.75);
}

.continue-delay-handle em {
  position: absolute;
  top: 2px;
  left: 8px;
  padding: 1px 3px;
  color: #ffe4aa;
  background: rgba(63, 45, 19, 0.9);
  border-radius: 3px;
  font-size: 8px;
  font-style: normal;
  line-height: 1.2;
  white-space: nowrap;
}

.continue-delay-handle.disabled {
  opacity: 0.45;
}

.select-clip {
  background: #ece3fa;
  border: 1px solid #c1a8df;
}

.clip-camera {
  background: #e7e3fa;
  border: 1px solid #b3a5df;
}

.clip-publicevent {
  background: #dff3ef;
  border: 1px solid #9bcdbf;
}

.clip-playerskill {
  background: #dceff7;
  border: 1px solid #9dcbdc;
}

.clip-animation {
  background: #f9ecd4;
  border: 1px solid #dbbe87;
}

.clip-audio {
  background: #dcf1e8;
  border: 1px solid #99cdbb;
}

.clip-behavior,
.clip-custom {
  background: #f4e3e9;
  border: 1px solid #d6acba;
}

.timeline-clip.selected {
  box-shadow: 0 0 0 2px #488aeb;
}

.empty-line {
  position: absolute;
  top: 14px;
  padding: 7px 12px;
  color: #687d98;
  background: transparent;
  border: 1px dashed #b8c9de;
  border-radius: 5px;
  cursor: pointer;
}

.clip-preview,
.clip-editor-popover {
  position: absolute;
  z-index: 20;
  box-sizing: border-box;
  color: #334155;
  background: #fff;
  border: 1px solid #cbd7e6;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(38, 59, 90, 0.18);
}

.clip-preview {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 220px;
  padding: 9px 11px;
  pointer-events: none;
}

.clip-preview strong {
  color: #315b8e;
  font-size: 11px;
}

.clip-preview span {
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-preview small {
  color: #64748b;
  font-size: 10px;
}

.clip-editor-popover {
  position: fixed;
  top: 84px;
  right: 12px;
  bottom: 12px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  width: min(335px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: hidden;
}

.popover-header {
  flex: 0 0 auto;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 0 10px 0 12px;
  color: #315b8e;
  background: #eef3f9;
  border-bottom: 1px solid #dbe3ed;
  font-size: 11px;
  font-weight: 700;
}

.popover-header button {
  width: 25px;
  height: 25px;
  color: #64748b;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}

.popover-header button:hover {
  background: #e1eaf6;
}

.popover-content {
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px 12px;
}

.clip-editor-popover label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  color: #64748b;
  font-size: 11px;
}

.clip-editor-popover textarea,
.clip-editor-popover input {
  width: 100%;
  padding: 7px;
  resize: none;
}

.number-fields {
  gap: 8px;
}

.number-fields label {
  flex: 1;
}
.camera-popover { width: min(420px, calc(100vw - 24px)); border-color: #cbd7e6; border-radius: 12px; background: #fff; }
.camera-popover .popover-header { min-height: 46px; padding: 0 16px; color: #315b8e; background: #eef3f9; font-size: 13px; }
.camera-popover .popover-content { display: flex; flex-direction: column; padding: 16px; scrollbar-width: thin; scrollbar-color: #b8c9de transparent; }
.camera-popover .number-fields { display: flex; order: -1; gap: 12px; margin-bottom: 14px; }
.camera-popover .number-fields label { min-width: 0; margin: 0; font-size: 11px; }
.camera-popover .number-fields input { box-sizing: border-box; padding: 9px 10px; border: 1px solid #cbd7e6; border-radius: 7px; background: #fff; font-size: 12px; font-family: inherit; }
.clip-editor-popover.clip-editor-docked { position: static; width: 100%; height: 100%; max-height: none; border: 0; border-radius: 0; box-shadow: none; }
.clip-editor-docked .popover-header { min-height: 48px; padding: 0 16px; background: #f5f8fe; font-size: 14px; }
.clip-editor-docked .popover-content { flex: 1; padding: 16px; }

.timeline-actions button:not(:disabled):hover, .line-buttons button:hover { background: #e6eefb; border-color: #94b8e8; }
.timeline-actions .primary-button:not(:disabled):hover { color: #fff; background: #1e69b5; }
.empty-line:hover { color: #246bb2; background: #eaf2ff; border-color: #8fb2df; }
.timeline-clip.selected { outline: 1px solid #fff; outline-offset: -2px; }
.group-timeline-v3 button:focus-visible, .group-timeline-v3 select:focus-visible,
.group-timeline-v3 input:focus-visible, .clip-editor-popover :deep(button:focus-visible),
.clip-editor-popover :deep(input:focus-visible), .clip-editor-popover :deep(select:focus-visible),
.clip-editor-popover :deep(textarea:focus-visible) { outline: 2px solid #488aeb; outline-offset: 2px; }
.timeline-scroll, .popover-content { scrollbar-width: thin; scrollbar-color: #b8c9de transparent; }
.clip-editor-popover :deep(input), .clip-editor-popover :deep(textarea), .clip-editor-popover :deep(select), .clip-editor-popover :deep(button) { font-family: inherit; }
</style>
