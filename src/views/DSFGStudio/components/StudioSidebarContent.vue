<script setup lang="ts">
import { inject } from "vue";
import { studioSidebarKey } from "./studioSidebar";
const target = inject(studioSidebarKey, undefined);
</script>

<template>
  <Teleport :to="target || 'body'" :disabled="!target"><slot /></Teleport>
</template>
