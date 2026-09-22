<script setup lang="ts">
import { computed } from "vue";
import type { DialogueNode, FocusPushClip } from "../../types/DialogueNode";
import { resolveGroupOutlets } from "../../utils/groupOutlets";

const props = defineProps<{ node: DialogueNode; clip: FocusPushClip }>();
const sharedOutlets = computed(() =>
  resolveGroupOutlets(props.node).outlets
    .filter((outlet) => outlet.kind !== "FocusPush")
    .map((outlet, index) => ({
      index,
      label: outlet.kind === "Select"
        ? outlet.label + "：" + (props.node.select?.options.find(option => option.id === outlet.optionId)?.content || "未填写选项")
        : outlet.label,
    })),
);
const hasSelectedOutlet = computed(() =>
  sharedOutlets.value.some(outlet => outlet.index === props.clip.sharedOutletIndex),
);
</script>

<template>
  <div class="focus-push-settings">
    <label>
      输出方式
      <select v-model="clip.outputMode" aria-label="Focus Push 输出方式">
        <option value="Self">独立出口</option>
        <option value="Shared">共用出口</option>
      </select>
    </label>
    <template v-if="clip.outputMode === 'Shared'">
      <label>
        共用的出口
        <select v-model="clip.sharedOutletIndex" :disabled="!sharedOutlets.length" aria-label="Focus Push 共用出口">
          <option v-if="!hasSelectedOutlet" :value="clip.sharedOutletIndex" disabled>请选择有效出口</option>
          <option v-for="outlet in sharedOutlets" :key="outlet.index" :value="outlet.index">
            {{ outlet.index }} · {{ outlet.label }}
          </option>
        </select>
      </label>
      <p v-if="!sharedOutlets.length" class="warning">暂无可共用的出口，请启用玩家按下推进，或添加 Select 选项。</p>
      <p v-else-if="!hasSelectedOutlet" class="warning">原出口序号已不可用，请重新选择。</p>
      <p v-else>时间到达后使用所选出口，不新增 Focus Push 出口。</p>
    </template>
    <p v-else>在节点图连接独立的 Focus Push 出口，指定下一句话。</p>
    <p>拖动 Clip 设置触发时间。</p>
  </div>
</template>

<style scoped>
.focus-push-settings label { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; color: var(--timeline-text, #b9c7da); font-size: 12px; }
.focus-push-settings select { width: 100%; min-width: 0; padding: 7px; color: var(--timeline-text, #edf4ff); background: var(--timeline-field, #141922); border: 1px solid var(--timeline-border, #3b485b); border-radius: 5px; }
.focus-push-settings p { color: var(--timeline-text, #b9c7da); font-size: 12px; line-height: 1.6; }
.focus-push-settings .warning { color: var(--timeline-warning, #f4c37d); }
</style>
