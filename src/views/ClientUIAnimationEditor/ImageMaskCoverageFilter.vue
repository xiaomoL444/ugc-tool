<template>
  <filter :id="id" x="0" y="0" :width="width" :height="height" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
    <!-- Run on the already filled/feathered source, before subtracting it from the rectangle. -->
    <feComponentTransfer in="SourceAlpha">
      <feFuncA type="linear" slope="255" intercept="0" />
    </feComponentTransfer>
  </filter>
</template>
<script setup lang="ts">
// Every nonzero 8-bit alpha sample becomes fully opaque; zero remains transparent.
defineProps<{ id: string; width: number; height: number }>();
</script>
