<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from "vue";
import {
  Handle,
  Position,
  useVueFlow,
  type Edge,
} from "@vue-flow/core";
import type { DialogueNode } from "./types/DialogueNode";
import { getDialogueStyle } from "./config/dialogueStyleRegistry";
import {
  edgeMatchesOutlet,
  getGroupOutletWarnings,
  resolveGroupOutlets,
} from "./utils/groupOutlets";
import {
  getFlowClipDuration,
  getGroupTimelineEnd,
} from "./utils/groupTimeline";

const props = withDefaults(defineProps<{
  id: string;
  node: DialogueNode;
  edges?: Edge[];
  selected?: boolean;
}>(), {
  edges: () => [],
  selected: false,
});

const { updateNodeInternals } = useVueFlow();

const dialogueStyleLabel = computed(
  () => {
    const dialogue = props.node.dialogue;
    if (!dialogue) return "无 Dialogue";
    return getDialogueStyle(dialogue.style)?.label ?? dialogue.style;
  },
);

function toSeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
}

const performanceClips = computed(() =>
  props.node.lines.flatMap((line) => line.clips),
);
const autoDuration = computed(() => getGroupTimelineEnd(props.node));

const duration = computed(() =>
  props.node.durationMode === "Fixed"
    ? Math.max(toSeconds(props.node.duration), autoDuration.value)
    : autoDuration.value,
);

const durationLabel = computed(() => `${duration.value.toFixed(1)}s`);
const outletState = computed(() => resolveGroupOutlets(props.node));
const outlets = computed(() => outletState.value.outlets);
const outletWarnings = computed(() =>
  getGroupOutletWarnings(props.node),
);
const connectedOutletCount = computed(
  () =>
    outlets.value.filter((outlet) =>
      props.edges.some(
        (edge) =>
          edge.source === props.id && edgeMatchesOutlet(edge, outlet.id),
      ),
    ).length,
);
const outletSignature = computed(() =>
  outlets.value.map((outlet) => outlet.id).join("|"),
);

async function refreshHandles() {
  await nextTick();
  updateNodeInternals([props.id]);
}

watch(outletSignature, refreshHandles, { flush: "post" });
onMounted(refreshHandles);

const previewSegments = computed(() => {
  const visibleClips = [
    ...(props.node.select ? [props.node.select] : []),
    ...performanceClips.value,
  ].slice(0, 6);
  const total = Math.max(duration.value, 0.25);

  return visibleClips.map((clip, index) => ({
    id: `${props.id}-${index}`,
    left: `${(toSeconds(clip.startTime) / total) * 100}%`,
    width: `${
      (Math.max(
        "continueDelayTime" in clip
          ? getFlowClipDuration(props.node, clip)
          : toSeconds(clip.duration),
        0.25,
      ) /
        total) *
      100
    }%`,
  }));
});
</script>

<template>
  <article class="group-node" :class="{ selected }">
    <header class="group-header">
      <span class="group-kind">GROUP</span>
      <div class="group-header-meta">
        <span
          v-if="outletWarnings.length"
          class="group-warning"
          :title="outletWarnings.join('\n')"
          >⚠ {{ outletWarnings.length }}</span
        >
        <span class="group-duration">{{ durationLabel }}</span>
      </div>
    </header>

    <div class="group-flow-ports">
      <div
        v-for="(outlet, index) in outlets"
        :key="outlet.id"
        class="group-port-row"
        :class="`outlet-${outlet.kind.toLowerCase()}`"
      >
        <span class="group-input-label">
          <Handle
            v-if="index === 0"
            id="input"
            class="group-input-handle"
            type="target"
            :position="Position.Left"
            title="Group 入口"
            aria-label="Group 入口"
          />
          <template v-if="index === 0">入口</template>
        </span>
        <span class="group-output-label" :title="outlet.label">
          {{ outlet.label }}
        </span>
        <Handle
          :id="outlet.id"
          class="group-output-handle"
          type="source"
          :position="Position.Right"
          :title="outlet.label"
          :aria-label="outlet.label"
        />
      </div>

      <div v-if="!outlets.length" class="group-port-row no-flow-output">
        <span class="group-input-label">
          <Handle
            id="input"
            class="group-input-handle"
            type="target"
            :position="Position.Left"
            title="Group 入口"
            aria-label="Group 入口"
          />
          入口
        </span>
        <span>⚠ 无流程出口</span>
      </div>
    </div>

    <section class="group-content">
      <div class="group-title" :title="node.name">{{ node.name }}</div>
      <div class="group-type">{{ dialogueStyleLabel }}</div>
      <div
        class="group-dialogue"
        :class="{ empty: !node.dialogue }"
        :title="node.dialogue?.content"
      >
        <template v-if="node.dialogue">
          {{ node.dialogue.speaker ? `${node.dialogue.speaker}：` : "" }}{{
            node.dialogue.content
          }}
        </template>
        <template v-else>暂无 Dialogue Clip</template>
      </div>

      <div class="group-stats">
        <span>{{ performanceClips.length }} 演出</span>
        <span>{{ node.select?.options.length ?? 0 }} 选项</span>
        <span>{{ node.lines.length + 2 }} Lines</span>
        <span v-if="outlets.length">
          {{ connectedOutletCount }}/{{ outlets.length }} 已连接
        </span>
      </div>

      <div class="timeline-preview" aria-hidden="true">
        <template v-if="previewSegments.length">
          <span
            v-for="(segment, index) in previewSegments"
            :key="segment.id"
            class="timeline-segment"
            :class="`segment-${(index % 3) + 1}`"
            :style="{ left: segment.left, width: segment.width }"
          />
        </template>
        <span v-else class="timeline-empty">暂无演出</span>
      </div>
    </section>
  </article>
</template>

<style scoped>
.group-node {
  --dsfg-handle-fill: #88b5ff;
  --dsfg-handle-ring: #202630;
  width: 250px;
  overflow: visible;
  color: #e9eef7;
  background: #202630;
  border: 1px solid #465264;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.group-header {
  border-radius: 9px 9px 0 0;
}

.group-header-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-warning {
  color: #ffe2a4;
  font-size: 10px;
  font-weight: 700;
}

.group-node:hover {
  border-color: #6e83a0;
}

.group-node.selected {
  border-color: #71a5ff;
  box-shadow:
    0 0 0 2px rgba(113, 165, 255, 0.24),
    0 10px 28px rgba(0, 0, 0, 0.35);
  transform: translateY(-1px);
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 32px;
  padding: 0 11px;
  background: linear-gradient(90deg, #315d9f, #477bc4);
}

.group-kind {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.group-duration {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.92;
}

.group-content {
  padding: 11px;
  border-radius: 0 0 9px 9px;
}

.group-title {
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-type {
  margin-top: 3px;
  color: #aeb9c8;
  font-size: 11px;
}

.group-dialogue {
  margin-top: 8px;
  overflow: hidden;
  color: #e5edf8;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-stats {
  display: flex;
  gap: 10px;
  margin-top: 10px;
  color: #cbd4e1;
  font-size: 11px;
}

.timeline-preview {
  position: relative;
  height: 18px;
  margin-top: 9px;
  overflow: hidden;
  background: #151a21;
  border-radius: 4px;
}

.timeline-segment {
  position: absolute;
  inset-block: 0;
  min-width: 5px;
  border-radius: 2px;
}

.segment-1 {
  background: #5791e6;
}

.segment-2 {
  background: #8b70d9;
}

.segment-3 {
  background: #4ca982;
}

.timeline-empty {
  margin: auto;
  color: #707c8c;
  font-size: 10px;
}

.group-flow-ports {
  overflow: visible;
  background: #252d39;
  border-bottom: 1px solid #3a4657;
}

.group-port-row {
  position: relative;
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  align-items: center;
  min-height: 28px;
  padding: 0 12px;
  color: #b9c7da;
  border-bottom: 1px solid #333e4d;
  font-size: 10px;
}

.group-port-row:last-child {
  border-bottom: 0;
}

.group-input-label {
  color: #91a4bc;
}

.group-output-label {
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-port-row.outlet-dialogue .group-output-label {
  color: #a8cbff;
}

.group-port-row.outlet-select .group-output-label {
  color: #d5b8f4;
}

.group-port-row.outlet-select .group-output-handle {
  --dsfg-handle-fill: #c79af0;
}

.group-input-handle,
.group-output-handle {
  z-index: 4;
}

.no-flow-output {
  color: #f1bd73;
  background: rgba(126, 75, 35, 0.24);
}

.no-flow-output > span:last-child {
  text-align: right;
}

</style>
