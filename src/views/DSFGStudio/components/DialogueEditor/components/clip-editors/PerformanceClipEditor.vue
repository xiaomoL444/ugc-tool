<script setup lang="ts">
import type { PerformanceClip } from "../../types/DialogueNode";
import ClipComponentsEditor from "./ClipComponentsEditor.vue";
import CameraClipEditor from "./CameraClipEditor.vue";

defineProps<{ clip: PerformanceClip }>();
</script>

<template>
  <CameraClipEditor v-if="clip.type === 'Camera'" :clip="clip" />
  <div v-else class="performance-editor">
    <label>Clip 名称<input v-model="clip.name" /></label>
    <ClipComponentsEditor :clip="clip" />
  </div>
</template>

<style scoped>
.performance-editor > label { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; color: #98a8bc; font-size: 11px; }
input { box-sizing: border-box; width: 100%; padding: 7px; color: #edf4ff; background: #141922; border: 1px solid #3b485b; border-radius: 5px; }
</style>
