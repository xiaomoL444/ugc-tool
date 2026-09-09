<script setup>
import useDragAndDrop from './useDnD'

const { onDragStart } = useDragAndDrop()
</script>

<template>
  <aside>
    <div class="description">拖动节点到画布中</div>

    <div class="nodes">
      <div class="vue-flow__node-default" :draggable="true" @dragstart="onDragStart($event, 'group')">Group Node</div>

      <div class="condition-node-item" :draggable="true" @dragstart="onDragStart($event, 'condition')">条件判断分支</div>

      <div class="vue-flow__node-output" :draggable="true" @dragstart="onDragStart($event, 'output')">Output Node</div>
    </div>
  </aside>
</template>

<style scoped>
.condition-node-item {
  padding: 10px 12px;
  color: #f2eaff;
  background: linear-gradient(135deg, #6742a5, #8a5ec5);
  border: 1px solid #a982dc;
  border-radius: 5px;
}
</style>
