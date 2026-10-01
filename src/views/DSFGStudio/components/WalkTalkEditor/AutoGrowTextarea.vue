<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
const textarea = ref<HTMLTextAreaElement>();
let observer: ResizeObserver | undefined;
let width = -1;
function resize() {
  const element = textarea.value;
  if (!element || !element.clientWidth) return;
  element.style.height = "auto";
  const borders = element.offsetHeight - element.clientHeight;
  element.style.height = `${element.scrollHeight + borders}px`;
}
function input(event: Event) {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
  resize();
}
watch(() => props.modelValue, () => nextTick(resize));
onMounted(() => {
  resize();
  observer = new ResizeObserver(entries => {
    const nextWidth = entries[0]?.contentRect.width;
    if (nextWidth !== undefined && nextWidth !== width) {
      width = nextWidth;
      resize();
    }
  });
  if (textarea.value) observer.observe(textarea.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <textarea ref="textarea" :value="modelValue" rows="1" @input="input" />
</template>

<style scoped>
textarea { display: block; resize: none; overflow: hidden; overflow-wrap: anywhere; }
</style>
