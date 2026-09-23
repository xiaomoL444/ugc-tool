<script setup lang="ts">
import { ref } from "vue";
import { toast } from "vue-sonner";
const props = defineProps<{ disabled?: boolean; importFile: (file: File) => Promise<void> }>();
const input = ref<HTMLInputElement>();
const pending = ref(false);
async function change(event: Event) {
  const element = event.target as HTMLInputElement;
  const file = element.files?.[0]; element.value = "";
  if (!file || pending.value || props.disabled) return;
  pending.value = true;
  try { await props.importFile(file); }
  catch (error) { toast.error(error instanceof Error ? error.message : "导入失败，原配置未替换"); }
  finally { pending.value = false; }
}
</script>
<template>
  <span class="runtime-import"><input ref="input" type="file" accept=".json,application/json" aria-label="选择千星运行时配置" hidden @change="change" /><button type="button" :disabled="disabled || pending" title="导入千星编辑器导出的运行时 JSON" @click="input?.click()">{{ pending ? '导入中…' : '导入配置' }}</button></span>
</template>
<style scoped>
.runtime-import { display: inline-flex; flex-shrink: 0; }
button { padding: 7px 11px; border: 1px solid #bfd0e5; border-radius: 6px; color: #315f98; background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
</style>
