<script setup lang="ts">
import { studioSelectTheme } from "../../../studioSelectTheme";
import "../../../../studioSelect.css";
import { computed, watchEffect, type HTMLAttributes } from "vue";
import type { PerformanceClip } from "../../types/DialogueNode";
import { NSelect } from "naive-ui";
import TypedValueInput from "../../../TypedValueInput.vue";
import { usePublicEventPresets } from "../../../EntityPresetEditor/usePublicEventPresets";
import { getPublicEventArguments, applyPublicEventPreset, isPublicEventArgumentVisible, getPublicEventArgumentReference, syncPublicEventVisibility } from "../../utils/publicEventParameters";
import { PUBLIC_EVENT_PARAM_TYPES, publicEventPresetLabel } from "../../../EntityPresetEditor/publicEventPresets";
import { usePresetReferences } from "../../../EntityPresetEditor/presetReferences";
const references = usePresetReferences();
const props = defineProps<{ clip: PerformanceClip }>();
// Naive UI teleports menus to body; keep them inside the Timeline's outside-click boundary.
const clipMenuProps: HTMLAttributes & { "data-clip-editor": string } = { "data-clip-editor": "", class: "studio-select-menu" };
const { availablePresets: presets, ready, error, retry } = usePublicEventPresets();
watchEffect(() => {
  if (ready.value) syncPublicEventVisibility(props.clip, presets.value);
}, { flush: "sync" });
const presetOptions = computed(() => presets.value.filter(preset => preset.name.trim())
  .map(preset => ({ label: publicEventPresetLabel(preset), value: preset.id })));
const selectedPreset = computed(() => {
  const id = props.clip.components.find(item => item.templateId === "public.event")?.properties.presetId;
  return typeof id === "string" && presets.value.some(preset => preset.id === id) ? id : null;
});
const parameters = computed(() => getPublicEventArguments(props.clip));
const visibleParameters = computed(() => parameters.value.filter(param => isPublicEventArgumentVisible(param, parameters.value))
  .map(parameter => ({ parameter, reference: getPublicEventArgumentReference(props.clip, parameter) })));
function applyPreset(id: string) {
  const preset = presets.value.find(item => item.id === id);
  if (preset) applyPublicEventPreset(props.clip, preset);
}
const savedEventName = computed(() => {
  const value = props.clip.components.find(component => component.templateId === "public.event")?.properties.value;
  return typeof value === "string" ? value : "";
});
</script>
<template>
  <div class="public-preset-field">
    <span>公共事件预设</span>
    <NSelect :theme-overrides="studioSelectTheme" :value="selectedPreset" :options="presetOptions" :disabled="!ready" filterable
      :menu-props="clipMenuProps"
      placeholder="搜索代号或事件名" aria-label="公共事件预设" @update:value="applyPreset" />
    <small v-if="error" role="alert">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></small>
    <small v-else-if="ready && !presetOptions.length">可在「预设设置 → 预设公共事件」中添加事件和参数。</small>
    <small v-if="!selectedPreset && savedEventName">已保存事件：{{ savedEventName }}。选择预设后替换。</small>
  </div>
  <label v-for="{ parameter: param, reference } in visibleParameters" :key="param.id" class="public-event-field">
    {{ param.name }} · {{ PUBLIC_EVENT_PARAM_TYPES.find(type => type.value === param.type)?.label }}
    <NSelect :theme-overrides="studioSelectTheme" v-if="reference" :value="param.value" :options="references.options(reference, param.type)" filterable
      :menu-props="clipMenuProps"
      :disabled="!references.readyFor(reference)" :aria-label="param.name + '预设值'" placeholder="选择配置记录" @update:value="param.value = $event" />
    <small v-if="reference && references.errorFor(reference)" role="alert">{{ references.errorFor(reference) }} <button type="button" @click="references.retryFor(reference).catch(() => undefined)">重新加载引用</button></small>
    <small v-if="reference">当前值：{{ param.value || '（空）' }}。选择会复制值；后续修改预设不会改变此动作。</small>
    <small v-if="reference && references.readyFor(reference) && !references.options(reference, param.type).length">引用暂无可用记录，请在预设设置中补充或修正值来源。</small>
    <TypedValueInput v-if="!reference || reference === 'entities.guid' || reference === 'entities.entityQuery'" v-model="param.value" :value-type="param.type" :aria-label="param.name" />
  </label>
</template>
<style scoped>
.public-preset-field { display: grid; gap: 6px; margin-bottom: 14px; color: var(--timeline-muted, #98a8bc); font-size: 12px; }
.public-event-field { margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px; color: var(--timeline-muted, #98a8bc); font-size: 12px; }
input { box-sizing: border-box; width: 100%; padding: 7px; color: var(--timeline-text, #edf4ff); background: var(--timeline-field, #141922); border: 1px solid var(--timeline-border, #3b485b); border-radius: 5px; }
</style>
