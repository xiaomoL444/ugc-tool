<template>
  <span class="vfx-icon"><img v-if="src && !failed" :src="src" :alt="label" loading="lazy" @error="failed = true" /><span v-else aria-hidden="true">✦</span></span>
</template>
<script setup lang="ts">
import { ref, watch } from "vue";
const props = defineProps<{ src?: string | null; label: string }>();
const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });
</script>
<style scoped>
.vfx-icon { display: grid; place-items: center; flex: none; width: 48px; height: 48px; overflow: hidden; border: 1px solid #454b58; border-radius: 6px; background: #20242d; color: #9da9c5; font-size: 24px; }
.vfx-icon img { width: 100%; height: 100%; object-fit: contain; }
</style>
