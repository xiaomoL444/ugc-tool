<script setup lang="ts">
import type { PerformanceClip } from "../../types/DialogueNode";
import ClipComponentsEditor from "./ClipComponentsEditor.vue";

defineProps<{ clip: PerformanceClip }>();
</script>

<template>
  <div class="performance-editor">
    <label>Clip 名称<input v-model="clip.name" /></label>
    <p v-if="clip.type === 'Camera'" class="camera-timing-hint">
      V2.0 运镜：开始时间由 Timeline 调度，持续时间同步导出到 CameraClip.duration。
    </p>
    <ClipComponentsEditor :clip="clip" />
  </div>
</template>

<style scoped>
.performance-editor > label { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; color: #98a8bc; font-size: 11px; }
input { box-sizing: border-box; width: 100%; padding: 7px; color: #edf4ff; background: #141922; border: 1px solid #3b485b; border-radius: 5px; }
.camera-timing-hint { margin: 8px 0; color: #91a6bf; font-size: 10px; line-height: 1.6; }
</style>
