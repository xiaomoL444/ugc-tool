<script setup lang="ts">
import { NTreeSelect } from "naive-ui";
import type { TreeSelectOption } from "naive-ui";

defineProps<{
  options: TreeSelectOption[];
  modelValue: number | null;
  placeholder?: string;
  disabled?: boolean;
  label: string;
}>();
const emit = defineEmits<{ (event: "update:modelValue", value: number | null): void }>();

function update(value: unknown) {
  if (value === null || typeof value === "number") emit("update:modelValue", value);
}
function filter(pattern: string, option: TreeSelectOption) {
  return String(option.searchText ?? option.label ?? "").toLocaleLowerCase().includes(pattern.trim().toLocaleLowerCase());
}
function clickBehavior({ option }: { option: TreeSelectOption }): "toggleSelect" | "toggleExpand" {
  return typeof option.key === "number" ? "toggleSelect" : "toggleExpand";
}
</script>

<template>
  <NTreeSelect
    class="quest-reference-select"
    :value="modelValue" :options="options" :disabled="disabled"
    :aria-label="label" :placeholder="placeholder ?? '选择任务或搜索任务名 / ID'"
    filterable clearable show-path show-line default-expand-all virtual-scroll
    :filter="filter" :override-default-node-click-behavior="clickBehavior"
    @update:value="update"
  >
    <template #empty>没有匹配的任务</template>
  </NTreeSelect>
</template>

<style scoped>
.quest-reference-select { flex: 1; min-width: 180px; text-align: left; }
</style>
