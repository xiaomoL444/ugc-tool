<script setup lang="ts">
import StudioSelectField from "./StudioSelectField.vue";
import type { StudioEditorKind } from "./studioSidebar";
const props = defineProps<{ modelValue: StudioEditorKind }>();
const emit = defineEmits<{ "update:modelValue": [value: StudioEditorKind] }>();
function change(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "Dialogue" || value === "Quest" || value === "WalkTalk" || value === "EntityPresets" || value === "Scene" || value === "Camera") emit("update:modelValue", value);
  // 切换可能需要等待保存；以父组件确认后的状态为准。
  (event.target as HTMLSelectElement).value = props.modelValue;
}
</script>

<template>
  <label class="editor-kind-select">
    <span>编辑内容</span>
    <StudioSelectField aria-label="编辑内容" :value="modelValue" @change="change">
      <option value="Dialogue">对话</option>
      <option value="Quest">任务</option>
      <option value="Camera">镜头</option>
      <option value="WalkTalk">边走边说</option>
      <option value="Scene">场景</option>
      <option value="EntityPresets">预设设置</option>
    </StudioSelectField>
  </label>
</template>

<style scoped>
.editor-kind-select { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; padding: 10px; color: #58677e; font-size: 12px; background: #edf2f9; border-bottom: 1px solid #d3dce9; }
.editor-kind-select span { flex-shrink: 0; }
.editor-kind-select .studio-select-field { flex: 1; min-width: 0; }
</style>
