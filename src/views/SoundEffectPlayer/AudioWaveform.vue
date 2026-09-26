<template>
  <div class="waveform-panel">
    <div class="waveform-heading">
      <span>{{ t('soundEffectPlayer.ui.waveform') }}</span>
      <span>{{ t('soundEffectPlayer.ui.waveformHint') }}</span>
    </div>
    <div class="waveform" role="slider" :tabindex="canSeek ? 0 : -1"
      :aria-label="t('soundEffectPlayer.ui.waveform')" :aria-disabled="!canSeek"
      :aria-valuemin="0" :aria-valuemax="duration || 0" :aria-valuenow="position"
      :aria-valuetext="`${formatTime(position)} / ${formatTime(duration)}`"
      @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
      @pointercancel="releasePointer" @lostpointercapture="releasePointer" @keydown="keyDown">
      <svg viewBox="0 0 512 112" preserveAspectRatio="none" aria-hidden="true">
        <path v-if="path" :d="path" class="waveform-bars" />
        <path v-else d="M 0 56 H 512" class="waveform-baseline" />
      </svg>
      <svg v-if="path" class="waveform-played" viewBox="0 0 512 112" preserveAspectRatio="none"
        :style="{ clipPath: `inset(0 ${100 - progress}% 0 0)` }" aria-hidden="true">
        <path :d="path" class="waveform-bars" />
      </svg>
      <span v-if="canSeek" class="waveform-cursor" :style="{ left: `${progress}%` }" aria-hidden="true"></span>
      <span v-if="status !== 'ready'" class="waveform-status" role="status">
        {{ t(`soundEffectPlayer.ui.${status === 'loading' ? 'waveformLoading' : status === 'error' ? 'waveformFailed' : 'notSelected'}`) }}
      </span>
    </div>
    <div class="waveform-ticks" aria-hidden="true">
      <span v-for="fraction in [0, 0.25, 0.5, 0.75, 1]" :key="fraction">{{ formatTime(duration * fraction) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { samplePeaks } from './waveform';

const props = defineProps<{ src: string; currentTime: number; duration: number; disabled: boolean }>();
const emit = defineEmits<{ (event: 'seek', seconds: number): void }>();
const { t } = useI18n();
const peaks = ref<number[]>([]);
const status = ref<'empty' | 'loading' | 'ready' | 'error'>('empty');
const activePointer = ref<number | null>(null);
// Retain only small peak arrays, never decoded audio buffers.
const cache = new Map<string, number[]>();
const canSeek = computed(() => !props.disabled && Number.isFinite(props.duration) && props.duration > 0);
const position = computed(() => Math.max(0, Math.min(props.currentTime, props.duration || 0)));
const progress = computed(() => canSeek.value ? position.value / props.duration * 100 : 0);
const path = computed(() => peaks.value.map((peak, index) => {
  const x = (index + 0.5) * 512 / peaks.value.length;
  const height = Math.max(1, peak * 50);
  return `M${x},${56 - height}V${56 + height}`;
}).join(' '));

watch(() => props.src, async (src, _previous, onCleanup) => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  activePointer.value = null;
  peaks.value = [];
  status.value = src ? 'loading' : 'empty';
  if (!src) return;
  const cached = cache.get(src);
  if (cached) {
    peaks.value = cached;
    status.value = 'ready';
    return;
  }
  try {
    const response = await fetch(src, { signal: controller.signal });
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (controller.signal.aborted) return;
    // Offline decoding does not open an audio output or require playback permission.
    const context = new OfflineAudioContext(1, 1, 44100);
    const buffer = await context.decodeAudioData(bytes);
    if (controller.signal.aborted) return;
    const result = samplePeaks(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
    cache.set(src, result);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
    peaks.value = result;
    status.value = 'ready';
  } catch {
    if (!controller.signal.aborted) status.value = 'error';
  }
}, { immediate: true });

function seekAtPointer(event: PointerEvent) {
  if (!canSeek.value) return;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!bounds.width) return;
  emit('seek', Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * props.duration);
}

function pointerDown(event: PointerEvent) {
  if (!canSeek.value || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  target.focus({ preventScroll: true });
  target.setPointerCapture(event.pointerId);
  activePointer.value = event.pointerId;
  seekAtPointer(event);
}

function pointerMove(event: PointerEvent) {
  if (activePointer.value === event.pointerId) seekAtPointer(event);
}

function pointerUp(event: PointerEvent) {
  if (activePointer.value !== event.pointerId) return;
  seekAtPointer(event);
  activePointer.value = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}

function releasePointer() {
  activePointer.value = null;
}

function keyDown(event: KeyboardEvent) {
  if (!canSeek.value) return;
  const step = Math.min(1, props.duration / 20);
  const targets: Record<string, number> = {
    ArrowLeft: position.value - step, ArrowDown: position.value - step,
    ArrowRight: position.value + step, ArrowUp: position.value + step,
    Home: 0, End: props.duration,
  };
  if (!(event.key in targets)) return;
  event.preventDefault();
  emit('seek', Math.max(0, Math.min(props.duration, targets[event.key])));
}

function formatTime(seconds: number) {
  const tenths = Number.isFinite(seconds) ? Math.floor(Math.max(0, seconds) * 10) : 0;
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}
</script>

<style scoped>
.waveform-panel {
  padding: 14px 16px 10px;
  border-radius: 16px;
  background: #eff7ff;
  color: #5b7ea7;
}
.waveform-heading, .waveform-ticks {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.waveform-heading { flex-wrap: wrap; margin-bottom: 10px; }
.waveform {
  position: relative;
  height: 112px;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  border-radius: 4px;
}
.waveform[aria-disabled="true"] { cursor: default; }
.waveform:focus-visible { outline: 2px solid #174ea6; outline-offset: 4px; }
.waveform svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.waveform-bars { fill: none; stroke: #a7d3ef; stroke-width: 2.5; stroke-linecap: round; }
.waveform-played .waveform-bars { stroke: #174ea6; }
.waveform-baseline { stroke: #bdd8ec; stroke-dasharray: 2 4; }
.waveform-cursor { position: absolute; top: 0; bottom: 0; width: 2px; background: #174ea6; transform: translateX(-1px); pointer-events: none; }
.waveform-status { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; font-size: 12px; pointer-events: none; }
.waveform-ticks { margin-top: 8px; font-variant-numeric: tabular-nums; font-size: 10px; }
</style>
