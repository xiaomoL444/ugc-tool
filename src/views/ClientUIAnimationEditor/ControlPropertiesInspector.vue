<template>
  <details class="property-section control-properties-section" open>
    <summary><h3><span>{{ definition.icon }}</span>{{ definition.label }}参数<i>{{ definition.runtimeClass }}</i></h3><slot name="actions"></slot></summary>
    <div class="property-content">
    <p class="source-note">字段来自当前客户端 UI API；“运行时只读”仅表示 Lua 访问权限，编辑器中仍可填写。</p>

    <div v-for="field in definition.fields" :key="field.key" class="control-field" :class="[`kind-${field.kind}`, { 'is-animated-field': isAnimated(field) }]" :data-field="field.key" :data-animated="isAnimated(field) ? 'true' : undefined" :title="fieldTitle(field)">
      <div class="field-heading">
        <span>{{ field.label }}</span>
        <small v-if="field.tweenable" :class="{ 'animated-badge': isAnimated(field) }">{{ isAnimated(field) ? '◆ 已加入动画' : 'Tween' }}</small>
        <small v-if="field.runtimeReadOnly" class="readonly-badge">运行时只读</small>
      </div>

      <ColorRGBAField v-if="field.kind === 'color'" :label="field.label" :model-value="asColor(modelValue[field.key])" :animated="isAnimated(field)" @update:model-value="updateField(field.key, $event)" />
      <textarea v-else-if="field.kind === 'textarea'" :aria-label="field.label" :value="stringValue(modelValue[field.key])" rows="4" @input="updateField(field.key, ($event.target as HTMLTextAreaElement).value)"></textarea>
      <input v-else-if="field.kind === 'text'" :aria-label="field.label" :value="stringValue(modelValue[field.key])" @input="updateField(field.key, ($event.target as HTMLInputElement).value)" />
      <ScrubbableNumberInput v-else-if="field.kind === 'number'" :aria-label="field.label" :model-value="numberValue(modelValue[field.key])" :animated="isAnimated(field)" :min="field.min" :max="field.max" :step="field.step ?? 1" :allow-empty="!isAnimated(field)" placeholder="未设置" @update:model-value="updateNumber(field.key, $event)" />
      <label v-else-if="field.kind === 'boolean'" class="boolean-control"><input :aria-label="field.label" :checked="Boolean(modelValue[field.key])" type="checkbox" @change="updateField(field.key, ($event.target as HTMLInputElement).checked)" /><i></i><span>{{ modelValue[field.key] ? '开启' : '关闭' }}</span></label>
      <select v-else-if="field.kind === 'nullableBoolean'" :aria-label="field.label" :value="nullableBooleanValue(modelValue[field.key])" @change="updateNullableBoolean(field.key, $event)"><option value="">未设置</option><option value="true">true</option><option value="false">false</option></select>
      <select v-else-if="field.kind === 'select'" :aria-label="field.label" :value="stringValue(modelValue[field.key])" @change="updateSelect(field.key, $event)"><option value="">未设置</option><option v-for="item in field.options" :key="item.value" :value="item.value">{{ item.label }}</option></select>
    </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import ColorRGBAField from "./ColorRGBAField.vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import type { ControlDefinition, ControlPropertyField } from "./controlRegistry";
import type { ColorRGBA, ControlType } from "./types";

const props = withDefaults(defineProps<{ definition: ControlDefinition<ControlType>; modelValue: Record<string, unknown>; animatedFields?: string[] }>(), { animatedFields: () => [] });
const emit = defineEmits<{ (event: "update:modelValue", value: Record<string, unknown>): void }>();

function isAnimated(field: ControlPropertyField) { return Boolean(field.tweenable) && (field.kind === "number" || field.kind === "color") && props.animatedFields.includes(field.key); }
function fieldTitle(field: ControlPropertyField) { return isAnimated(field) ? [field.description, "此属性已加入动画；修改会在当前时间记帧"].filter(Boolean).join("\n") : field.description; }
function updateField(key: string, value: unknown) { emit("update:modelValue", { ...props.modelValue, [key]: value }); }
function updateNumber(key: string, value: number | null) { updateField(key, value); }
function updateNullableBoolean(key: string, event: Event) { const raw = (event.target as HTMLSelectElement).value; updateField(key, raw === "" ? null : raw === "true"); }
function updateSelect(key: string, event: Event) { const raw = (event.target as HTMLSelectElement).value; updateField(key, raw === "" ? null : raw); }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : ""; }
function nullableBooleanValue(value: unknown) { return value === true ? "true" : value === false ? "false" : ""; }
function asColor(value: unknown) { const color = value as Partial<ColorRGBA> | null; return color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b) ? color as ColorRGBA : { r: 255, g: 255, b: 255, a: 1 }; }
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
.property-section h3 i {
  margin-left: auto;
  max-width: 135px;
  overflow: hidden;
  color: #a9afbb;
  font-size: 9px;
  font-style: normal;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-note {
  margin: 0 0 11px;
  color: #a9afbb;
  font-size: 10px;
  line-height: 1.6;
}

.control-field { margin-top: 11px; }
.field-heading {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 6px;
  color: #c9ced8;
  font-size: 11px;
}

.field-heading small {
  padding: 1px 4px;
  border: 1px solid #536383;
  border-radius: 3px;
  color: #a6bcff;
  font-size: 8px;
  line-height: 1.4;
}

.field-heading .readonly-badge {
  margin-left: auto;
  border-color: #655f50;
  color: #ccbd94;
}

.field-heading .animated-badge { border-color: #a65f69; color: #ffc1c8; background: #663b4638; }

.control-field > input,
.control-field > select,
.control-field > textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 30px;
  border: 1px solid #454b58 !important;
  border-radius: 6px !important;
  background: #262b35 !important;
  color: #e4e7ef !important;
  font: inherit;
  font-size: 12px !important;
  padding: 5px 8px !important;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}

.control-field > input,
.control-field > select { height: 30px; }
.control-field > textarea { resize: vertical; line-height: 1.6; }
.control-field > :is(input, select, textarea):hover { border-color: #626b7e !important; }
.control-field > :is(input, select, textarea):focus-visible {
  border-color: #7195ff !important;
  box-shadow: 0 0 0 2px #527cf326;
}

.control-field.is-animated-field > :deep(.scrubbable-number-input.is-animated) { border-color: #a66571 !important; background: #533843 !important; }

.control-field > input::placeholder { color: #8d94a2; }
.boolean-control {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 26px;
  color: #a9afbb;
  font-size: 10px;
  cursor: pointer;
}

.boolean-control input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.boolean-control i {
  position: relative;
  box-sizing: border-box;
  width: 42px;
  height: 23px;
  border: 1px solid #555d6c;
  border-radius: 12px;
  background: #414855;
  pointer-events: none;
}

.boolean-control i::after {
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

.boolean-control input:checked + i { border-color: #658dff; background: #527cf3; }
.boolean-control input:checked + i::after { transform: translateX(19px); background: #fff; }
.boolean-control input:focus-visible + i { outline: 2px solid #a5baff; outline-offset: 3px; }
.kind-color :deep(.rgba-control) { margin-top: 0; }
.kind-color > .field-heading { display: none; }
</style>
