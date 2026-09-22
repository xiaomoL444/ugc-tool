<script setup>
import useDragAndDrop from './useDnD'

const { onDragStart } = useDragAndDrop()
</script>

<template>
  <aside class="node-palette" aria-label="添加节点">
    <div class="description">拖动节点到画布中</div>

    <div class="nodes">
      <div class="node-item group-node-item" :draggable="true" @dragstart="onDragStart($event, 'group')">普通事件节点</div>

      <div class="node-item condition-node-item" :draggable="true" @dragstart="onDragStart($event, 'condition')">条件判断分支</div>
    </div>
  </aside>
</template>

<style scoped>
.node-palette {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 8px 12px;
  color: #617087;
  background: #f4f7fb;
  border-bottom: 1px solid #d3deec;
  font-size: 12px;
}
.nodes { display: flex; flex-wrap: wrap; gap: 8px; }
.node-item {
  padding: 7px 14px;
  border: 1px solid;
  border-radius: 5px;
  font-weight: 500;
  cursor: grab;
  user-select: none;
}
.node-item:active { cursor: grabbing; }
.node-item:hover { filter: brightness(1.06); }
.group-node-item { color: #295a91; background: #e6effb; border-color: #9cbde5; }
.condition-node-item {
  color: #79569e;
  background: #ece3fa;
  border-color: #c1a8df;
}

</style>
