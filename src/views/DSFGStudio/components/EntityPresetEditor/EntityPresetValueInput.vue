<script setup lang="ts">
import { computed, type HTMLAttributes } from "vue";
import { NSelect } from "naive-ui";
import { studioSelectTheme } from "../studioSelectTheme";
import TypedValueInput from "../TypedValueInput.vue";
import "../../studioSelect.css";
import { useEntityPresets } from "./useEntityPresets";
import { getEntityPresetValueOptions } from "./entityPresets";

const props = defineProps<{ field: "guid" | "entityQuery"; label: string; modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const { availablePresets, ready, error, retry } = useEntityPresets();
const options = computed(() => getEntityPresetValueOptions(availablePresets.value, props.field));
const selected = computed(() => options.value.some(item => item.value === props.modelValue) ? props.modelValue : null);
const menuProps: HTMLAttributes & { "data-clip-editor": string } = { "data-clip-editor": "", class: "studio-select-menu" };
</script>

<template>
  <span class="entity-value-input">
    <NSelect :theme-overrides="studioSelectTheme" :value="selected" :options="options" :disabled="!ready" filterable
      :menu-props="menuProps" :aria-label="label + '实体预设'" placeholder="搜索实体预设"
      @update:value="emit('update:modelValue', $event)" />
    <TypedValueInput :model-value="modelValue" :value-type="field === 'guid' ? 'Guid' : 'String'" :aria-label="label"
      placeholder="也可手动填写" @update:model-value="emit('update:modelValue', $event)" />
    <small v-if="error" role="alert">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></small>
    <small v-else-if="ready && !options.length">暂无可用值，请在实体预设中填写{{ field === 'guid' ? 'guid' : '实体查询' }}。</small>
  </span>
</template>

<style scoped>
.entity-value-input { display: grid; gap: 6px; min-width: 0; }
input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--timeline-border, #3b485b); border-radius: 6px; background: var(--timeline-field, #141922); color: var(--timeline-text, #edf4ff); font: inherit; }
input:focus-visible { outline: 1px solid var(--timeline-accent, #628bc1); }
small { font-size: 10px; line-height: 1.6; color: var(--timeline-muted, #98a8bc); }
button { font: inherit; color: var(--timeline-accent, #93b9ea); background: transparent; border: 0; cursor: pointer; }
</style>
