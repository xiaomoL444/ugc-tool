<script setup lang="ts">
/*
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type {
  DialogueNode,
  DialogueValue,
} from "./types/DialogueNode";
import { createDialogueClip } from "./utils/dialogueProject";

const props = defineProps<{ node: DialogueNode }>();
const emit = defineEmits<{ close: [] }>();

const pixelsPerSecond = 80;
const selectedClipId = ref("");

const clips = computed(() =>
  props.node.blocks.flatMap((block) => block.value ?? []),
);
const selectedClip = computed(
  () => clips.value.find((clip) => clip.id === selectedClipId.value),
);
const contentDuration = computed(() =>
  clips.value.reduce(
    (maximum, clip) =>
      Math.max(maximum, clip.startTime + Math.max(clip.duration, 0.1)),
    0,
  ),
);
const timelineDuration = computed(() =>
  Math.max(10, Math.ceil(contentDuration.value + 2)),
);
const ticks = computed(() =>
  Array.from({ length: timelineDuration.value + 1 }, (_, index) => index),
);

watch(
  () => props.node.id,
  () => {
    selectedClipId.value = "";
  },
);

function ensureDefaultBlock() {
  if (!props.node.blocks.length) {
    props.node.blocks.push({
      delay: 0,
      title: "默认轨道",
      subtitle: "",
      value: [],
    });
  }

  return props.node.blocks[0];
}

function addClip() {
  const clip = createDialogueClip(contentDuration.value);
  ensureDefaultBlock().value.push(clip);
  selectedClipId.value = clip.id;
}

function deleteSelectedClip() {
  if (!selectedClipId.value) return;

  for (const block of props.node.blocks) {
    const index = block.value.findIndex(
      (clip) => clip.id === selectedClipId.value,
    );
    if (index >= 0) {
      block.value.splice(index, 1);
      selectedClipId.value = "";
      return;
    }
  }
}

function updateNumber(
  clip: DialogueValue,
  field: "startTime" | "duration",
  event: Event,
) {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  clip[field] = Math.max(field === "duration" ? 0.1 : 0, value);
}

let dragging:
  | {
      clip: DialogueValue;
      pointerStart: number;
      clipStart: number;
    }
  | undefined;

function startDrag(event: PointerEvent, clip: DialogueValue) {
  if (event.button !== 0) return;
  event.preventDefault();
  selectedClipId.value = clip.id;
  dragging = {
    clip,
    pointerStart: event.clientX,
    clipStart: clip.startTime,
  };
  window.addEventListener("pointermove", dragClip);
  window.addEventListener("pointerup", stopDrag, { once: true });
}

function dragClip(event: PointerEvent) {
  if (!dragging) return;
  const delta = (event.clientX - dragging.pointerStart) / pixelsPerSecond;
  dragging.clip.startTime = Math.max(
    0,
    Math.round((dragging.clipStart + delta) * 10) / 10,
  );
}

function stopDrag() {
  dragging = undefined;
  window.removeEventListener("pointermove", dragClip);
}

onBeforeUnmount(stopDrag);
*/
import type { DialogueNode } from "./types/DialogueNode";
import GroupTimelineV3 from "./GroupTimelineV3.vue";

const wrapperProps = defineProps<{ node: DialogueNode }>();
const wrapperEmit = defineEmits<{ close: [] }>();
</script>

<template>
  <!-- Previous single-line prototype retained temporarily for migration reference.
  <section class="group-timeline">
    <header class="timeline-toolbar">
      <div class="timeline-heading">
        <span class="timeline-eyebrow">GROUP TIMELINE</span>
        <input v-model="node.name" class="group-name-input" aria-label="Group 名称" />
      </div>

      <div class="timeline-actions">
        <button type="button" class="primary-button" @click="addClip">
          ＋ 添加 Clip
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

    <div class="timeline-body">
      <div class="timeline-scroll">
        <div
          class="timeline-canvas"
          :style="{ width: `${timelineDuration * pixelsPerSecond}px` }"
        >
          <div class="timeline-ruler">
            <span
              v-for="tick in ticks"
              :key="tick"
              class="timeline-tick"
              :style="{ left: `${tick * pixelsPerSecond}px` }"
            >
              {{ tick }}s
            </span>
          </div>

          <div class="clip-track">
            <div class="track-label">Dialogue</div>
            <button
              v-for="(clip, index) in clips"
              :key="clip.id"
              type="button"
              class="timeline-clip"
              :class="{ selected: selectedClipId === clip.id }"
              :style="{
                left: `${clip.startTime * pixelsPerSecond}px`,
                width: `${Math.max(clip.duration, 0.1) * pixelsPerSecond}px`,
              }"
              @pointerdown="startDrag($event, clip)"
              @click="selectedClipId = clip.id"
            >
              <span>Clip {{ index + 1 }}</span>
              <small>{{ clip.startTime.toFixed(1) }}s</small>
            </button>

            <button
              v-if="!clips.length"
              type="button"
              class="empty-track"
              @click="addClip"
            >
              点击添加第一个 Clip
            </button>
          </div>
        </div>
      </div>

      <aside class="clip-inspector">
        <template v-if="selectedClip">
          <label>
            台词内容
            <textarea v-model="selectedClip.content" rows="3" />
          </label>
          <div class="number-fields">
            <label>
              开始时间
              <input
                type="number"
                min="0"
                step="0.1"
                :value="selectedClip.startTime"
                @input="updateNumber(selectedClip, 'startTime', $event)"
              />
            </label>
            <label>
              持续时间
              <input
                type="number"
                min="0.1"
                step="0.1"
                :value="selectedClip.duration"
                @input="updateNumber(selectedClip, 'duration', $event)"
              />
            </label>
          </div>
        </template>
        <div v-else class="inspector-empty">选择一个 Clip 编辑属性</div>
      </aside>
    </div>
  </section> -->
  <GroupTimelineV3
    :node="wrapperProps.node"
    @close="wrapperEmit('close')"
  />
</template>

<style scoped>
.group-timeline {
  flex: 0 0 270px;
  min-height: 0;
  color: #dfe8f5;
  background: #171c24;
  border-top: 1px solid #405069;
}

.timeline-toolbar,
.timeline-body,
.timeline-heading,
.timeline-actions,
.number-fields {
  display: flex;
}

.timeline-toolbar {
  align-items: center;
  justify-content: space-between;
  min-height: 50px;
  padding: 8px 12px;
  background: #202733;
}

.timeline-heading {
  align-items: center;
  gap: 12px;
}

.timeline-eyebrow {
  color: #70a6f8;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.group-name-input,
.clip-inspector input,
.clip-inspector textarea {
  color: #edf4ff;
  background: #141922;
  border: 1px solid #3b485b;
  border-radius: 5px;
}

.group-name-input {
  width: 180px;
  padding: 6px 8px;
  font-weight: 700;
}

.timeline-actions {
  gap: 7px;
}

.timeline-actions button {
  padding: 6px 10px;
  color: #dce6f4;
  background: #303a49;
  border: 1px solid #4a586c;
  border-radius: 5px;
  cursor: pointer;
}

.timeline-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.timeline-actions .primary-button {
  color: white;
  background: #3c77cb;
  border-color: #5992e2;
}

.timeline-body {
  height: 215px;
}

.timeline-scroll {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.timeline-canvas {
  position: relative;
  min-width: 100%;
  height: 100%;
  background-image: linear-gradient(
    90deg,
    transparent calc(100% - 1px),
    rgba(124, 145, 173, 0.14) 0
  );
  background-size: 80px 100%;
}

.timeline-ruler {
  position: relative;
  height: 30px;
  color: #8290a4;
  background: #11161d;
  border-bottom: 1px solid #303b4a;
}

.timeline-tick {
  position: absolute;
  top: 8px;
  padding-left: 5px;
  font-size: 10px;
}

.clip-track {
  position: relative;
  height: 78px;
  margin-top: 20px;
  background: rgba(60, 74, 94, 0.34);
  border-block: 1px solid #334053;
}

.track-label {
  position: sticky;
  left: 8px;
  z-index: 2;
  width: max-content;
  padding: 5px 8px;
  color: #7f8da1;
  font-size: 10px;
  pointer-events: none;
}

.timeline-clip {
  position: absolute;
  top: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 24px;
  height: 36px;
  overflow: hidden;
  padding: 0 8px;
  color: #eaf3ff;
  background: linear-gradient(90deg, #3264aa, #4a83ce);
  border: 1px solid #6ea4eb;
  border-radius: 5px;
  cursor: grab;
  user-select: none;
}

.timeline-clip.selected {
  box-shadow: 0 0 0 2px #f2c66e;
}

.timeline-clip small {
  margin-left: 8px;
  opacity: 0.75;
}

.empty-track {
  position: absolute;
  top: 30px;
  left: 24px;
  color: #8292a8;
  background: transparent;
  border: 1px dashed #52627a;
  border-radius: 5px;
  padding: 8px 14px;
  cursor: pointer;
}

.clip-inspector {
  flex: 0 0 245px;
  padding: 12px;
  background: #1d242e;
  border-left: 1px solid #354154;
}

.clip-inspector label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #98a8bc;
  font-size: 11px;
}

.clip-inspector textarea,
.clip-inspector input {
  box-sizing: border-box;
  width: 100%;
  padding: 7px;
  resize: none;
}

.number-fields {
  gap: 8px;
  margin-top: 9px;
}

.number-fields label {
  flex: 1;
}

.inspector-empty {
  margin-top: 60px;
  color: #748297;
  font-size: 12px;
  text-align: center;
}
</style>
