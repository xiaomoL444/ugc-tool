<script setup lang="ts">
import type { PerformanceClip } from "../../types/DialogueNode";
import ClipComponentsEditor from "./ClipComponentsEditor.vue";
import PublicEventClipEditor from "./PublicEventClipEditor.vue";
import CustomClipEditor from "./CustomClipEditor.vue";
import CameraClipEditor from "./CameraClipEditor.vue";

defineProps<{ clip: PerformanceClip }>();
</script>

<template>
  <CameraClipEditor v-if="clip.type === 'Camera'" :clip="clip" />
  <CustomClipEditor v-else-if="clip.type === 'Custom'" :clip="clip" />
  <PublicEventClipEditor v-else-if="clip.type === 'PublicEvent'" :clip="clip" />
  <div v-else class="performance-editor">
    <label>Clip 名称<input v-model="clip.name" /></label>
    <ClipComponentsEditor :clip="clip" />
  </div>
</template>

<style scoped>
.performance-editor > label { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; color: var(--timeline-muted, #98a8bc); font-size: 11px; }
input { box-sizing: border-box; width: 100%; padding: 7px; color: var(--timeline-text, #edf4ff); background: var(--timeline-field, #141922); border: 1px solid var(--timeline-border, #3b485b); border-radius: 5px; }
</style>
