<template>
  <div class="duration-filter">
    <NPopover :show="open" trigger="click" :placement="placement" :show-arrow="false" raw
      :theme-overrides="{ boxShadow: 'none' }"
      :disabled="disabled" to="body" @update:show="setOpen">
      <template #trigger>
        <button ref="triggerRef" type="button" class="duration-filter-trigger" :class="{ active }"
          :disabled="disabled" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="panelId"
          @keydown.down.prevent="setOpen(true)" @keydown.escape.stop.prevent="close(true)">
          <span>{{ label }}</span><span class="duration-chevron" aria-hidden="true"></span>
        </button>
      </template>
      <form v-if="open" :id="panelId" ref="panelRef" class="duration-filter-panel" role="dialog"
        :style="{ width: `${panelWidth}px` }"
        :aria-label="t('soundEffectPlayer.duration.title')" @submit.prevent="apply"
        @keydown.escape.stop.prevent="close(true)">
        <div class="duration-inputs">
          <label>
            <span>{{ t('soundEffectPlayer.duration.minimum') }}</span>
            <input data-duration-min type="number" min="0" step="any" inputmode="decimal" :value="draftMin"
              :placeholder="t('soundEffectPlayer.duration.minimumPlaceholder')" :aria-invalid="!!error"
              :aria-describedby="error ? `${panelId}-error` : undefined" @input="updateInput('min', $event)" />
          </label>
          <span class="duration-separator" aria-hidden="true">–</span>
          <label>
            <span>{{ t('soundEffectPlayer.duration.maximum') }}</span>
            <input data-duration-max type="number" min="0" step="any" inputmode="decimal" :value="draftMax"
              :placeholder="t('soundEffectPlayer.duration.maximumPlaceholder')" :aria-invalid="!!error"
              :aria-describedby="error ? `${panelId}-error` : undefined" @input="updateInput('max', $event)" />
          </label>
          <span class="duration-unit">{{ t('soundEffectPlayer.duration.seconds') }}</span>
        </div>
        <div class="duration-slider" @keyup="onSliderKeyup" @focusout="onSliderBlur">
          <div class="duration-longest">{{ t('soundEffectPlayer.duration.longest', { seconds: format(metadataMaximum) }) }}</div>
          <NSlider range :value="sliderValues" :min="0" :max="100" :step="0.1" :disabled="!!error"
            :format-tooltip="sliderTooltip" :theme-overrides="sliderTheme" @update:value="updateSlider"
            @dragstart="beginSliderDrag" @dragend="endSliderDrag" />
          <div class="duration-ticks">
            <span>0 {{ t('soundEffectPlayer.duration.seconds') }}</span>
            <span v-if="fixedTick !== null" class="duration-tick-value" :style="{ left: `${position(fixedTick)}%` }">{{ format(fixedTick) }} {{ t('soundEffectPlayer.duration.seconds') }}</span>
            <span>{{ t('soundEffectPlayer.duration.all') }}</span>
          </div>
        </div>
        <div class="duration-presets">
          <button v-for="preset in presets" :key="preset.key" type="button"
            @click="choosePreset(preset.min, preset.max)">{{ t(`soundEffectPlayer.duration.${preset.key}`) }}</button>
        </div>
        <p v-if="error" :id="`${panelId}-error`" class="duration-error" role="alert">{{ error }}</p>
        <div class="duration-actions">
          <button type="button" class="duration-filter-reset" @click="choosePreset(null, null)">{{ t('soundEffectPlayer.duration.reset') }}</button>
          <button type="submit" class="duration-filter-apply" :disabled="!!error">{{ t('soundEffectPlayer.duration.apply') }}</button>
        </div>
      </form>
    </NPopover>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { NPopover, NSlider } from 'naive-ui';
import { useI18n } from 'vue-i18n';
import type { DurationRange } from './types/DurationRange';

const props = defineProps<{ modelValue: DurationRange; maxDuration: number; disabled?: boolean }>();
const emit = defineEmits<{ (event: 'update:modelValue', value: DurationRange): void }>();
const { t, locale } = useI18n({ useScope: 'global' });
const open = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLFormElement | null>(null);
const panelId = `sound-duration-${Math.random().toString(36).slice(2)}`;
const draftMin = ref(''), draftMax = ref('');
const badMin = ref(false), badMax = ref(false);
const sliderDomain = ref(1);
let sliderDirty = false;
let sliderDragging = false;
const placement = ref<'bottom-start' | 'bottom-end'>('bottom-end');
const panelWidth = ref(336);
const presets = [
  { key: 'presetShort', min: null, max: 1 },
  { key: 'presetMedium', min: 1, max: 3 },
  { key: 'presetLong', min: 3, max: 10 },
  { key: 'presetExtended', min: 10, max: null },
];
const sliderTheme = { fillColor: '#3675ed', fillColorHover: '#235fd9', handleBoxShadowFocus: '0 0 0 3px #dceaff' };
const active = computed(() => props.modelValue.min !== null || props.modelValue.max !== null);
const metadataMaximum = computed(() => Number.isFinite(props.maxDuration) && props.maxDuration >= 0 ? props.maxDuration : 0);
const format = (seconds: number) => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 12 }).format(seconds);
const label = computed(() => {
  const { min, max } = props.modelValue;
  if (min === null && max === null) return t('soundEffectPlayer.duration.allLabel');
  if (min === null) return t('soundEffectPlayer.duration.maxLabel', { max: format(max!) });
  if (max === null) return t('soundEffectPlayer.duration.minLabel', { min: format(min) });
  return t('soundEffectPlayer.duration.rangeLabel', { min: format(min), max: format(max) });
});
function bound(raw: string): number | null { return raw.trim() === '' ? null : Number(raw); }
const error = computed(() => {
  const min = bound(draftMin.value), max = bound(draftMax.value);
  if (badMin.value || badMax.value || [min, max].some(value => value !== null && (!Number.isFinite(value) || value < 0))) {
    return t('soundEffectPlayer.duration.invalid');
  }
  return min !== null && max !== null && min > max ? t('soundEffectPlayer.duration.reversed') : '';
});
function refreshDomain() {
  const valid = [props.maxDuration, bound(draftMin.value), bound(draftMax.value)]
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);
  sliderDomain.value = Math.max(1, ...valid);
}
// Most sounds are short; a logarithmic scale leaves room for long clips without crowding the handles.
function position(seconds: number) { return Math.max(0, Math.min(100, Math.log1p(seconds) / Math.log1p(sliderDomain.value) * 100)); }
function secondsAt(value: number) { return Math.round(Math.expm1(value / 100 * Math.log1p(sliderDomain.value)) * 1000) / 1000; }
const sliderValues = computed(() => [
  position(Math.max(0, bound(draftMin.value) || 0)),
  position(Math.max(0, bound(draftMax.value) ?? sliderDomain.value)),
]);
const fixedTick = computed(() => sliderDomain.value >= 30 ? 10 : sliderDomain.value >= 3 ? 1 : null);
const sliderTooltip = (value: number) => `${format(secondsAt(value))} ${t('soundEffectPlayer.duration.seconds')}`;
function updateInput(endpoint: 'min' | 'max', event: Event) {
  const input = event.target as HTMLInputElement;
  if (endpoint === 'min') { draftMin.value = input.value; badMin.value = input.validity.badInput; }
  else { draftMax.value = input.value; badMax.value = input.validity.badInput; }
  refreshDomain();
}
function updateSlider(value: number | number[]) {
  if (!Array.isArray(value)) return;
  const previous = sliderValues.value;
  const lowerChanged = Math.abs(value[0] - previous[0]) > 0.00001;
  const upperChanged = Math.abs(value[1] - previous[1]) > 0.00001;
  let [lower, upper] = value;
  if (lower > upper) {
    if (lowerChanged && !upperChanged) lower = upper;
    else if (upperChanged && !lowerChanged) upper = lower;
    else [lower, upper] = [upper, lower];
  }
  const oldMin = bound(draftMin.value), oldMax = bound(draftMax.value);
  if (lowerChanged) {
    const seconds = lower <= 0 ? null : Math.min(secondsAt(lower), !upperChanged && oldMax !== null ? oldMax : Infinity);
    draftMin.value = seconds === null ? '' : String(seconds);
  }
  if (upperChanged) {
    const seconds = upper >= 100 ? null : Math.max(secondsAt(upper), !lowerChanged && oldMin !== null ? oldMin : 0);
    draftMax.value = seconds === null ? '' : String(seconds);
  }
  badMin.value = badMax.value = false;
  sliderDirty ||= lowerChanged || upperChanged;
}
function choosePreset(min: number | null, max: number | null) {
  draftMin.value = min === null ? '' : String(min);
  draftMax.value = max === null ? '' : String(max);
  badMin.value = badMax.value = false;
  sliderDirty = false;
  refreshDomain();
}
function close(restoreFocus = false) {
  open.value = false;
  sliderDirty = false;
  if (restoreFocus) void nextTick(() => triggerRef.value?.focus());
}
function fitPopover() {
  const anchor = triggerRef.value?.getBoundingClientRect();
  if (!anchor) return;
  const desired = Math.min(336, window.innerWidth - 24);
  const endSpace = Math.max(0, anchor.right - 12);
  const startSpace = Math.max(0, window.innerWidth - anchor.left - 12);
  const alignEnd = endSpace >= desired || endSpace >= startSpace;
  placement.value = alignEnd ? 'bottom-end' : 'bottom-start';
  panelWidth.value = Math.min(desired, alignEnd ? endSpace : startSpace);
}
function setOpen(value: boolean) {
  if (!value) { close(); return; }
  if (props.disabled) return;
  choosePreset(props.modelValue.min, props.modelValue.max);
  fitPopover();
  open.value = true;
  void nextTick(() => panelRef.value?.querySelector<HTMLInputElement>('[data-duration-min]')?.focus());
}
function commitDraft() {
  if (error.value || props.disabled) return false;
  const value = { min: bound(draftMin.value), max: bound(draftMax.value) };
  if (value.min !== props.modelValue.min || value.max !== props.modelValue.max) emit('update:modelValue', value);
  return true;
}
function apply() {
  if (commitDraft()) close(true);
}
function commitSlider() {
  if (!open.value || !sliderDirty) return;
  sliderDirty = false;
  commitDraft();
}
function beginSliderDrag() { sliderDragging = true; }
function endSliderDrag() {
  sliderDragging = false;
  commitSlider();
}
function onSliderKeyup(event: KeyboardEvent) {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) commitSlider();
}
function onSliderBlur() {
  if (!sliderDragging) commitSlider();
}
watch([open, locale, sliderValues], async () => {
  await nextTick();
  const handles = panelRef.value?.querySelectorAll<HTMLElement>('[role="slider"]');
  handles?.forEach((handle, index) => {
    handle.setAttribute('aria-label', t(`soundEffectPlayer.duration.${index === 0 ? 'minimum' : 'maximum'}`));
    const value = index === 0 ? bound(draftMin.value) ?? 0 : bound(draftMax.value);
    handle.setAttribute('aria-valuetext', value === null ? t('soundEffectPlayer.duration.all') : `${format(value)} ${t('soundEffectPlayer.duration.seconds')}`);
  });
});
watch(() => props.disabled, value => { if (value) close(); });
watch(() => props.maxDuration, () => { if (open.value) refreshDomain(); });
watch(() => props.modelValue, value => {
  if (open.value && (value.min !== bound(draftMin.value) || value.max !== bound(draftMax.value))) close();
});
watch(open, value => {
  if (value) window.addEventListener('resize', fitPopover);
  else window.removeEventListener('resize', fitPopover);
});
onBeforeUnmount(() => window.removeEventListener('resize', fitPopover));
</script>

<style scoped>
.duration-filter { flex: 0 0 auto; max-width: 100%; height: 38px; }
.duration-filter-trigger { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 100%; height: 38px; padding: 0 12px; border: 1px solid rgba(106, 90, 205, .2); border-radius: 8px; background: #f1f1ff; color: inherit; font: inherit; white-space: nowrap; cursor: pointer; }
.duration-filter-trigger.active { border-color: #bbd6ff; background: #eaf4ff; color: #1959dd; }
.duration-filter-trigger:hover:not(:disabled) { border-color: #90b9fa; background: #e9f1ff; }
.duration-filter-trigger:disabled { opacity: .5; cursor: not-allowed; }
.duration-chevron { flex: 0 0 auto; width: 6px; height: 6px; margin: -3px 2px 0; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(45deg); }
.duration-filter-panel { box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; width: min(336px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow-y: auto; padding: 16px; border: 1px solid #d9ddf2; border-radius: 10px; background: #fbfbff; color: #2c3e50; box-shadow: 0 6px 24px #23345f24; font: 14px/1.5 var(--app-font-family, sans-serif); text-align: left; }
.duration-inputs { display: flex; align-items: flex-end; gap: 8px; }
.duration-inputs label { display: flex; flex: 1; flex-direction: column; gap: 5px; min-width: 0; }
.duration-inputs label > span { color: #66758a; font-size: 12px; }
.duration-inputs input { box-sizing: border-box; width: 100%; min-width: 0; height: 34px; padding: 4px 8px; border: 1px solid #d2d9ed; border-radius: 6px; background: #fff; color: inherit; font: inherit; font-variant-numeric: tabular-nums; }
.duration-separator, .duration-unit { padding-bottom: 6px; color: #66758a; }
.duration-slider { padding: 0 8px; }
.duration-longest { margin-bottom: 8px; color: #6c7a90; font-size: 12px; }
.duration-ticks { position: relative; display: flex; justify-content: space-between; margin-top: 3px; color: #6c7a90; font-size: 12px; }
.duration-tick-value { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.duration-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.duration-presets button, .duration-actions button { min-height: 30px; padding: 4px 9px; border: 1px solid #d5dcf1; border-radius: 6px; background: #f1f3ff; color: #3f587c; font: inherit; cursor: pointer; }
.duration-presets button { font-size: 12px; }
.duration-presets button:hover, .duration-filter-reset:hover { background: #e6edff; }
.duration-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.duration-actions .duration-filter-apply { min-width: 70px; border-color: #3675ed; background: #3675ed; color: #fff; }
.duration-filter-apply:disabled { opacity: .5; cursor: not-allowed; }
.duration-error { margin: 0; color: #b63242; font-size: 12px; }
.duration-filter-trigger:focus-visible, .duration-filter-panel button:focus-visible, .duration-filter-panel input:focus-visible { outline: 2px solid #0ea2e5; outline-offset: 2px; }
@media (pointer: coarse) { .duration-filter-panel button, .duration-inputs input { min-height: 40px; } .duration-inputs input { font-size: 16px; } }
</style>
