<script setup lang="ts">
import { computed, ref } from "vue";
import type { TextPreviewLayout } from "../utils/dialogueTextPreviewLayout";
import type { TextPreviewBlock } from "../utils/dialogueTextPreview";
import { clipMinimapViewport, fitDialogueMinimap, minimapPointToCanvas, type MinimapRect } from "../utils/dialogueMinimap";

const props = defineProps<{ layout: TextPreviewLayout; blocks: TextPreviewBlock[]; viewport: MinimapRect; activeBlockId: string; zoom: number }>();
const emit = defineEmits<{ navigate: [position: { x: number; y: number }] }>();
const expanded = ref(true);
const dragging = ref(false);
const mapWidth = 184, mapHeight = 124;
const projection = computed(() => fitDialogueMinimap(props.layout.width, props.layout.height, mapWidth, mapHeight));
const visible = computed(() => clipMinimapViewport(props.viewport, props.layout.width, props.layout.height));
const frame = computed(() => ({
  x: projection.value.x + visible.value.x * projection.value.scale,
  y: projection.value.y + visible.value.y * projection.value.scale,
  width: visible.value.width * projection.value.scale,
  height: visible.value.height * projection.value.scale,
}));
const kinds = computed(() => new Map(props.blocks.map(block => [block.id, block.kind])));
let drag: { pointerId: number; offsetX: number; offsetY: number } | undefined;

function point(event: PointerEvent) {
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
  return minimapPointToCanvas((event.clientX - rect.left) * mapWidth / rect.width,
    (event.clientY - rect.top) * mapHeight / rect.height, projection.value);
}
function start(event: PointerEvent) {
  if (event.button !== 0 || drag) return;
  const position = point(event);
  const view = props.viewport;
  const inside = position.x >= visible.value.x && position.x <= visible.value.x + visible.value.width &&
    position.y >= visible.value.y && position.y <= visible.value.y + visible.value.height;
  drag = { pointerId: event.pointerId, offsetX: inside ? position.x - view.x : view.width / 2,
    offsetY: inside ? position.y - view.y : view.height / 2 };
  dragging.value = true;
  (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  if (!inside) move(event);
}
function move(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const position = point(event);
  emit("navigate", { x: position.x - drag.offsetX, y: position.y - drag.offsetY });
}
function end(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag = undefined;
  dragging.value = false;
  const svg = event.currentTarget as SVGSVGElement;
  if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
}
function keydown(event: KeyboardEvent) {
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  emit("navigate", { x: props.viewport.x + direction[0] * props.viewport.width * .2,
    y: props.viewport.y + direction[1] * props.viewport.height * .2 });
}
</script>

<template>
  <aside class="dialogue-minimap" aria-label="对话流总览">
    <button type="button" class="minimap-heading" :aria-expanded="expanded" @click="expanded = !expanded">
      <span>对话总览</span><small>{{ Math.round(zoom * 100) }}%</small><span aria-hidden="true">{{ expanded ? '−' : '＋' }}</span>
    </button>
    <template v-if="expanded">
      <svg class="minimap-canvas" :class="{ dragging }" :viewBox="`0 0 ${mapWidth} ${mapHeight}`" tabindex="0"
        role="group" aria-label="对话流缩略图，点击定位或拖动蓝框，方向键移动视野"
        @pointerdown.stop.prevent="start" @pointermove.stop="move" @pointerup.stop="end"
        @pointercancel="end" @lostpointercapture="end" @keydown.stop="keydown">
        <g :transform="`translate(${projection.x} ${projection.y}) scale(${projection.scale})`" aria-hidden="true">
          <path v-for="edge in layout.edges" :key="edge.id" :d="edge.path" class="minimap-edge" :class="{ 'return-edge': edge.isReturn }" />
          <rect v-for="block in layout.blocks" :key="block.id" :x="block.x" :y="block.y" :width="block.width" :height="block.height" rx="8"
            class="minimap-block" :class="[`kind-${kinds.get(block.id)}`, { active: block.id === activeBlockId }]" />
        </g>
        <rect :x="frame.x" :y="frame.y" :width="frame.width" :height="frame.height" rx="2" class="minimap-viewport" aria-hidden="true" />
      </svg>
      <p>拖动蓝框或点击定位</p>
    </template>
  </aside>
</template>

<style scoped>
.dialogue-minimap { position: absolute; z-index: 5; top: 12px; left: 12px; width: 202px; max-width: calc(100% - 24px); box-sizing: border-box; border: 1px solid #d6e1ed; border-radius: 10px; background: #ffffffed; box-shadow: 0 4px 16px #30456318; overflow: hidden; }
.minimap-heading { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; color: #526985; background: transparent; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
.minimap-heading small { margin-left: auto; color: #8a99ad; font-size: 10px; font-weight: 400; }
.minimap-canvas { display: block; width: calc(100% - 16px); aspect-ratio: 184 / 124; margin: 0 8px; border-radius: 5px; background: #f4f7fb; touch-action: none; cursor: crosshair; }
.minimap-canvas.dragging { cursor: grabbing; }
.minimap-edge { fill: none; stroke: #b0bdd0; stroke-width: 1; vector-effect: non-scaling-stroke; }
.minimap-edge.return-edge { stroke: #b99bcf; stroke-dasharray: 3 2; }
.minimap-block { fill: #c8d8ed; stroke: #99b4d5; stroke-width: .6; vector-effect: non-scaling-stroke; }
.minimap-block.kind-select { fill: #f1dfbd; stroke: #cfaf74; }
.minimap-block.kind-condition { fill: #dfd1ee; stroke: #b299cd; }
.minimap-block.kind-entry, .minimap-block.kind-output { fill: #c5e2d6; stroke: #89b7a3; }
.minimap-block.kind-action { fill: #d7dce3; stroke: #a6b0bd; }
.minimap-block.active { stroke: #3a7bcd; stroke-width: 1.3; }
.minimap-viewport { fill: #458af51c; stroke: #3d82dc; stroke-width: 1.5; cursor: grab; }
.dragging .minimap-viewport { cursor: grabbing; }
.minimap-heading:focus-visible, .minimap-canvas:focus-visible { outline: 2px solid #4384d4; outline-offset: -2px; }
p { margin: 6px 10px 8px; color: #94a1b2; font-size: 10px; }
</style>
