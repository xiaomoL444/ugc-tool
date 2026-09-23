<script setup lang="ts">
import { createConditionComparison, createConditionGroup, type VisualCondition, type ComparisonOperator } from "../types/VisualCondition";
import ConditionValueEditor from "./ConditionValueEditor.vue";
const props = withDefaults(defineProps<{ modelValue: VisualCondition; depth?: number }>(), { depth: 0 });
const emit = defineEmits<{ "update:modelValue": [value: VisualCondition] }>();
const comparisons: { value: ComparisonOperator; label: string }[] = [
  { value: "==", label: "等于 =" }, { value: "!=", label: "不等于 ≠" },
  { value: ">=", label: "大于等于 ≥" }, { value: ">", label: "大于 >" },
  { value: "<=", label: "小于等于 ≤" }, { value: "<", label: "小于 <" },
];
function updateChild(index: number, value: VisualCondition) {
  if (props.modelValue.kind !== "group") return;
  emit("update:modelValue", { ...props.modelValue, children: props.modelValue.children.map((child, i) => i === index ? value : child) });
}
function add(group: boolean) {
  if (props.modelValue.kind !== "group") return;
  emit("update:modelValue", { ...props.modelValue, children: [...props.modelValue.children, group ? createConditionGroup() : createConditionComparison()] });
}
function remove(index: number) {
  if (props.modelValue.kind !== "group") return;
  emit("update:modelValue", { ...props.modelValue, children: props.modelValue.children.filter((_, i) => i !== index) });
}
</script>
<template>
  <div v-if="modelValue.kind === 'group'" class="condition-group">
    <header><strong>{{ depth ? '（ 条件组 ）' : '条件组合' }}</strong>
      <select :value="modelValue.operator" aria-label="条件组连接方式" @change="emit('update:modelValue', { ...modelValue, operator: ($event.target as HTMLSelectElement).value as 'and' | 'or' })">
        <option value="and">且：全部满足</option><option value="or">或：任一满足</option>
      </select>
    </header>
    <div v-for="(child, index) in modelValue.children" :key="child.id" class="condition-child">
      <span v-if="index" class="connector">{{ modelValue.operator === 'and' ? '且 AND' : '或 OR' }}</span>
      <div class="child-row"><ConditionTreeEditor :model-value="child" :depth="depth + 1" @update:model-value="updateChild(index, $event)" />
        <button type="button" class="remove" :aria-label="`删除第 ${index + 1} ${child.kind === 'group' ? '个条件组' : '条条件'}`" @click="remove(index)">删除</button>
      </div>
    </div>
    <p v-if="!modelValue.children.length" class="empty">此组还没有条件，请添加。</p>
    <footer><button type="button" @click="add(false)">＋ 添加条件</button><button v-if="depth < 8" type="button" @click="add(true)">＋ 添加括号组</button></footer>
  </div>
  <div v-else class="condition-comparison">
    <ConditionValueEditor :model-value="modelValue.left" label="左值" @update:model-value="emit('update:modelValue', { ...modelValue, left: $event })" />
    <label class="comparison-label">比较关系<select :value="modelValue.operator" aria-label="比较关系" @change="emit('update:modelValue', { ...modelValue, operator: ($event.target as HTMLSelectElement).value as ComparisonOperator })">
      <option v-for="operator in comparisons" :key="operator.value" :value="operator.value">{{ operator.label }}</option>
    </select></label>
    <ConditionValueEditor :model-value="modelValue.right" label="右值" @update:model-value="emit('update:modelValue', { ...modelValue, right: $event })" />
  </div>
</template>
<style scoped>
.condition-group { min-width: 0; padding: 14px; border: 1px solid #d9c9ea; border-left: 3px solid #aa83cb; border-radius: 9px; background: #fcfaff; }
header, footer { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
header { margin-bottom: 12px; } header strong { font-size: 12px; color: #70528f; }
select, button { padding: 7px 9px; font: inherit; border: 1px solid #d7cde3; border-radius: 5px; background: #fff; color: #604a79; }
button { cursor: pointer; } footer { margin-top: 12px; }
.child-row { display: flex; align-items: flex-start; gap: 8px; } .child-row > :first-child { flex: 1; min-width: 0; }
.remove { margin-top: 13px; border: 0; color: #a66c7a; background: transparent; }
.connector { display: block; margin: 9px 0; color: #8a6aa9; font-size: 11px; }
.condition-comparison { display: grid; grid-template-columns: minmax(0, 1fr) 125px minmax(0, 1fr); gap: 8px; }
.comparison-label { display: grid; align-content: end; gap: 7px; padding-bottom: 10px; color: #778299; font-size: 11px; }
.comparison-label select { width: 100%; color: #34435b; } .empty { color: #9a738b; }
@media (max-width: 900px) { .condition-comparison { grid-template-columns: 1fr; } .comparison-label { padding: 0; } }
</style>
