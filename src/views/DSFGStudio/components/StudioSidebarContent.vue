<script setup lang="ts">
import { inject } from "vue";
import { studioSidebarKey } from "./studioSidebar";
import { studioEditorActiveKey } from "./studioSessionHistory";
const target = inject(studioSidebarKey, undefined);
const active = inject(studioEditorActiveKey, () => true);
</script>

<template>
  <Teleport :to="target || 'body'" :disabled="!target"><div v-show="active()" :inert="!active()" class="studio-sidebar-session"><slot /></div></Teleport>
</template>

<style scoped>
.studio-sidebar-session { height: 100%; min-height: 0; }
</style>
