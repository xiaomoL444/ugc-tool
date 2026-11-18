<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import type { WorkspaceEntry } from "./workspaceArchive";
import { readWorkspaceZip } from "./workspaceZip";
import StudioIcon from "./StudioIcon.vue";

defineProps<{ disabled: boolean }>();
const emit = defineEmits<{ change: [entries?: WorkspaceEntry[]] }>();
const message = ref(""), error = ref("");
const backupInput = ref<HTMLInputElement>();
let selection = 0;
onBeforeUnmount(() => { selection++; });

async function selectBackup(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const current = ++selection;
  emit("change");
  error.value = "";
  message.value = "正在读取工作区…";
  try {
    const entries = await readWorkspaceZip(file);
    if (current !== selection) return;
    emit("change", entries);
    message.value = `已选择「${file.name}」`;
  } catch (reason) {
    if (current !== selection) return;
    message.value = "";
    error.value = reason instanceof Error ? reason.message : "无法读取工作区备份。";
  }
}
</script>

<template>
  <div class="archive-import">
    <button type="button" :disabled="disabled" @click="backupInput?.click()"><StudioIcon name="file" :size="16" />选择 ZIP 备份</button>
    <input ref="backupInput" type="file" accept=".zip" hidden aria-label="工作区备份文件" @change="selectBackup" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-else-if="message" role="status">{{ message }}</p>
  </div>
</template>

<style scoped>
.archive-import { display: grid; gap: 8px; }
button { justify-self: start; display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 6px 12px; border: 1px solid #ced3f3; border-radius: 7px; background: white; color: #345f91; font: inherit; cursor: pointer; }
button:focus-visible { outline: 2px solid #2877c7; outline-offset: 2px; }
button:disabled { opacity: .5; cursor: default; }
p { margin: 0; color: #526588; font-size: 12px; overflow-wrap: anywhere; }
.error { color: #a43d42; }
</style>
