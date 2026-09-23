<script setup lang="ts">
import type { DialogueNode } from "./types/DialogueNode";
import GroupNode from "./GroupNode.vue";

const props = defineProps<{ id: string; node: DialogueNode }>();
</script>

<template>
  <!-- Legacy editor retained in source history; migrated custom nodes render as Group nodes.
  <PanelLayout>
    <div class="Node">
      {{ node.id }}
      节点类型:
      <select v-model="node.nodeType" placeholder="对话类型">
        <option value="Dialogue">对话</option>
        <option value="Option">选项</option>
        <option value="Branch">分支</option>
      </select>
      对话类型:
      <select v-model="node.dialogueType" placeholder="对话类型">
        <option value="Stand">站桩</option>
        <option value="Walk">边走边说</option>
        <option value="Shady">黑幕</option>
        <option value="CG1">CG文本</option>
        <option value="CG2">CG插画文本</option>
        <option value="Center">中部文本</option>
      </select>
      <div v-for="(block, blockIndex) in node.blocks" :key="blockIndex">
        <FormItemRow title="标题">
          <input type="text" v-model="block.title"
        /></FormItemRow>
        <FormItemRow title="副标题">
          <input type="text" v-model="block.subtitle"
        /></FormItemRow>
        <FormItemRow title="内容">
          <div style="position: relative">
            <div
              v-for="(content, contentIndex) in block.value"
              :key="contentIndex"
            >
              <PanelLayout>
                <div>
                  <FormItemRow title="文本">
                    <input type="text" v-model="content.content"
                  /></FormItemRow>
                  <FormItemRow title="等待时间">
                    <input type="number" step="0.01" v-model="content.delay"
                  /></FormItemRow>
                  <FormItemRow title="时间模式">
                    <select v-model="content.delayMode">
                      <option value="Wait">等待</option>
                      <option value="Auto">自动播放</option>
                    </select></FormItemRow
                  >
                  <FormItemRow title="节点图事件">
                    <div style="position: relative">
                      <div
                        v-for="(
                          nodeGraphEvent, index
                        ) in content.nodeGraphEvent"
                      >
                        <input v-model="content.nodeGraphEvent[index]" />
                        <button
                          v-on:click="
                            (content.nodeGraphEvent ??= []).splice(index, 1)
                          "
                        >
                          删除元素
                        </button>
                      </div>
                      <button
                        v-on:click="(content.nodeGraphEvent ??= []).push('')"
                      >
                        添加元素
                      </button>
                    </div>
                  </FormItemRow>
                  <FormItemRow title="动画轨道"> <button>还没做</button></FormItemRow>
                  <FormItemRow title="运镜轨道"> <button>还没做</button></FormItemRow>
                </div>
                <button v-on:click="DeleteContent(blockIndex, contentIndex)">
                  删除元素
                </button>
              </PanelLayout>
            </div>
            <button v-on:click="AppendContent(blockIndex)">add content</button>
          </div></FormItemRow
        >
        <button v-on:click="DeleteBlock(blockIndex)">删除块</button>
        ————————————
      </div>
      <button v-on:click="AppendBlock">add block</button>
    </div>
    <Handle type="target" :position="Position.Left" />
    <Handle type="source" :position="Position.Right" />
  </PanelLayout> -->
  <GroupNode :id="props.id" :node="props.node" />
</template>

<style scoped>
.Node {
  width: 200px;
  display: flex;
  flex-direction: column;
}
</style>
