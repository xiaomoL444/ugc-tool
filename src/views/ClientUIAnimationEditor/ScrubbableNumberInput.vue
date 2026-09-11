<template>
  <input
    ref="inputElement"
    class="scrubbable-number-input"
    :class="{ 'is-editing': editing, 'is-scrubbing': scrubbing, 'is-animated': animated }"
    :data-animated="animated ? 'true' : undefined"
    :aria-description="animated ? '此属性已加入动画；修改会在当前时间记帧' : undefined"
    :value="draft"
    type="number"
    :min="min"
    :max="max"
    :step="step"
    :readonly="!editing"
    :disabled="disabled"
    :title="`${animated ? '此属性已加入动画；修改会在当前时间记帧\n' : ''}左右拖动调整数值 · Shift 精调 · Ctrl 加速 · 双击输入 · Esc 结束拖动`"
    @input="handleInput"
    @blur="finishEditing"
    @keydown.enter.prevent="finishEditing"
    @keydown.esc.prevent="cancelEditing"
    @pointerdown="startScrub"
    @dblclick.stop.prevent="beginEditing"
  />
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { advanceNumberScrub, clampNumberScrubValue } from "./numberScrubbing";

const props = withDefaults(defineProps<{
  modelValue?: number | string | null;
  min?: number;
  max?: number;
  step?: number;
  scrubSpeed?: number;
  disabled?: boolean;
  allowEmpty?: boolean;
  /** 仅影响显示；是否写入关键帧由父级编辑器决定。 */
  animated?: boolean;
}>(), {
  modelValue: "",
  step: 1,
  disabled: false,
  allowEmpty: false,
  animated: false,
});

const emit = defineEmits<{
  (event: "update:modelValue", value: number | null): void;
  (event: "change", value: number | null): void;
}>();

const inputElement = ref<HTMLInputElement | null>(null);
const editing = ref(false);
const scrubbing = ref(false);
const draft = ref(formatValue(props.modelValue));
let stopScrub: (() => void) | null = null;
let pointerLockRequest: Promise<void> | null = null;

watch(() => props.modelValue, (value) => {
  if (!editing.value && !scrubbing.value) draft.value = formatValue(value);
});

function formatValue(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return value;
  return "";
}

function clampValue(value: number) {
  return clampNumberScrubValue(value, props);
}

function numericValue() {
  const value = Number(props.modelValue);
  if (Number.isFinite(value)) return value;
  return typeof props.min === "number" && Number.isFinite(props.min) ? props.min : 0;
}

function handleInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  draft.value = raw;
  if (raw === "") {
    if (props.allowEmpty) emit("update:modelValue", null);
    return;
  }
  const value = Number(raw);
  if (Number.isFinite(value)) emit("update:modelValue", clampValue(value));
}

function beginEditing() {
  if (props.disabled) return;
  stopScrub?.();
  editing.value = true;
  draft.value = formatValue(props.modelValue);
  nextTick(() => {
    inputElement.value?.focus();
    inputElement.value?.select();
  });
}

function finishEditing() {
  if (!editing.value) return;
  const raw = draft.value.trim();
  if (raw === "" && props.allowEmpty) {
    emit("update:modelValue", null);
    emit("change", null);
  } else {
    const parsed = Number(raw);
    const value = Number.isFinite(parsed) ? clampValue(parsed) : numericValue();
    draft.value = String(value);
    emit("update:modelValue", value);
    emit("change", value);
  }
  editing.value = false;
  inputElement.value?.blur();
}

function cancelEditing() {
  draft.value = formatValue(props.modelValue);
  editing.value = false;
  inputElement.value?.blur();
}

function requestInputPointerLock(element: HTMLInputElement) {
  return new Promise<void>((resolve, reject) => {
    const dispose = () => {
      document.removeEventListener("pointerlockchange", onChange);
      document.removeEventListener("pointerlockerror", onError);
    };
    const onChange = () => {
      if (document.pointerLockElement !== element) return;
      dispose();
      resolve();
    };
    const onError = () => {
      dispose();
      reject(new Error("Pointer lock unavailable"));
    };
    // 这些监听独立于拖动，兼容返回 void、但稍后才成功的旧式 API。
    document.addEventListener("pointerlockchange", onChange);
    document.addEventListener("pointerlockerror", onError);
    try {
      const result = element.requestPointerLock();
      result?.then(onChange, onError);
    } catch { onError(); }
  });
}

function startScrub(event: PointerEvent) {
  if (props.disabled || editing.value || event.button !== 0) return;
  stopScrub?.();
  const element = inputElement.value;
  if (!element) return;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const options = { min: props.min, max: props.max, step: props.step, scrubSpeed: props.scrubSpeed };
  const previousCursor = document.body.style.cursor;
  const previousUserSelect = document.body.style.userSelect;
  const listeners = new AbortController();
  let active = true;
  let moved = false;
  let locked = false;
  let lastX = startX;
  let accumulated = clampValue(numericValue());
  let lastValue = accumulated;
  let modifiers = { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
  let edgeDirection = 0;
  let edgeFrame = 0;
  let lastFrameTime = 0;

  const applyMovement = (deltaX: number) => {
    if (!active || !Number.isFinite(deltaX) || deltaX === 0) return;
    const result = advanceNumberScrub(accumulated, deltaX, options, modifiers);
    accumulated = result.accumulated;
    if (result.value === lastValue) return;
    lastValue = result.value;
    draft.value = String(lastValue);
    emit("update:modelValue", lastValue);
  };

  // 浏览器不支持/拒绝锁定时，按住窗口边缘仍可连续调整。
  const continueAtEdge = (now: number) => {
    if (!active || !edgeDirection || locked) { edgeFrame = 0; return; }
    if (lastFrameTime) applyMovement(edgeDirection * Math.min(now - lastFrameTime, 50) * 0.3);
    lastFrameTime = now;
    edgeFrame = requestAnimationFrame(continueAtEdge);
  };
  const stopEdgeContinuation = () => {
    edgeDirection = 0;
    cancelAnimationFrame(edgeFrame);
    edgeFrame = 0;
    lastFrameTime = 0;
  };

  const lockPointer = () => {
    if (event.pointerType !== "mouse" || !element.requestPointerLock || document.pointerLockElement || pointerLockRequest) return;
    try {
      pointerLockRequest = requestInputPointerLock(element)
        .then(() => {
          // 松手或组件卸载时仍在等待的请求，不得留下锁住的鼠标。
          if (!active && document.pointerLockElement === element) document.exitPointerLock();
        })
        .catch(() => { /* 保留普通拖动和窗口边缘连续调整。 */ })
        .finally(() => { pointerLockRequest = null; });
    } catch { /* 某些浏览器会同步拒绝锁定，使用相同的回退。 */ }
  };

  const move = (nextEvent: PointerEvent) => {
    if (!active || locked || document.pointerLockElement === element || nextEvent.pointerId !== pointerId) return;
    if (!(nextEvent.buttons & 1)) { cleanup(); return; }
    if (!moved && Math.abs(nextEvent.clientX - startX) < 3) return;
    if (!moved) {
      moved = true;
      scrubbing.value = true;
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
      element.setPointerCapture(pointerId);
      lockPointer();
    }
    nextEvent.preventDefault();
    modifiers = nextEvent;
    applyMovement(nextEvent.clientX - lastX);
    lastX = nextEvent.clientX;
    const direction = nextEvent.clientX <= 8 ? -1 : nextEvent.clientX >= window.innerWidth - 8 ? 1 : 0;
    if (direction && event.pointerType === "mouse") {
      edgeDirection = direction;
      if (!edgeFrame) edgeFrame = requestAnimationFrame(continueAtEdge);
    } else stopEdgeContinuation();
  };

  const moveLocked = (nextEvent: MouseEvent) => {
    if (!active) return;
    // 浏览器或系统吞掉 mouseup 时，下一次移动也必须终止拖动。
    if (!(nextEvent.buttons & 1)) { cleanup(); return; }
    if (!moved || document.pointerLockElement !== element) return;
    modifiers = nextEvent;
    nextEvent.preventDefault();
    applyMovement(nextEvent.movementX);
  };

  const cleanup = () => {
    if (!active) return;
    active = false;
    listeners.abort();
    stopEdgeContinuation();
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    if (document.pointerLockElement === element) document.exitPointerLock();
    if (moved) emit("change", lastValue);
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousUserSelect;
    scrubbing.value = false;
    nextTick(() => { if (!editing.value) draft.value = formatValue(props.modelValue); });
    if (stopScrub === cleanup) stopScrub = null;
  };

  const handleLockChange = () => {
    if (document.pointerLockElement === element) {
      locked = true;
      stopEdgeContinuation();
    } else if (locked) cleanup();
  };
  const handleKey = (nextEvent: KeyboardEvent) => {
    modifiers = nextEvent;
    if (nextEvent.key === "Escape") cleanup();
  };

  stopScrub = cleanup;
  const signal = listeners.signal;
  window.addEventListener("pointermove", move, { passive: false, signal });
  window.addEventListener("mousemove", moveLocked, { passive: false, signal });
  window.addEventListener("pointerup", (nextEvent) => { if (nextEvent.pointerId === pointerId) cleanup(); }, { signal });
  window.addEventListener("pointercancel", (nextEvent) => { if (nextEvent.pointerId === pointerId) cleanup(); }, { signal });
  window.addEventListener("mouseup", (nextEvent) => { if (nextEvent.button === 0) cleanup(); }, { signal });
  window.addEventListener("blur", cleanup, { signal });
  window.addEventListener("keydown", handleKey, { signal });
  window.addEventListener("keyup", handleKey, { signal });
  document.addEventListener("pointerlockchange", handleLockChange, { signal });
}

onBeforeUnmount(() => stopScrub?.());
</script>

<style scoped>
.scrubbable-number-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 5px 8px;
  border: 1px solid #454b58;
  border-radius: 6px;
  background: #262b35;
  color: #e4e7ef;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  outline: none;
  appearance: textfield;
  -moz-appearance: textfield;
  transition: border-color .15s, box-shadow .15s;
}

.scrubbable-number-input::-webkit-inner-spin-button,
.scrubbable-number-input::-webkit-outer-spin-button { margin: 0; appearance: none; }
.scrubbable-number-input::placeholder { color: #8d94a2; }
.scrubbable-number-input:hover:not(:disabled) { border-color: #626b7e; }
.scrubbable-number-input:focus-visible {
  border-color: #7195ff !important;
  box-shadow: 0 0 0 2px #527cf326;
}

.scrubbable-number-input:not(.is-editing) {
  cursor: ew-resize !important;
  user-select: none;
  touch-action: none;
}

.scrubbable-number-input.is-scrubbing {
  border-color: #7195ff !important;
  box-shadow: inset 0 0 0 1px #7195ff, 0 0 0 2px #527cf326;
}

.scrubbable-number-input.is-editing {
  cursor: text !important;
  border-color: #7195ff !important;
  box-shadow: inset 0 0 0 1px #7195ff;
}

.scrubbable-number-input:disabled { opacity: .45; cursor: not-allowed !important; }
.scrubbable-number-input.is-animated { border-color: #a66571 !important; background: #533843 !important; }
.scrubbable-number-input.is-animated:hover:not(:disabled) { border-color: #d58e9b !important; }
.scrubbable-number-input.is-animated:is(:focus-visible, .is-editing, .is-scrubbing) { border-color: #f0a3b0 !important; box-shadow: inset 0 0 0 1px #f0a3b0, 0 0 0 2px #d36e8530; }
</style>
