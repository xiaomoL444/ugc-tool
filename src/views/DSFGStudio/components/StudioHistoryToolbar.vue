<script setup lang="ts">
import { inject, type Ref } from "vue";
import StudioIcon from "./StudioIcon.vue";
import { studioSessionHistoryKey } from "./studioSessionHistory";

defineProps<{
  history?: { canUndo: Ref<boolean>; canRedo: Ref<boolean>; undo: () => Promise<void>; redo: () => Promise<void> };
  disabled?: boolean;
  sessionToolbar?: boolean;
  compact?: boolean;
  local?: boolean;
}>();
const session = inject(studioSessionHistoryKey, undefined);
</script>

<template>
  <div v-if="sessionToolbar || local || !session" class="studio-history-tools" :class="{ compact }" data-studio-history-tools role="group" aria-label="编辑历史">
    <button type="button" aria-label="撤销" title="撤销 · Ctrl+Z" :disabled="disabled || !history?.canUndo.value" @pointerdown.prevent @click="history?.undo()"><StudioIcon v-if="compact" name="undo" :size="17" /><span v-else>撤销</span></button>
    <button type="button" aria-label="重做" title="重做 · Ctrl+Shift+Z / Ctrl+Y" :disabled="disabled || !history?.canRedo.value" @pointerdown.prevent @click="history?.redo()"><StudioIcon v-if="compact" name="redo" :size="17" /><span v-else>重做</span></button>
  </div>
</template>

<style scoped>
.studio-history-tools { display: flex; flex: 0 0 auto; gap: 6px; }
button { padding: 7px 12px; border: 1px solid #ced3f3; border-radius: 7px; background: #fff; color: #6554c9; font: inherit; font-size: 12px; cursor: pointer; }
button:hover:not(:disabled) { background: #f0edff; border-color: #aa9ee8; }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible { outline: 2px solid #887bd7; outline-offset: 2px; }
.compact { gap: 4px; }
.compact button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-color: transparent; background: transparent; color: #68799a; }
.compact button:hover:not(:disabled) { border-color: #d4d8f4; background: #f0edff; color: #6554c9; }
</style>
