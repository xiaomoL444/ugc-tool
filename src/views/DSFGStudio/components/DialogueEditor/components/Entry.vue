<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
</script>

<template>
  <div class="entry-node">
    <span class="entry-icon">▶</span>
    <span>开始</span>
    <Handle id="next" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.entry-node {
  --dsfg-handle-fill: #4c9c7a;
  --dsfg-handle-ring: #fff;
  width: 112px;
  min-height: 44px;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  color: #33785e;
  font-size: 14px;
  font-weight: 700;
  background: #e4f3ec;
  border: 1px solid #a5cdbb;
  border-radius: 22px;
  box-shadow: 0 8px 20px rgba(35, 78, 60, 0.10);
}

.entry-icon {
  font-size: 11px;
}


</style>
