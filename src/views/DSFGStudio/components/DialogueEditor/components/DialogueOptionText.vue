<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
// Native v-model defers commits until compositionend for Chinese input methods.
const text = computed({ get: () => props.modelValue, set: (value: string) => emit("update:modelValue", value) });
</script>
<template>
  <input v-model="text" aria-label="选项文本" placeholder="填写选项…" />
</template>
