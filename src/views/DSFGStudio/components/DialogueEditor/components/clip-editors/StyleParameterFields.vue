<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue";
import { NSelect } from "naive-ui";
import TypedValueInput from "../../../TypedValueInput.vue";
import { studioSelectTheme } from "../../../studioSelectTheme";
import { getTypedValueError } from "../../../typedValueInput";
import { usePresetReferences, compatibleReference } from "../../../EntityPresetEditor/presetReferences";
import type { StyleParameter } from "../../../EntityPresetEditor/styleParameters";
import "../../../../studioSelect.css";

const props = withDefaults(defineProps<{
  modelValue: string[];
  parameters?: StyleParameter[];
  label?: string;
  presetLabel?: string;
}>(), { label: "参数", presetLabel: "对应类型" });
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const references = usePresetReferences();
// Keep teleported menus within the Timeline's outside-click boundary.
const clipMenuProps: HTMLAttributes & { "data-clip-editor": string } = { "data-clip-editor": "", class: "studio-select-menu" };

const fields = computed(() => Array.from({ length: Math.max(props.modelValue.length, props.parameters?.length ?? 0) }, (_, index) => {
  const parameter = props.parameters?.[index];
  const reference = parameter?.reference;
  const source = reference ? references.sources.value.find(item => item.value === reference && compatibleReference(item, "Int32")) : undefined;
  const value = props.modelValue[index] ?? parameter?.defaultValue ?? "0";
  const availableOptions = reference ? references.options(reference, "Int32").filter(option => option.value !== "" && !getTypedValueError("Int32", option.value)) : [];
  const options = reference && !availableOptions.some(option => option.value === value)
    ? [{ label: `${value || "（空）"}（当前值）`, value, disabled: true }, ...availableOptions]
    : availableOptions;
  return { index, key: parameter?.id ?? `parameter-${index}`, name: parameter?.name || `参数 ${index + 1}`, reference, source, value, options, availableOptions };
}));

function updateValue(index: number, value: string) {
  const next = fields.value.map(field => field.value);
  next[index] = value;
  emit("update:modelValue", next);
}
</script>

<template>
  <section class="style-parameters" :aria-label="label">
    <div class="params-heading"><span>参数 <small>{{ fields.length }}/100</small></span><span class="param-type">整数</span></div>
    <label v-for="field in fields" :key="field.key" class="parameter-field">
      <span>{{ field.name }}</span>
      <NSelect v-if="field.reference" :theme-overrides="studioSelectTheme" :value="field.value" :options="field.options" filterable
        :menu-props="clipMenuProps" :disabled="!references.readyFor(field.reference)" :aria-label="`${label} ${field.name}预设值`"
        placeholder="选择配置记录" @update:value="updateValue(field.index, $event)" />
      <TypedValueInput v-else class="parameter-input" :model-value="field.value" value-type="Int32" :aria-label="`${label} ${field.name}`"
        @update:model-value="updateValue(field.index, $event)" />
      <small v-if="field.reference && references.errorFor(field.reference)" class="param-error" role="alert">
        {{ references.errorFor(field.reference) }}
        <button type="button" @click="references.retryFor(field.reference).catch(() => undefined)">重新加载引用</button>
      </small>
      <small v-else-if="field.reference && references.readyFor(field.reference) && !field.source" class="param-error" role="alert">
        值来源已失效或不支持整数；当前值已保留。请在预设设置中修正值来源，再应用预设参数。
        <button type="button" @click="references.retryFor(field.reference).catch(() => undefined)">重新加载引用</button>
      </small>
      <small v-else-if="field.reference && references.readyFor(field.reference) && !field.availableOptions.length">
        值来源暂无有效整数记录，请在预设设置中补充。
      </small>
      <small v-if="field.reference">{{ field.source?.label || '预设值来源' }} · 当前值：{{ field.value || '（空）' }}。选择记录后复制整数值。</small>
    </label>
    <small v-if="!fields.length">去「预设设置 → {{ presetLabel }}」中配置参数。</small>
    <small v-else>参数名称和顺序由类型预设配置；节点按顺序传入整数。</small>
  </section>
</template>

<style scoped>
.style-parameters { margin-top: 18px; color: var(--timeline-muted, #98a8bc); font-size: 11px; }
.params-heading { display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 8px; }
.params-heading small { display: inline; margin-left: 5px; font-variant-numeric: tabular-nums; }
.param-type { color: var(--timeline-subtle, #738298); font-size: 10px; }
.parameter-field { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.parameter-field :deep(.parameter-input) { box-sizing: border-box; width: 100%; padding: 7px; color: var(--timeline-text, #edf4ff); background: var(--timeline-field, #141922); border: 1px solid var(--timeline-border, #3b485b); border-radius: 5px; font: inherit; }
.parameter-field :deep(.parameter-input:focus-visible) { outline: 2px solid var(--timeline-accent, #628bc1); outline-offset: 1px; }
.style-parameters small { display: block; margin-top: 5px; color: var(--timeline-subtle, #738298); font-size: 10px; line-height: 1.45; }
.style-parameters .params-heading small { display: inline; margin-top: 0; }
.style-parameters .param-error { color: #dc5964; }
button { padding: 0 3px; color: var(--timeline-accent, #628bc1); background: transparent; border: 0; cursor: pointer; font: inherit; }
button:hover { text-decoration: underline; }
</style>
