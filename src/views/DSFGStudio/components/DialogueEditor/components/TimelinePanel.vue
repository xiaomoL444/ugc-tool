<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{ modelValue: number }>();
const emit = defineEmits<{ "update:modelValue": [height: number] }>();
const panel = ref<HTMLElement>();
const availableHeight = ref(800);
const resizing = ref(false);
const minimumHeight = 160;
const maximumHeight = computed(() => Math.max(minimumHeight, availableHeight.value - 180));
const height = computed(() => clampHeight(props.modelValue));
const contentId = `dialogue-timeline-${crypto.randomUUID()}`;
let observer: ResizeObserver | undefined;
let stopResize: (() => void) | undefined;

function clampHeight(value: number) { return Math.min(maximumHeight.value, Math.max(minimumHeight, Math.round(value))); }
function nudge(delta: number) { emit("update:modelValue", clampHeight(height.value + delta)); }
function reset() { emit("update:modelValue", clampHeight(368)); }
function startResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  stopResize?.();
  const startY = event.clientY, startHeight = height.value, pointerId = event.pointerId;
  const cursor = document.body.style.cursor, userSelect = document.body.style.userSelect;
  resizing.value = true;
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    next.preventDefault();
    emit("update:modelValue", clampHeight(startHeight + startY - next.clientY));
  };
  const end = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", cleanup);
    document.body.style.cursor = cursor;
    document.body.style.userSelect = userSelect;
    resizing.value = false;
    if (stopResize === cleanup) stopResize = undefined;
  };
  stopResize = cleanup;
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", cleanup);
}
onMounted(() => {
  const host = panel.value?.parentElement;
  if (!host) return;
  const measure = () => { if (host.clientHeight) availableHeight.value = host.clientHeight; };
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(host);
});
onBeforeUnmount(() => { stopResize?.(); observer?.disconnect(); });
</script>

<template>
  <div ref="panel" class="timeline-panel" :class="{ resizing }" :style="{ flexBasis: `${height}px` }">
    <div class="timeline-resize-handle" role="separator" aria-label="调整 Timeline 高度" aria-orientation="horizontal"
      :aria-controls="contentId" :aria-valuemin="minimumHeight" :aria-valuemax="maximumHeight" :aria-valuenow="height"
      tabindex="0" title="上下拖动调整 Timeline 高度 · 双击恢复默认高度"
      @pointerdown.stop="startResize" @dblclick.stop="reset" @keydown.up.prevent="nudge(16)" @keydown.down.prevent="nudge(-16)">
      <span aria-hidden="true"></span>
    </div>
    <div :id="contentId" class="timeline-panel-content"><slot /></div>
  </div>
</template>

<style scoped>
.timeline-panel { display: flex; flex: 0 0 368px; flex-direction: column; min-height: 0; min-width: 0; }
.timeline-panel-content { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
.timeline-panel-content :deep(.group-timeline-v3) { flex: 1; }
.timeline-resize-handle { position: relative; z-index: 3; display: flex; flex: 0 0 8px; align-items: center; justify-content: center; cursor: row-resize; touch-action: none; user-select: none; background: #eef3f9; outline: none; }
.timeline-resize-handle::before { content: ''; position: absolute; inset: 3px 0 auto; height: 2px; background: #b9c9de; transition: background .15s; }
.timeline-resize-handle span { position: relative; width: 64px; height: 4px; border: 1px solid #91acd0; border-radius: 4px; background: #dce8f7; transition: background .15s, border-color .15s; }
.timeline-resize-handle:hover::before, .timeline-resize-handle:focus-visible::before, .resizing .timeline-resize-handle::before { background: #528fe3; }
.timeline-resize-handle:hover span, .timeline-resize-handle:focus-visible span, .resizing .timeline-resize-handle span { background: #8db8ee; border-color: #427fcf; }
</style>
