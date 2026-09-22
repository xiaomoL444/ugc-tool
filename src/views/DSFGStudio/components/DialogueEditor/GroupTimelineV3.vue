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
import { usePublicEventPresets } from "../EntityPresetEditor/usePublicEventPresets";
import { getPublicEventClipLabel } from "./utils/publicEventParameters";
import { getCameraClipPreview } from "./config/cameraClip";
import { getGroupOutletWarnings } from "./utils/groupOutlets";
import {
  getFlowClipDuration,
  getGroupTimelineEnd,
  getGroupTimelineDisplayDuration,
  isInstantPerformanceClip,
  getPerformanceClipDuration,
  MIN_CLIP_DURATION,
  type FlowClip,
} from "./utils/groupTimeline";

type SelectedClip =
  | { kind: "focusPush"; clip: FocusPushClip }
  | { kind: "dialogue"; clip: DialogueClip }
  | { kind: "select"; clip: SelectClip }
  | { kind: "performance"; line: PerformanceLine; clip: PerformanceClip };

const props = defineProps<{ node: DialogueNode }>();
const emit = defineEmits<{ close: [] }>();
const { availablePresets: publicEventPresets } = usePublicEventPresets();

const viewportWidth = ref(918);
const timelineScrollRef = ref<HTMLElement>();
let timelineResizeObserver: ResizeObserver | undefined;
const labelWidth = 118;
const selectedId = ref(props.node.dialogue?.id ?? "");
const newLineType = ref<PerformanceLineType>("PublicEvent");
const sectionRef = ref<HTMLElement>();
const editorOpen = ref(false);
const hoveredClip = ref<SelectedClip>();
const previewPosition = ref({ left: 0, top: 0 });
const editorPosition = ref({ left: 0 });
const lineDefinitions = getLineDefinitions().filter(
  (definition) => definition.removable && definition.type !== "Audio",
).sort((a, b) => {
  const priority = (type: PerformanceLineType) => type === "PublicEvent" ? 0 : type === "Custom" ? 1 : 2;
  return priority(a.type) - priority(b.type);
});

const canAddLine = computed(
  () => props.node.lines.length + 3 < props.node.timeline.maxLines,
);
const outletWarnings = computed(() =>
  getGroupOutletWarnings(props.node),
);

const selectedClip = computed<SelectedClip | undefined>(() => {
  if (props.node.dialogue && selectedId.value === props.node.dialogue.id) {
    return { kind: "dialogue", clip: props.node.dialogue };
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

const contentDuration = computed(() => getGroupTimelineEnd(props.node));
const timelineDuration = computed(() =>
  getGroupTimelineDisplayDuration(props.node),
);
const pixelsPerSecond = computed(() => Math.max(1, viewportWidth.value - labelWidth - 24) / timelineDuration.value);
const canvasDuration = computed(() => Math.max(timelineDuration.value, contentDuration.value));
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
  () => props.node.id,
  () => {
    selectedId.value = props.node.dialogue?.id ?? "";
    editorOpen.value = false;
    hoveredClip.value = undefined;
  },
);

function addLine() {
  if (!canAddLine.value || !lineDefinitions.some(definition => definition.type === newLineType.value)) return;
  props.node.lines.push(createPerformanceLine(newLineType.value));
}

function addDialogueClip() {
  if (props.node.dialogue) return;
  const clip = createDialogueClip();
  props.node.dialogue = clip;
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
  const clip = createFocusPushClip(getGroupTimelineEnd(props.node));
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

function updateMaxLines(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  props.node.timeline.maxLines = Math.min(
    64,
    Math.max(props.node.lines.length + 3, Math.floor(value)),
  );
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
    props.node.dialogue = undefined;
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

function showPreview(event: PointerEvent, selected: SelectedClip) {
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

function openEditor(event: MouseEvent, selected: SelectedClip) {
  if (suppressClick) return;
  const viewportGap = 12;
  const editorWidth = Math.min(selected.kind === 'performance' && selected.clip.type === 'Camera' ? 420 : 335, window.innerWidth - viewportGap * 2);
  const maximumLeft = Math.max(
    viewportGap,
    window.innerWidth - editorWidth - viewportGap,
  );
  selectedId.value = selected.clip.id;
  editorPosition.value = {
    left: Math.min(
      Math.max(viewportGap, event.clientX + 14),
      maximumLeft,
    ),
  };
  hoveredClip.value = undefined;
  editorOpen.value = true;
}

function closeEditorFromOutside(event: PointerEvent) {
  const target = event.target as HTMLElement | null;
  if (
    !editorOpen.value ||
    target?.closest("[data-clip-editor]") ||
    target?.closest("[data-timeline-clip]")
  ) {
    return;
  }
  editorOpen.value = false;
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

function updateContinueDelay(clip: FlowClip, event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(value)) return;
  clip.continueDelayTime = Math.min(
    getFlowClipDuration(props.node, clip),
    Math.max(0, value),
  );
}

type TimelineClip = DialogueClip | SelectClip | PerformanceClip | FocusPushClip;

let dragging:
  | {
      clip: TimelineClip;
      pointerStart: number;
      clipStart: number;
      moved: boolean;
    }
  | undefined;

function startDrag(
  event: PointerEvent,
  clip: TimelineClip,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  selectedId.value = clip.id;
  dragging = {
    clip,
    pointerStart: event.clientX,
    clipStart: clip.startTime,
    moved: false,
  };
  window.addEventListener("pointermove", dragClip);
  window.addEventListener("pointerup", stopDrag, { once: true });
}

function dragClip(event: PointerEvent) {
  if (!dragging) return;
  const delta = (event.clientX - dragging.pointerStart) / pixelsPerSecond.value;
  if (Math.abs(event.clientX - dragging.pointerStart) > 3) {
    dragging.moved = true;
  }
  dragging.clip.startTime = Math.max(
    0,
    Math.round((dragging.clipStart + delta) * 10) / 10,
  );
}

function stopDrag() {
  suppressClick = dragging?.moved ?? false;
  dragging = undefined;
  window.removeEventListener("pointermove", dragClip);
  window.setTimeout(() => {
    suppressClick = false;
  });
}

let resizing:
  | {
      clip: TimelineClip;
      boundary: "start" | "end";
      pointerStart: number;
      clipStart: number;
      clipDuration: number;
      moved: boolean;
    }
  | undefined;

function startResize(
  event: PointerEvent,
  clip: TimelineClip,
  boundary: "start" | "end",
) {
  if (event.button !== 0 || ("type" in clip && isInstantPerformanceClip(clip))) return;
  event.preventDefault();
  event.stopPropagation();
  selectedId.value = clip.id;
  resizing = {
    clip,
    boundary,
    pointerStart: event.clientX,
    clipStart: clip.startTime,
    clipDuration: clipDisplayDuration(clip),
    moved: false,
  };
  window.addEventListener("pointermove", resizeClip);
  window.addEventListener("pointerup", stopResize, { once: true });
}

function resizeClip(event: PointerEvent) {
  if (!resizing) return;
  const pixelDelta = event.clientX - resizing.pointerStart;
  const timeDelta = pixelDelta / pixelsPerSecond.value;
  if (Math.abs(pixelDelta) > 3) resizing.moved = true;

  if (resizing.boundary === "start") {
    const originalEnd = resizing.clipStart + resizing.clipDuration;
    const nextStart = Math.min(
      originalEnd - 0.1,
      Math.max(0, Math.round((resizing.clipStart + timeDelta) * 10) / 10),
    );
    resizing.clip.startTime = nextStart;
    if ("duration" in resizing.clip) {
      resizing.clip.duration = Math.max(
        MIN_CLIP_DURATION,
        Math.round((originalEnd - nextStart) * 10) / 10,
      );
    }
    return;
  }

  if ("duration" in resizing.clip) {
    resizing.clip.duration = Math.max(
      MIN_CLIP_DURATION,
      Math.round((resizing.clipDuration + timeDelta) * 10) / 10,
    );
  }
}

function stopResize() {
  suppressClick = resizing?.moved ?? false;
  resizing = undefined;
  window.removeEventListener("pointermove", resizeClip);
  window.setTimeout(() => {
    suppressClick = false;
  });
}

function clipDisplayDuration(clip: TimelineClip) {
  return "duration" in clip
    ? getPerformanceClipDuration(clip)
    : "continueDelayTime" in clip ? getFlowClipDuration(props.node, clip) : 0;
}

let continueDelayDragging:
  | {
      clip: FlowClip;
      pointerStart: number;
      delayStart: number;
      maximumDelay: number;
      moved: boolean;
    }
  | undefined;

function startContinueDelayDrag(event: PointerEvent, clip: FlowClip) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectedId.value = clip.id;
  continueDelayDragging = {
    clip,
    pointerStart: event.clientX,
    delayStart: clip.continueDelayTime,
    maximumDelay: getFlowClipDuration(props.node, clip),
    moved: false,
  };
  window.addEventListener("pointermove", dragContinueDelay);
  window.addEventListener("pointerup", stopContinueDelayDrag, { once: true });
}

function dragContinueDelay(event: PointerEvent) {
  if (!continueDelayDragging) return;
  const pixelDelta = event.clientX - continueDelayDragging.pointerStart;
  if (Math.abs(pixelDelta) > 3) continueDelayDragging.moved = true;
  continueDelayDragging.clip.continueDelayTime = Math.min(
    continueDelayDragging.maximumDelay,
    Math.max(
      0,
      Math.round(
        (continueDelayDragging.delayStart + pixelDelta / pixelsPerSecond.value) * 10,
      ) / 10,
    ),
  );
}

function stopContinueDelayDrag() {
  suppressClick = continueDelayDragging?.moved ?? false;
  continueDelayDragging = undefined;
  window.removeEventListener("pointermove", dragContinueDelay);
  window.setTimeout(() => {
    suppressClick = false;
  });
}

let suppressClick = false;

onMounted(() => {
  window.addEventListener("pointerdown", closeEditorFromOutside);
  timelineResizeObserver = new ResizeObserver(() => {
    if (timelineScrollRef.value) viewportWidth.value = timelineScrollRef.value.clientWidth;
  });
  if (timelineScrollRef.value) {
    viewportWidth.value = timelineScrollRef.value.clientWidth;
    timelineResizeObserver.observe(timelineScrollRef.value);
  }
});
onBeforeUnmount(() => {
  timelineResizeObserver?.disconnect();
  stopDrag();
  stopResize();
  stopContinueDelayDrag();
  window.removeEventListener("pointerdown", closeEditorFromOutside);
});
</script>

<template>
  <section ref="sectionRef" class="group-timeline-v3">
    <header class="timeline-toolbar">
      <span class="timeline-eyebrow">GROUP TIMELINE</span>

      <div class="timeline-actions">
        <label class="max-lines-control display-duration-control" title="设置可见宽度内的时长；清空后自动计算。超出部分可横向滚动查看。">
          显示时长（秒）
          <input type="number" min="0.1" step="0.1" aria-label="Timeline 显示时长（秒）" :placeholder="`自动（${timelineDuration}）`" :value="node.timeline.displayDuration ?? ''" @change="updateDisplayDuration" />
        </label>
        <label class="max-lines-control">
          Max Lines
          <input
            type="number"
            min="3"
            max="64"
            :value="node.timeline.maxLines"
            @input="updateMaxLines"
          />
        </label>
        <select v-model="newLineType" aria-label="新增 Line 类型">
          <option
            v-for="definition in lineDefinitions"
            :key="definition.type"
            :value="definition.type"
          >
            {{ definition.label }}
          </option>
        </select>
        <button
          type="button"
          class="primary-button"
          :disabled="!canAddLine"
          @click="addLine"
        >
          ＋ Line {{ node.lines.length + 3 }}/{{ node.timeline.maxLines }}
        </button>
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

          <div class="timeline-row dialogue-row">
            <div class="line-label dialogue-label">
              <strong>对话</strong>
              <small>可选 · 固定单 Clip</small>
            </div>
            <button
              v-if="node.dialogue"
              type="button"
              data-timeline-clip
              class="timeline-clip dialogue-clip resizable-clip"
              :class="{ selected: selectedId === node.dialogue.id }"
              :style="{
                left: `${labelWidth + node.dialogue.startTime * pixelsPerSecond}px`,
              }"
              @pointerdown="startDrag($event, node.dialogue)"
              @pointerenter="
                showPreview($event, { kind: 'dialogue', clip: node.dialogue })
              "
              @pointermove="movePreview"
              @pointerleave="hidePreview"
              @click.stop="
                openEditor($event, { kind: 'dialogue', clip: node.dialogue })
              "
            >
              <i
                class="clip-resize-handle resize-start"
                title="拖动设置开始时间"
                @pointerdown.stop="startResize($event, node.dialogue, 'start')"
              />
              <span>{{ node.dialogue.content || "未填写台词" }}</span>
              <small>
                {{ node.dialogue.startTime.toFixed(1) }}s →
                时间轴末尾
              </small>
              <i
                class="continue-delay-handle"
                :class="{ disabled: node.dialogue.advanceMode === 'None' }"
                :style="{
                  left: `${node.dialogue.continueDelayTime * pixelsPerSecond}px`,
                }"
                title="拖动设置 ContinueDelayTime"
                @pointerdown.stop="startContinueDelayDrag($event, node.dialogue)"
              >
                <em>{{ node.dialogue.continueDelayTime.toFixed(1) }}s</em>
              </i>
            </button>
            <button
              v-else
              type="button"
              class="empty-line"
              :style="{ left: `${labelWidth + 16}px` }"
              @click="addDialogueClip"
            >
              ＋ 添加 对话片段
            </button>
          </div>

          <div class="timeline-row select-row">
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

          <div class="timeline-row focus-push-row">
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
        </div>
      </div>

    </div>

    <div
      v-if="hoveredClip && !editorOpen"
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

    <Teleport to="body">
      <aside
        v-if="editorOpen && selectedClip"
        data-clip-editor
        class="clip-editor-popover dsfg-typography"
        :class="{ 'camera-popover': selectedClip.kind === 'performance' && selectedClip.clip.type === 'Camera' }"
        :style="{
          left: `${editorPosition.left}px`,
        }"
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

        <div class="popover-content">
          <DialogueClipEditor
            v-if="selectedClip.kind === 'dialogue'"
            :clip="selectedClip.clip"
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

.max-lines-control {
  display: flex;
  gap: 5px;
  align-items: center;
  color: #64748b;
  font-size: 10px;
}

.max-lines-control input {
  box-sizing: border-box;
  width: 48px;
  height: 30px;
  padding: 0 5px;
  color: #334155;
  background: #fff;
  border: 1px solid #cbd7e6;
  border-radius: 5px;
}

.display-duration-control {
  flex-shrink: 0;
  white-space: nowrap;
}

.display-duration-control input {
  width: 140px;
  flex-shrink: 0;
  padding: 0 10px;
  font-size: 12px;
}

.timeline-actions button,
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

.dialogue-clip,
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
  background: linear-gradient(90deg, #3d7367, #529585);
  border: 1px solid #83c9b7;
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
