<template>
  <svg
    class="editor-icon"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(path, index) in paths" :key="index" :d="path" />
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })

const icons: Record<string, string[]> = {
  back: ['M14 6l-6 6 6 6', 'M8 12h12'],
  search: ['M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z', 'm15 15 5.5 5.5'],
  plus: ['M12 5v14M5 12h14'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  'eye-off': ['M3 3l18 18', 'M9.5 5.3A12 12 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 4', 'M6.3 6.3A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.7-1.7', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  container: ['M7 3H3v4M17 3h4v4M21 17v4h-4M7 21H3v-4', 'M7 4h10M20 7v10M17 20H7M4 17V7'],
  image: ['M4 4h16v16H4Z', 'm4 16 5-5 4 4 3-3 4 4', 'M16 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z'],
  text: ['M4 4h16v16H4Z', 'M8 8h8M12 8v9M10 17h4'],
  grid: ['M4 4h16v16H4Z', 'M9 4v16M15 4v16M4 9h16M4 15h16'],
  play: ['m8 4 12 8-12 8Z'],
  pause: ['M7 5h3v14H7ZM14 5h3v14h-3Z'],
  'skip-back': ['M5 5v14', 'm18 5-10 7 10 7Z'],
  'skip-forward': ['M19 5v14', 'm6 5 10 7-10 7Z'],
  monitor: ['M3 4h18v12H3Z', 'M12 16v4M8 20h8'],
  phone: ['M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5Z', 'M10 5h4M11 18.5h2'],
  gamepad: ['M7 7h10c2 0 3 1.5 3.5 3.5l1 6c.4 2.4-2 3.4-3.5 1.5l-2-2H8l-2 2c-1.5 1.9-3.9.9-3.5-1.5l1-6C4 8.5 5 7 7 7Z', 'M7 10v4M5 12h4M16 11h.01M18 13h.01'],
  fit: ['M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5', 'M8 8h8v8H8Z'],
  save: ['M4 3h13l3 3v15H4Z', 'M8 3v6h8V3M8 21v-8h8v8'],
  folder: ['M3 8V5h6l2 3h10v12H3Z', 'M3 11h18'],
  import: ['M12 3v11m-4-4 4 4 4-4', 'M4 14v6h16v-6'],
  code: ['m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18'],
  sliders: ['M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10', 'M11 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM17 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM11 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z'],
  'chevron-down': ['m6 9 6 6 6-6'],
  trash: ['M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
  timeline: ['M3 4v17h18M7 7h14M7 12h14M7 17h14', 'm10 5 2 2-2 2-2-2Zm7 5 2 2-2 2-2-2Zm-5 5 2 2-2 2-2-2Z'],
  magnet: ['M4 3h5v10a3 3 0 0 0 6 0V3h5v10a8 8 0 0 1-16 0Z', 'M4 7h5M15 7h5'],
  scene: ['m12 3 9 5-9 5-9-5Z', 'm3 12 9 5 9-5M3 16l9 5 9-5'],
}

const paths = computed(() => icons[props.name] ?? icons.container)
</script>

<style scoped>
.editor-icon {
  display: inline-block;
  flex: 0 0 auto;
  vertical-align: middle;
}
</style>
