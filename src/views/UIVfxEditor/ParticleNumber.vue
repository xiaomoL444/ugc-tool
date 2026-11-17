<template>
  <label class="number-field" :class="{ compact }">
    <span>{{ label }}</span>
    <span class="number-control" :class="{ scrubbing }">
      <input
        type="number" :aria-label="ariaLabel ?? label" :value="modelValue" :min="min" :max="max" :step="step"
        :disabled="disabled" title="左右拖动调整，点击输入"
        @change="change" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
        @pointerdown="startScrub" @pointermove="moveScrub" @pointerup="endScrub"
        @pointercancel="endScrub" @lostpointercapture="endScrub"
      />
      <small v-if="unit">{{ unit }}</small>
    </span>
  </label>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";

const props = withDefaults(defineProps<{
  label: string; modelValue: number; min?: number; max?: number; step?: number; unit?: string;
  disabled?: boolean; compact?: boolean; ariaLabel?: string;
}>(), { min: -5000, max: 5000, step: 1 });
const emit = defineEmits<{ (event: "update:modelValue", value: number): void }>();
const scrubbing = ref(false);
let drag: { id: number; x: number; value: number } | null = null;

function clamp(value: number) { return Math.max(props.min, Math.min(props.max, value)); }
function change(event: Event) {
  const input = event.target as HTMLInputElement, n = input.valueAsNumber;
  const value = Number.isFinite(n) ? clamp(props.step === 1 ? Math.round(n) : n) : props.modelValue;
  if (value !== props.modelValue) emit("update:modelValue", value);
  void nextTick(() => { input.value = String(props.modelValue); });
}
function startScrub(event: PointerEvent) {
  if (props.disabled || drag || !event.isPrimary || event.button !== 0) return;
  const input = event.currentTarget as HTMLInputElement;
  if (document.activeElement === input) return;
  drag = { id: event.pointerId, x: event.clientX, value: props.modelValue };
  input.setPointerCapture(event.pointerId);
}
function moveScrub(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return;
  if (!(event.buttons & 1)) { endScrub(event); return; }
  const dx = Math.trunc(event.clientX - drag.x);
  if (!scrubbing.value && Math.abs(dx) < 3) return;
  if (!dx) return;
  event.preventDefault();
  if (!scrubbing.value) {
    scrubbing.value = true;
    (event.currentTarget as HTMLInputElement).blur();
  }
  drag.x += dx;
  // Accumulate from the bounded value so reversing direction works immediately at either limit.
  drag.value = clamp(Number((drag.value + dx * props.step).toFixed(6)));
  if (drag.value !== props.modelValue) emit("update:modelValue", drag.value);
}
function endScrub(event: PointerEvent) {
  if (drag?.id !== event.pointerId) return;
  const input = event.currentTarget as HTMLInputElement;
  drag = null;
  scrubbing.value = false;
  if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
}
</script>

<style scoped>
.number-field { display:flex; flex-direction:column; gap:6px; min-width:0; font-size:11px; color:#9ba8bf; }
.number-control { display:flex; align-items:center; border:1px solid #354159; background:#151c29; border-radius:5px; overflow:hidden; }
.number-control:hover { border-color:#657594; }
.number-control:focus-within,.number-control.scrubbing { border-color:#96aaff; }
input { width:100%; min-width:0; height:29px; padding:0 8px; border:0; background:transparent; outline:none; color:#e3e9f5; font:inherit; font-size:12px; font-variant-numeric:tabular-nums; box-sizing:border-box; cursor:ew-resize; touch-action:pan-y; appearance:textfield; }
input::-webkit-inner-spin-button,input::-webkit-outer-spin-button { appearance:none; margin:0; }
input:focus { cursor:text; }
input:disabled { cursor:default; opacity:.4; }
small { font-size:10px; padding-right:8px; white-space:nowrap; color:#72809b; }
.compact { flex-direction:row; align-items:center; gap:4px; font-size:10px; white-space:nowrap; }
.compact .number-control { width:56px; }
.compact input { height:23px; padding:0 4px; font-size:inherit; }
</style>
