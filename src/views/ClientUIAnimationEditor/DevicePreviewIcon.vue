<template>
  <svg
    class="device-preview-icon"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 28 28"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="mode === 'controllerMobile'">
      <rect x="5" y="2.5" width="18" height="10" rx="1.7" />
      <path d="M8 5h12M8 10h12" stroke-width=".85" />
      <path d="M9.5 15.5h9c1.6 0 2.6 1 3 2.8l.9 5c.3 1.8-1.3 2.5-2.5 1.2l-2.2-2.3h-7.4l-2.2 2.3c-1.2 1.3-2.8.6-2.5-1.2l.9-5c.4-1.8 1.4-2.8 3-2.8Z" />
      <path d="M10 17.5v4m-2-2h4m6-1h.1m2 2h.1" />
    </template>
    <template v-else-if="mode === 'controllerDesktop'">
      <path d="M10.5 18H3.5V3.5h21v12M7 18v5M4 23h5" />
      <path d="M15 16h7c1.3 0 2.1.8 2.5 2.3l.8 5c.2 1.5-1.2 2.1-2.2 1l-1.8-2h-5.6l-1.8 2c-1 1.1-2.4.5-2.2-1l.8-5C12.9 16.8 13.7 16 15 16Z" />
      <path d="M16 18v3m-1.5-1.5h3m3.5-1h.1m1.5 2h.1" />
    </template>
    <template v-else-if="mode === 'mobile'">
      <path d="M15 20H3.5A1.5 1.5 0 0 1 2 18.5v-13A1.5 1.5 0 0 1 3.5 4h21A1.5 1.5 0 0 1 26 5.5v11M5 10v4" />
      <path d="M21 17v-5a1.5 1.5 0 0 0-3 0v8l-1.1-1.2a1.4 1.4 0 0 0-2 2l3.8 3.7H24l1.4-4.4a1.8 1.8 0 0 0-.8-2.1L21 16" />
    </template>
    <template v-else>
      <path d="M16 19H3V3h22v11M10 19v5M6 24h9" />
      <rect x="18" y="15" width="7" height="10" rx="3.5" />
      <path d="M21.5 15v4" />
    </template>
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ mode: string; size?: number }>(), { size: 22 });
</script>

<style scoped>
.device-preview-icon { display: block; flex: 0 0 auto; }
</style>
