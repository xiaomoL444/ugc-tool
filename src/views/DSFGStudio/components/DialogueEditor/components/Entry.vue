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
  --dsfg-handle-fill: #83e1b3;
  --dsfg-handle-ring: #24684d;
  width: 112px;
  min-height: 44px;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  color: #eafff3;
  font-size: 14px;
  font-weight: 700;
  background: linear-gradient(135deg, #24684d, #318761);
  border: 1px solid #53b988;
  border-radius: 22px;
  box-shadow: 0 8px 20px rgba(12, 52, 37, 0.3);
}

.entry-icon {
  font-size: 11px;
}

</style>
