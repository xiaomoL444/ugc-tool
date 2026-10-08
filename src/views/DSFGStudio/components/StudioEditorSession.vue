<script setup lang="ts">
import { provide, ref, type Component } from "vue";
import { studioEditorActiveKey } from "./studioSessionHistory";
import type { StudioEditorKind } from "./studioSidebar";

const props = defineProps<{ active: boolean; editor: Component; kind: StudioEditorKind }>();
const emit = defineEmits<{ "update:editorKind": [kind: StudioEditorKind] }>();
const editorRef = ref<{ prepareToLeave: () => Promise<void> }>();
provide(studioEditorActiveKey, () => props.active);
defineExpose({ prepareToLeave: () => editorRef.value?.prepareToLeave() ?? Promise.resolve() });
</script>

<template>
  <div v-show="active" class="studio-editor-session" :inert="!active">
    <component :is="editor" ref="editorRef" :editor-kind="kind" @update:editor-kind="emit('update:editorKind', $event)" />
  </div>
</template>

<style scoped>
.studio-editor-session { height: 100%; min-height: 0; }
</style>
