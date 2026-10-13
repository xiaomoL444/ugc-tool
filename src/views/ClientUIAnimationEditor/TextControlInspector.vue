<template>
  <details class="property-section text-control-section" open>
    <summary><h3><span>T</span>{{ t('clientUIAnimationEditor.ui.controls.text.settings') }}<i>ClientUITextBoxControl</i></h3></summary>
    <div class="property-content">

    <label class="number-row"><span>{{ t('clientUIAnimationEditor.ui.controls.fontSize') }}</span><ScrubbableNumberInput :model-value="modelValue.fontSize" :min="1" :step="1" @update:model-value="setNumber('fontSize', $event)" /></label>
    <label class="switch-row"><span><b>?</b>{{ t('clientUIAnimationEditor.ui.controls.text.adaptiveFontSize') }}</span><input :checked="modelValue.adaptiveFontSize" type="checkbox" @change="setBoolean('adaptiveFontSize', $event)" /><i></i></label>
    <label v-if="modelValue.adaptiveFontSize" class="number-row compact"><span>{{ t('clientUIAnimationEditor.ui.controls.text.minimumFontSize') }}</span><ScrubbableNumberInput :model-value="modelValue.minimumFontSize ?? ''" :min="1" :max="modelValue.fontSize ?? undefined" :step="1" @update:model-value="setNumber('minimumFontSize', $event)" /></label>

    <ColorRGBAField :label="t('clientUIAnimationEditor.ui.controls.text.color')" :model-value="modelValue.fontColor" @update:model-value="setField('fontColor', $event)" />
    <ColorRGBAField :label="t('clientUIAnimationEditor.ui.controls.backgroundColor')" :model-value="modelValue.bgColor" @update:model-value="setField('bgColor', $event)" />

    <label class="switch-row outline-switch"><span>{{ t('clientUIAnimationEditor.ui.controls.enableTextOutline') }}</span><input :checked="modelValue.enableOutline" type="checkbox" @change="setBoolean('enableOutline', $event)" /><i></i></label>
    <ColorRGBAField v-if="modelValue.enableOutline" :label="t('clientUIAnimationEditor.ui.controls.outlineColor')" :model-value="modelValue.outlineColor" @update:model-value="setField('outlineColor', $event)" />

    <div class="alignment-block">
      <span>{{ t('clientUIAnimationEditor.ui.controls.alignment') }}</span>
      <div class="alignment-row">
        <button v-for="option in horizontalOptions" :key="option.value" :class="{ active: modelValue.horizontalAlignment === option.value }" :title="t(option.label)" :aria-label="t(option.label)" :aria-pressed="modelValue.horizontalAlignment === option.value" @click="setField('horizontalAlignment', option.value)">{{ option.icon }}</button>
        <em></em>
        <button v-for="option in verticalOptions" :key="option.value" :class="{ active: modelValue.verticalAlignment === option.value }" :title="t(option.label)" :aria-label="t(option.label)" :aria-pressed="modelValue.verticalAlignment === option.value" @click="setField('verticalAlignment', option.value)">{{ option.icon }}</button>
      </div>
    </div>

    <label class="text-content"><span>{{ t('clientUIAnimationEditor.ui.controls.textContent') }}</span><textarea :value="modelValue.text" rows="5" @input="setText"></textarea></label>
    </div>
  </details>
</template>

<script setup lang="ts">
import { t } from '../../i18n';
import ColorRGBAField from "./ColorRGBAField.vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import type { ClientUITextBoxControlProperties, TextHorizontalAlignment, TextVerticalAlignment } from "./types";

const props = defineProps<{ modelValue: ClientUITextBoxControlProperties }>();
const emit = defineEmits<{ (event: "update:modelValue", value: ClientUITextBoxControlProperties): void }>();

const horizontalOptions: Array<{ value: TextHorizontalAlignment; label: string; icon: string }> = [
  { value: "left", label: 'clientUIAnimationEditor.ui.controls.alignLeft', icon: "↤" },
  { value: "middle", label: 'clientUIAnimationEditor.ui.controls.text.alignHorizontalCenter', icon: "↔" },
  { value: "right", label: 'clientUIAnimationEditor.ui.controls.alignRight', icon: "↦" },
];
const verticalOptions: Array<{ value: TextVerticalAlignment; label: string; icon: string }> = [
  { value: "top", label: 'clientUIAnimationEditor.ui.controls.text.alignTop', icon: "↥" },
  { value: "middle", label: 'clientUIAnimationEditor.ui.controls.alignCenterVertically', icon: "↕" },
  { value: "bottom", label: 'clientUIAnimationEditor.ui.controls.alignBottom', icon: "↧" },
];

function setField<K extends keyof ClientUITextBoxControlProperties>(key: K, value: ClientUITextBoxControlProperties[K]) {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

function setNumber(key: "fontSize" | "minimumFontSize", input: number | null) {
  const value = Math.max(1, Math.round(input ?? 1));
  setField(key, value);
}

function setBoolean(key: "adaptiveFontSize" | "enableOutline", event: Event) {
  setField(key, (event.target as HTMLInputElement).checked);
}

function setText(event: Event) {
  setField("text", (event.target as HTMLTextAreaElement).value);
}
</script>

<style scoped>
.property-section {
  margin: 6px 8px;
  padding: 0;
  border: 1px solid #454b58;
  border-radius: 8px;
  background: #303540;
}

.property-section > summary { display: flex; align-items: center; gap: 7px; padding: 11px; cursor: pointer; list-style: none; }
.property-section > summary::-webkit-details-marker { display: none; }
.property-section > summary::before { content: ""; flex: none; width: 0; height: 0; border-top: 4px solid transparent; border-bottom: 4px solid transparent; border-left: 5px solid #c6ccd8; }
.property-section[open] > summary::before { transform: rotate(90deg); }
.property-section > summary:hover { background: #ffffff04; }
.property-section > summary:focus-visible { outline: 2px solid #a5baff; outline-offset: -2px; border-radius: 7px; }
.property-content { padding: 0 11px 11px; }
.property-section h3 {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  flex: 1;
  min-width: 0;
  margin: 0;
  color: #e4e7ef;
  font-size: 12px;
  font-weight: 600;
}

.property-section h3 > span { color: #c6ccd8; }
.property-section h3 i { margin-left: auto; color: #a9afbb; font-size: 9px; font-style: normal; font-weight: 400; }
.number-row {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  align-items: center;
  margin-top: 9px;
  color: #c9ced8;
  font-size: 11px;
}

.number-row input,
.text-content textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #454b58 !important;
  border-radius: 6px !important;
  background: #262b35 !important;
  color: #e4e7ef !important;
  font: inherit;
  font-size: 12px !important;
  padding: 5px 8px !important;
  outline: none;
}

.number-row input { height: 30px; }
.number-row input:hover,
.text-content textarea:hover { border-color: #626b7e !important; }
.number-row input:focus-visible,
.text-content textarea:focus-visible { border-color: #7195ff !important; box-shadow: 0 0 0 2px #527cf326; }
.number-row.compact { padding-left: 12px; }
.switch-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 27px;
  margin-top: 10px;
  color: #c9ced8;
  font-size: 11px;
  cursor: pointer;
}

.switch-row span { display: flex; align-items: center; gap: 5px; }
.switch-row span b {
  display: grid;
  place-items: center;
  width: 13px;
  height: 13px;
  border: 1px solid #717b8c;
  border-radius: 50%;
  color: #c6ccd8;
  font-size: 9px;
  font-weight: 500;
}

.switch-row input { position: absolute; right: 0; width: 42px; height: 23px; margin: 0; opacity: 0; cursor: pointer; }
.switch-row > i {
  position: relative;
  box-sizing: border-box;
  width: 42px;
  height: 23px;
  border: 1px solid #555d6c;
  border-radius: 12px;
  background: #414855;
  pointer-events: none;
}

.switch-row > i::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #bac1ce;
  transition: transform .15s, background .15s;
}

.switch-row input:checked + i { border-color: #658dff; background: #527cf3; }
.switch-row input:checked + i::after { transform: translateX(19px); background: #fff; }
.switch-row input:focus-visible + i { outline: 2px solid #a5baff; outline-offset: 3px; }
.outline-switch { margin-top: 12px; }
.alignment-block { margin-top: 13px; color: #c9ced8; font-size: 11px; }
.alignment-block > span { display: block; margin-bottom: 6px; }
.alignment-row { display: flex; align-items: center; gap: 4px; }
.alignment-row button {
  flex: 1;
  min-width: 27px;
  height: 30px;
  padding: 0;
  border: 1px solid #454b58;
  border-radius: 6px;
  background: #262b35;
  color: #c9ced8;
  font-size: 17px;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}

.alignment-row button:hover { border-color: #626b7e; background: #3e4655; color: #fff; }
.alignment-row button.active { border-color: #658dff; background: #527cf3; color: #fff; }
.alignment-row button:focus-visible { outline: 2px solid #a5baff; outline-offset: 2px; }
.alignment-row em { width: 1px; height: 17px; margin: 0 3px; background: #454b58; }
.text-content { display: block; margin-top: 12px; color: #c9ced8; font-size: 11px; }
.text-content span { display: block; margin-bottom: 6px; }
.text-content textarea { resize: vertical; line-height: 1.6; }
</style>
