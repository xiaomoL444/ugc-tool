<template>
  <template v-for="layer in layers" :key="layer.node.id">
    <slot :node="layer.node" />
    <div v-if="layer.maskId" class="canvas-masked-subtree" :data-mask-node="layer.node.id" :style="{ maskImage: `url(#${layer.maskId})` }">
      <CanvasMaskLayers :layers="layer.children" v-slot="child"><slot :node="child.node" /></CanvasMaskLayers>
    </div>
    <template v-else>
      <CanvasMaskLayers :layers="layer.children" v-slot="child"><slot :node="child.node" /></CanvasMaskLayers>
    </template>
  </template>
</template>
<script setup lang="ts">
import type { VNode } from "vue";
import type { CanvasMaskLayer } from "./canvasMasks";
import type { UINode } from "./types";
defineProps<{ layers: CanvasMaskLayer[] }>();
defineSlots<{ default(props: { node: UINode }): VNode[] }>();
</script>
<style scoped>
.canvas-masked-subtree { position: absolute; inset: 0; pointer-events: none; }
</style>
