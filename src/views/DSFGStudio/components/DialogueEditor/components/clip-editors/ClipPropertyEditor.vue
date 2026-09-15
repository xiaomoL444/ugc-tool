<script setup lang="ts">
import { computed } from "vue";
import type { ClipPropertyDefinition } from "../../types/DialogueNode";
import { createClipPropertyValues, getClipListLimits, getClipNestedProperties, isClipPropertyVisible, updateClipStructField } from "../../utils/clipProperties";

const props = defineProps<{
  property: ClipPropertyDefinition;
  modelValue: unknown;
  siblingValues?: Record<string, unknown>;
}>();
const emit = defineEmits<{ "update:modelValue": [value: unknown] }>();

const value = computed(() => props.modelValue ?? props.property.defaultValue);
const fields = computed(() => getClipNestedProperties(props.property, props.siblingValues));
const fieldTitle = computed(() =>
  [props.property.key, props.property.description].filter(Boolean).join("\n"),
);
const structValue = computed(() =>
  createClipPropertyValues(fields.value, value.value),
);
const listValue = computed<unknown[]>(() =>
  Array.isArray(value.value) ? value.value : [],
);
const listLimits = computed(() => getClipListLimits(props.property, props.siblingValues));
const maxItems = computed(() => listLimits.value.max);
const minItems = computed(() => listLimits.value.min);
const vectorParts = computed(() => {
  const parts = String(value.value ?? "0,0,0").split(",");
  return [0, 1, 2].map((index) => parts[index]?.trim() || "0");
});
const selectedOptionIndex = computed(() =>
  props.property.options?.findIndex((option) => option.value === value.value) ?? -1,
);

function readNumber(event: Event): number | undefined {
  const input = event.target as HTMLInputElement;
  if (!input.value.trim()) return undefined;
  const number = input.valueAsNumber;
  if (!Number.isFinite(number)) return undefined;
  return Math.min(props.property.max ?? Infinity, Math.max(props.property.min ?? -Infinity, number));
}

function updateNumber(event: Event) {
  const number = readNumber(event);
  if (number !== undefined) emit("update:modelValue", number);
}

function updateText(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}

function updateBoolean(event: Event) {
  emit("update:modelValue", (event.target as HTMLInputElement).checked);
}

function updateOption(event: Event) {
  const index = Number((event.target as HTMLSelectElement).value);
  const option = props.property.options?.[index];
  if (option) emit("update:modelValue", option.value);
}

function updateVector(index: number, event: Event) {
  const number = readNumber(event);
  if (number === undefined) return;
  const parts = [...vectorParts.value];
  parts[index] = String(number);
  emit("update:modelValue", parts.join(","));
}

function updateStructField(key: string, fieldValue: unknown) {
  emit("update:modelValue", updateClipStructField(fields.value, structValue.value, key, fieldValue));
}

function itemFields(item: unknown) {
  return createClipPropertyValues(fields.value, item);
}

function updateListField(index: number, key: string, fieldValue: unknown) {
  emit("update:modelValue", listValue.value.map((item, itemIndex) =>
    itemIndex === index ? { ...itemFields(item), [key]: fieldValue } : item,
  ));
}

function addItem() {
  if (listValue.value.length >= maxItems.value) return;
  emit("update:modelValue", [...listValue.value, createClipPropertyValues(fields.value)]);
}

function removeItem(index: number) {
  if (listValue.value.length <= minItems.value) return;
  emit("update:modelValue", listValue.value.filter((_, itemIndex) => itemIndex !== index));
}

function moveItem(index: number, offset: number) {
  const destination = index + offset;
  if (destination < 0 || destination >= listValue.value.length) return;
  const items = [...listValue.value];
  [items[index], items[destination]] = [items[destination], items[index]];
  emit("update:modelValue", items);
}
</script>

<template>
  <div v-if="isClipPropertyVisible(property, siblingValues ?? {})" class="clip-property">
    <details v-if="property.type === 'struct'" class="struct-field" open>
      <summary :title="fieldTitle">
        <span>{{ property.label }}</span><code>{{ property.key }}</code>
      </summary>
      <p v-if="property.description" class="field-description">{{ property.description }}</p>
      <div class="nested-fields">
        <ClipPropertyEditor
          v-for="field in fields"
          :key="field.key"
          :property="field"
          :model-value="structValue[field.key]"
          :sibling-values="structValue"
          @update:model-value="updateStructField(field.key, $event)"
        />
      </div>
    </details>

    <section v-else-if="property.type === 'struct-list'" class="list-field">
      <div class="list-heading" :title="fieldTitle">
        <span>{{ property.label }} <code>{{ property.key }}</code></span>
        <small>{{ listValue.length }}<template v-if="Number.isFinite(maxItems)"> / {{ maxItems }}</template></small>
      </div>
      <p v-if="property.description" class="field-description">{{ property.description }}</p>
      <p v-if="listValue.length > maxItems" class="field-description">当前类型最多允许 {{ maxItems }} 个条目，请移除多余点位。</p>
      <p v-if="!listValue.length" class="empty-list">暂无条目，点击下方添加。</p>
      <details v-for="(item, index) in listValue" :key="index" class="list-item" :open="index === 0">
        <summary>
          <span>条目 {{ index + 1 }} <code>[{{ index }}]</code></span>
          <span class="item-actions" @click.stop>
            <button type="button" :disabled="index === 0" :aria-label="`上移条目 ${index + 1}`" title="上移" @click.prevent="moveItem(index, -1)">↑</button>
            <button type="button" :disabled="index === listValue.length - 1" :aria-label="`下移条目 ${index + 1}`" title="下移" @click.prevent="moveItem(index, 1)">↓</button>
            <button type="button" :disabled="listValue.length <= minItems" :aria-label="`删除条目 ${index + 1}`" title="删除" @click.prevent="removeItem(index)">×</button>
          </span>
        </summary>
        <div class="nested-fields">
          <ClipPropertyEditor
            v-for="field in fields"
            :key="field.key"
            :property="field"
            :model-value="itemFields(item)[field.key]"
            :sibling-values="itemFields(item)"
            @update:model-value="updateListField(index, field.key, $event)"
          />
        </div>
      </details>
      <button type="button" class="add-item" :disabled="listValue.length >= maxItems" @click="addItem">
        {{ listValue.length >= maxItems ? '已达到条目上限' : '＋ 添加条目' }}
      </button>
    </section>

    <label v-else-if="property.type === 'boolean'" class="boolean-field" :title="fieldTitle">
      <input type="checkbox" :checked="value === true || value === 'True'" @change="updateBoolean" />
      <span>{{ property.label }} <code>{{ property.key }}</code></span>
    </label>

    <fieldset v-else-if="property.type === 'vector3'" class="vector-field">
      <legend :title="fieldTitle">{{ property.label }} <code>{{ property.key }}</code></legend>
      <div class="vector-axes">
        <label v-for="(axis, index) in ['X', 'Y', 'Z']" :key="axis">
          <span :class="`axis-${axis.toLowerCase()}`">{{ axis }}</span>
          <input
            type="number"
            :aria-label="`${property.label} ${axis}`"
            :value="vectorParts[index]"
            :min="property.min"
            :max="property.max"
            :step="property.step ?? 'any'"
            @input="updateVector(index, $event)"
          />
        </label>
      </div>
    </fieldset>

    <label v-else class="scalar-field" :title="fieldTitle">
      <span>{{ property.label }} <code>{{ property.key }}</code></span>
      <input
        v-if="property.type === 'number'"
        type="number"
        :value="value"
        :min="property.min"
        :max="property.max"
        :step="property.step ?? 'any'"
        @input="updateNumber"
      />
      <select v-else-if="property.type === 'select'" :value="selectedOptionIndex" @change="updateOption">
        <option v-if="selectedOptionIndex < 0" :value="-1" disabled>
          {{ value === '' || value == null ? '未设置，请选择' : `未识别：${String(value)}` }}
        </option>
        <option v-for="(option, index) in property.options" :key="index" :value="index">{{ option.label }}</option>
      </select>
      <textarea v-else-if="property.type === 'text'" :value="String(value ?? '')" rows="2" @input="updateText" />
      <input v-else :value="String(value ?? '')" @input="updateText" />
    </label>
  </div>
</template>

<style scoped>
.clip-property { min-width: 0; margin-top: 8px; color: #a8b7cb; font-size: 10px; }
code { color: #788ea9; font-family: inherit; font-size: 9px; overflow-wrap: anywhere; }
input:not([type="checkbox"]), textarea, select { box-sizing: border-box; width: 100%; min-width: 0; padding: 6px; color: #edf4ff; background: #141922; border: 1px solid #3b485b; border-radius: 4px; font: inherit; resize: vertical; }
input:focus, textarea:focus, select:focus { outline: 1px solid #628bc1; outline-offset: 0; }
input[type="checkbox"] { margin: 0; }
button { padding: 4px 7px; color: #b9c7da; background: #303a49; border: 1px solid #4a586c; border-radius: 4px; font: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: .4; }
.scalar-field { display: flex; flex-direction: column; gap: 4px; }
.boolean-field { display: flex; align-items: center; gap: 6px; }
.scalar-field > span, .boolean-field > span { line-height: 1.5; }
.struct-field, .list-field { border: 1px solid #39475b; border-radius: 4px; padding: 6px; background: #19212c; }
summary { cursor: pointer; color: #c9d8ed; line-height: 1.6; overflow-wrap: anywhere; }
summary > code { margin-left: 4px; }
.nested-fields { padding-left: 5px; border-left: 1px solid #39475b; }
.field-description, .empty-list { margin: 5px 0; color: #8093ad; line-height: 1.6; font-size: 9px; }
.list-heading { display: flex; align-items: center; justify-content: space-between; gap: 4px; color: #c9d8ed; }
.list-heading small { color: #8093ad; white-space: nowrap; }
.list-item { padding: 6px; margin-top: 7px; border: 1px solid #35455a; border-radius: 4px; background: #1e2836; }
.list-item > summary { min-height: 22px; }
.item-actions { float: right; display: inline-flex; gap: 3px; }
.item-actions button { padding: 1px 6px; min-height: 21px; }
.add-item { width: 100%; margin-top: 7px; background: transparent; border-style: dashed; }
.vector-field { min-width: 0; margin: 0; padding: 0; border: 0; }
.vector-field legend { padding: 0 0 4px; line-height: 1.5; }
.vector-axes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.vector-axes label { display: flex; align-items: center; min-width: 0; gap: 3px; }
.vector-axes input { padding: 6px 3px; appearance: textfield; -moz-appearance: textfield; }
.vector-axes input::-webkit-inner-spin-button, .vector-axes input::-webkit-outer-spin-button { appearance: none; margin: 0; }
.axis-x { color: #ed9a9a; }.axis-y { color: #9ddab1; }.axis-z { color: #8ebcf1; }
</style>
