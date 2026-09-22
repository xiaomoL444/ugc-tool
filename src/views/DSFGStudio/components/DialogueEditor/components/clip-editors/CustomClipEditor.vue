<script setup lang="ts">
import { computed } from "vue";
import type { PerformanceClip } from "../../types/DialogueNode";
import { createClipComponent } from "../../config/clipComponentRegistry";
const props = defineProps<{ clip: PerformanceClip }>();
const triggerValue = computed({
  get: () => {
    const value = props.clip.components.find(component => component.templateId === "custom.data")?.properties.value;
    return typeof value === "string" ? value : "";
  },
  set: (value: string) => {
    let config = props.clip.components.find(component => component.templateId === "custom.data");
    if (!config) { config = createClipComponent("custom.data"); props.clip.components.push(config); }
    config.enabled = true;
    config.properties.value = value.replace(/[\r\n]/g, "");
  },
});
</script>
<template>
  <label class="custom-trigger-field">自定义触发字符串
    <input v-model="triggerValue" type="text" aria-label="自定义触发字符串" placeholder="输入触发参数" />
  </label>
</template>
<style scoped>
.custom-trigger-field { display: flex; flex-direction: column; gap: 6px; color: var(--timeline-muted, #98a8bc); font-size: 12px; }
input { box-sizing: border-box; width: 100%; padding: 7px; color: var(--timeline-text, #edf4ff); background: var(--timeline-field, #141922); border: 1px solid var(--timeline-border, #3b485b); border-radius: 5px; }
</style>
