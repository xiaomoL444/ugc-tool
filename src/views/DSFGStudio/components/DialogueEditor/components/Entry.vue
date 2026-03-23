<script setup lang="ts">
import PanelLayout from "@/components/Layout/PanelLayout.vue";
import { Handle, Position } from "@vue-flow/core";
</script>

<template>
  <PanelLayout>
    <div class="Node">
      入口
      <Handle type="target" :position="Position.Top" />
      <Handle type="source" :position="Position.Bottom" />
    </div>
  </PanelLayout>
</template>

<style scoped>
.Node {
  width: 200px;
  display: flex;
  flex-direction: column;
}
</style>
