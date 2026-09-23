<template>
  <div class="container-direction-guide" :class="{ 'is-selected': selected }" aria-hidden="true">
    <svg :width="length + 20" :height="40" :viewBox="`-10 -20 ${length + 20} 40`" focusable="false">
      <path class="direction-outline" :d="directionArrowPath(length)" />
      <path class="direction-bone" :d="directionArrowPath(length)" />
      <circle class="direction-origin" cx="0" cy="0" r="5" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { directionArrowPath } from "./containerDirectionGuide";
defineProps<{ length: number; selected: boolean }>();
</script>

<style scoped>
.container-direction-guide {
  position: absolute;
  z-index: 20;
  width: 0;
  height: 0;
  transform-origin: 0 0;
  color: #d8ba77;
  pointer-events: none;
}
.container-direction-guide.is-selected { z-index: 21; color: #5ce5ee; }
svg { position: absolute; left: -10px; top: -20px; overflow: visible; pointer-events: none; }
path, circle { vector-effect: non-scaling-stroke; pointer-events: none; }
.direction-outline { fill: none; stroke: #172332; stroke-width: 3; stroke-linejoin: round; }
.direction-bone { fill: currentColor; fill-opacity: .28; stroke: currentColor; stroke-width: 1.2; stroke-linejoin: round; }
.is-selected .direction-bone { fill-opacity: .45; }
.direction-origin { fill: #24323f; stroke: currentColor; stroke-width: 1.5; }
</style>
