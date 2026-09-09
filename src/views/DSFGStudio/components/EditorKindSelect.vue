<script setup lang="ts">
const props = defineProps<{ modelValue: "Dialogue" | "Quest" }>();
const emit = defineEmits<{ "update:modelValue": [value: "Dialogue" | "Quest"] }>();
function change(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "Dialogue" || value === "Quest") emit("update:modelValue", value);
  // 切换可能需要等待保存；以父组件确认后的状态为准。
  (event.target as HTMLSelectElement).value = props.modelValue;
}
</script>

<template>
  <label class="editor-kind-select">
    <span>编辑内容</span>
    <select aria-label="编辑内容" :value="modelValue" @change="change">
      <option value="Dialogue">对话</option>
      <option value="Quest">任务</option>
    </select>
  </label>
</template>

<style scoped>
.editor-kind-select { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; padding: 10px; color: #58677e; font-size: 12px; background: #edf2f9; border-bottom: 1px solid #d3dce9; }
.editor-kind-select span { flex-shrink: 0; }
.editor-kind-select select { flex: 1; min-width: 0; padding: 6px 8px; border: 1px solid #b8c9de; border-radius: 6px; color: #31557d; background: #fff; }
</style>
