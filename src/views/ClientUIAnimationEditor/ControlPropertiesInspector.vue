<template>
  <details class="property-section control-properties-section" :class="{ 'image-mask-section': definition.type === 'image' }" open>
    <summary><h3><span>{{ definition.icon }}</span>{{ definition.type === 'image' ? '遮罩设置' : definition.label + '参数' }}<i v-if="definition.type !== 'image'">{{ definition.editorOnly ? '自定义控件' : definition.runtimeClass }}</i></h3><slot name="actions"></slot></summary>
    <div class="property-content">
    <p v-if="definition.editorOnly" class="source-note">在图片资源面板统一管理原图、拟合与参数导出，此控件引用资源并选择显示方式。当前 GIA 导出仍为容器节点。</p>
    <p v-else-if="definition.type !== 'image'" class="source-note">字段来自当前客户端 UI API；“运行时只读”仅表示 Lua 访问权限，编辑器中仍可填写。</p>

    <div v-for="field in visibleFields" :key="field.key" class="control-field" :class="[`kind-${field.kind}`, { 'is-animated-field': isAnimated(field) }]" :data-field="field.key" :data-animated="isAnimated(field) ? 'true' : undefined" :title="fieldTitle(field)">
      <div class="field-heading">
        <span>{{ field.label }}</span>
        <small v-if="field.tweenable" :class="{ 'animated-badge': isAnimated(field) }">{{ isAnimated(field) ? '◆ 已加入动画' : 'Tween' }}</small>
        <small v-if="field.runtimeReadOnly" class="readonly-badge">运行时只读</small>
      </div>

      <slot :name="`field-${field.key}`" :field="field">
      <ColorRGBAField v-if="field.kind === 'color'" :label="field.label" :model-value="asColor(modelValue[field.key])" :animated="isAnimated(field)" @update:model-value="updateField(field.key, $event)" />
      <textarea v-else-if="field.kind === 'textarea'" :aria-label="field.label" :value="stringValue(modelValue[field.key])" rows="4" @input="updateField(field.key, ($event.target as HTMLTextAreaElement).value)"></textarea>
      <input v-else-if="field.kind === 'text'" :aria-label="field.label" :value="stringValue(modelValue[field.key])" @input="updateField(field.key, ($event.target as HTMLInputElement).value)" />
      <div v-else-if="definition.type === 'image' && field.key === 'fillAmount'" class="mask-range"><input type="range" min="0" max="100" step="0.1" aria-label="填充进度滑块" :value="Number(modelValue.fillAmount ?? 1) * 100" @input="updateNumber('fillAmount', Number(($event.target as HTMLInputElement).value) / 100)" /><ScrubbableNumberInput :model-value="typeof modelValue.fillAmount === 'number' ? modelValue.fillAmount * 100 : null" :min="0" :max="100" :step="0.1" :animated="isAnimated(field)" aria-label="填充进度百分比" placeholder="未设置" @update:model-value="$event !== null && updateNumber('fillAmount', $event / 100)" /></div>
      <div v-else-if="definition.type === 'image' && ['horizontalSoftRange', 'verticalSoftRange'].includes(field.key)" class="mask-range"><input type="range" min="0" max="100" step="0.01" :aria-label="`${field.label}滑块`" :value="modelValue[field.key] ?? 85" @input="updateNumber(field.key, Number(($event.target as HTMLInputElement).value))" /><ScrubbableNumberInput :model-value="numberValue(modelValue[field.key])" :min="0" :max="100" :step="0.01" :animated="isAnimated(field)" :allow-empty="!isAnimated(field)" :aria-label="field.label" placeholder="未设置" @update:model-value="updateNumber(field.key, $event)" /></div>
      <ScrubbableNumberInput v-else-if="field.kind === 'number'" :aria-label="field.label" :model-value="numberValue(modelValue[field.key])" :animated="isAnimated(field)" :min="field.min" :max="field.max" :step="field.step ?? 1" :allow-empty="!isAnimated(field)" placeholder="未设置" @update:model-value="updateNumber(field.key, $event)" />
      <label v-else-if="field.kind === 'boolean'" class="boolean-control"><input :aria-label="field.label" :checked="booleanValue(field.key)" type="checkbox" role="switch" @change="updateField(field.key, ($event.target as HTMLInputElement).checked)" /><i></i><span>{{ booleanValue(field.key) ? '开启' : '关闭' }}</span></label>
      <select v-else-if="field.kind === 'nullableBoolean'" :aria-label="field.label" :value="nullableBooleanValue(modelValue[field.key])" @change="updateNullableBoolean(field.key, $event)"><option value="">未设置</option><option value="true">true</option><option value="false">false</option></select>
      <select v-else-if="field.kind === 'select'" :aria-label="field.label" :value="selectValue(field)" @change="updateSelect(field.key, $event)"><option v-if="definition.type !== 'image'" value="">未设置</option><option v-for="item in field.options" :key="item.value" :value="item.value">{{ item.label }}</option></select>
      </slot>
    </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { imageMaskFields } from './imageMaskFields';
import ColorRGBAField from "./ColorRGBAField.vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import type { ControlDefinition, ControlPropertyField } from "./controlRegistry";
import type { ColorRGBA, ControlType } from "./types";

const props = withDefaults(defineProps<{ definition: ControlDefinition<ControlType>; modelValue: Record<string, unknown>; animatedFields?: string[] }>(), { animatedFields: () => [] });
const emit = defineEmits<{ (event: "update:modelValue", value: Record<string, unknown>): void }>();

function isAnimated(field: ControlPropertyField) { return Boolean(field.tweenable) && (field.kind === "number" || field.kind === "color") && props.animatedFields.includes(field.key); }
function fieldTitle(field: ControlPropertyField) { return isAnimated(field) ? [field.description, "此属性已加入动画；修改会在当前时间记帧"].filter(Boolean).join("\n") : field.description; }
const visibleFields = computed(() => props.definition.type === 'image' ? imageMaskFields(props.definition.fields, props.modelValue) : props.definition.fields);
const previousFill = ref('horizontal');
watch(() => props.modelValue.fillType, value => { if (typeof value === 'string' && value !== 'unused') previousFill.value = value; }, {immediate:true});
function booleanValue(key: string) { return key === '__fillEnabled' ? Boolean(props.modelValue.fillType && props.modelValue.fillType !== 'unused') : Boolean(props.modelValue[key]); }
function updateField(key: string, value: unknown) {
  if (key === '__fillEnabled') { key = 'fillType'; value = value ? previousFill.value : 'unused'; }
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}
function updateNumber(key: string, value: number | null) {
  const field = props.definition.fields.find(field => field.key === key);
  if (value !== null && typeof field?.min === 'number') value = Math.max(field.min, value);
  if (value !== null && typeof field?.max === 'number') value = Math.min(field.max, value);
  updateField(key, value);
}
function updateNullableBoolean(key: string, event: Event) { const raw = (event.target as HTMLSelectElement).value; updateField(key, raw === "" ? null : raw === "true"); }
function selectValue(field: ControlPropertyField) {
  const value = stringValue(props.modelValue[field.key]);
  return props.definition.type === 'image' && !field.options?.some(option => option.value === value) ? field.options?.[0]?.value ?? '' : value;
}
function updateSelect(key: string, event: Event) {
  const raw = (event.target as HTMLSelectElement).value;
  if (props.definition.type === 'image') {
    const field = visibleFields.value.find(field => field.key === key);
    if (!field?.options?.some(option => option.value === raw)) return;
  }
  updateField(key, raw === "" ? null : raw);
}
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function numberValue(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : ""; }
function nullableBooleanValue(value: unknown) { return value === true ? "true" : value === false ? "false" : ""; }
function asColor(value: unknown) { const color = value as Partial<ColorRGBA> | null; return color && Number.isFinite(color.r) && Number.isFinite(color.g) && Number.isFinite(color.b) ? color as ColorRGBA : { r: 255, g: 255, b: 255, a: 1 }; }
</script>

<style scoped>
.image-mask-section .kind-boolean { display: flex; justify-content: space-between; align-items: center; }
.image-mask-section .property-content { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 8px; }
.image-mask-section .control-field { grid-column: 1 / -1; min-width: 0; }
.image-mask-section .control-field[data-field=softEdgeWidthX], .image-mask-section .control-field[data-field=softEdgeWidthY] { grid-column: span 1; }
.image-mask-section .kind-boolean .field-heading { margin: 0; }
.image-mask-section .boolean-control > span { display: none; }
.mask-range { display: flex; align-items: center; gap: 8px; }
.mask-range > input { flex: 1; min-width: 0; accent-color: #547dff; }
.mask-range > :deep(.scrubbable-number-input) { width: 76px; flex: 0 0 76px; }
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
