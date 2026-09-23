<script setup lang="ts">
import type { ConditionValue, ConditionValueSource } from "../types/VisualCondition";
defineProps<{ modelValue: ConditionValue; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: ConditionValue] }>();
const sources: { value: ConditionValueSource; label: string }[] = [
  { value: "player", label: "玩家自身变量" }, { value: "character", label: "当前角色变量" },
  { value: "level", label: "关卡变量" }, { value: "number", label: "固定数字" },
  { value: "text", label: "固定文本" }, { value: "boolean", label: "固定布尔值" },
];
function changeSource(event: Event) {
  const source = (event.target as HTMLSelectElement).value as ConditionValueSource;
  emit("update:modelValue", { source, value: source === "number" ? "0" : source === "boolean" ? "true" : "" });
}
</script>
<template>
  <fieldset class="condition-value">
    <legend>{{ label }}</legend>
    <select :value="modelValue.source" :aria-label="`${label}来源`" @change="changeSource">
      <option v-for="source in sources" :key="source.value" :value="source.value">{{ source.label }}</option>
    </select>
    <select v-if="modelValue.source === 'boolean'" :value="modelValue.value" :aria-label="`${label}布尔值`" @change="emit('update:modelValue', { ...modelValue, value: ($event.target as HTMLSelectElement).value })">
      <option value="true">真</option><option value="false">假</option>
    </select>
    <input v-else :value="modelValue.value" :aria-label="`${label}${['player', 'character', 'level'].includes(modelValue.source) ? '变量名' : '固定值'}`"
      :placeholder="['player', 'character', 'level'].includes(modelValue.source) ? '填写变量名' : '填写固定值'"
      :inputmode="modelValue.source === 'number' ? 'decimal' : 'text'"
      @input="emit('update:modelValue', { ...modelValue, value: ($event.target as HTMLInputElement).value })" />
  </fieldset>
</template>
<style scoped>
.condition-value { display: grid; grid-template-columns: minmax(100px, .85fr) minmax(90px, 1fr); gap: 7px; min-width: 0; margin: 0; padding: 10px; border: 1px solid #dce2ee; border-radius: 8px; }
legend { color: #778299; font-size: 11px; padding: 0 4px; }
select, input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px; border: 1px solid #d8dfeb; border-radius: 5px; background: #fff; color: #34435b; font: inherit; }
@media (max-width: 650px) { .condition-value { grid-template-columns: 1fr; } }
</style>
