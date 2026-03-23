<script setup>
import { ref } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import DropzoneBackground from "./DropzoneBackground.vue";
import Sidebar from "./Sidebar.vue";
import useDragAndDrop from "./useDnD";
import CustomNode from "./CustomNode.vue";

const { onConnect, addEdges } = useVueFlow();

const { onDragOver, onDrop, onDragLeave, isDragOver } = useDragAndDrop();

const nodes = ref([]);
const edges = ref([]);
onConnect(addEdges);

const nodeTypes = {
  // custom: CustomNode,
};
</script>

<template>
  {{ nodes }}
  {{ edges }}
  <div class="dnd-flow" @drop="onDrop">
    <VueFlow
      v-model:nodes="nodes"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      v-model:edges="edges"
      :node-types="nodeTypes"
    >
      <template #node-custom="props">
        <CustomNode :id="props.id" :data="props.data" />
      </template>
      <DropzoneBackground
        :style="{
          backgroundColor: isDragOver ? '#e7f3ff' : 'transparent',
          transition: 'background-color 0.2s ease',
        }"
      >
        <p v-if="isDragOver">Drop here</p>
      </DropzoneBackground>
    </VueFlow>

    <Sidebar />
  </div>
</template>

<style scoped>
@import "./main.css";
</style>
