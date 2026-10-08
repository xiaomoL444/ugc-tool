<script setup lang="ts">
import StudioSelect from "../../StudioSelect.vue";
import type { DialogueStyleDefinition } from "../types/DialogueNode";

defineProps<{ modelValue: string; options: DialogueStyleDefinition[] }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <StudioSelect class="dialogue-style-select" :model-value="modelValue" :options="options" label="对话样式" compact show-id
    @update:model-value="emit('update:modelValue', $event)" />
</template>
