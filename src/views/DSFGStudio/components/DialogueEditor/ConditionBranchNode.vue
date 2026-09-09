<script setup lang="ts">
import { computed, nextTick, onMounted, watch } from "vue";
import { Handle, Position, useVueFlow, type Edge } from "@vue-flow/core";
import type {
  ConditionBranchNode,
  ConditionBranchOutput,
} from "./types/ConditionBranchNode";
import { createConditionBranchOutput } from "./utils/dialogueProject";

const props = withDefaults(
  defineProps<{
    id: string;
    node: ConditionBranchNode;
    edges?: Edge[];
    selected?: boolean;
  }>(),
  {
    edges: () => [],
    selected: false,
  },
);

const { updateNodeInternals } = useVueFlow();
const outputSignature = computed(() =>
  props.node.outputs.map((output) => output.id).join("|"),
);

function nextOutputIndex() {
  return props.node.outputs.reduce((maximum, output) => {
    const match = /^分支\s+(\d+)$/.exec(output.label.trim());
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, props.node.outputs.length);
}

function addOutput() {
  props.node.outputs.push(createConditionBranchOutput(nextOutputIndex()));
}

function deleteOutput(output: ConditionBranchOutput) {
  const index = props.node.outputs.findIndex((item) => item.id === output.id);
  if (index >= 0) props.node.outputs.splice(index, 1);
}

function ensureOutputLabel(output: ConditionBranchOutput, index: number) {
  if (!output.label.trim()) output.label = `分支 ${index + 1}`;
}

function isConnected(output: ConditionBranchOutput) {
  return props.edges.some(
    (edge) =>
      edge.source === props.id && edge.sourceHandle === output.id,
  );
}

function preventGraphDeletion(event: KeyboardEvent) {
  if (event.key === "Backspace" || event.key === "Delete") event.stopPropagation();
}

async function refreshHandles() {
  await nextTick();
  updateNodeInternals([props.id]);
}

watch(outputSignature, refreshHandles, { flush: "post" });
onMounted(refreshHandles);
</script>

<template>
  <article class="condition-branch-node" :class="{ selected }">
    <header class="condition-header">
      <span class="condition-kind">CONDITION</span>
      <button
        type="button"
        class="nodrag add-output-button"
        title="新增出口"
        @click.stop="addOutput"
      >
        ＋ 出口
      </button>
    </header>

    <div class="condition-title-row">
      <input
        v-model="node.name"
        class="nodrag condition-name"
        aria-label="条件分支名称"
      />
      <span>{{ node.outputs.length }} 个出口</span>
    </div>

    <div class="condition-ports">
      <div
        v-for="(output, index) in node.outputs"
        :key="output.id"
        class="condition-port-row"
      >
        <span class="condition-input-label">
          <Handle
            v-if="index === 0"
            id="input"
            class="condition-input-handle"
            type="target"
            :position="Position.Left"
            title="条件分支入口"
            aria-label="条件分支入口"
          />
          <template v-if="index === 0">入口</template>
        </span>

        <span class="connection-indicator">
          <span v-if="isConnected(output)" class="connected-dot" title="已连接" />
        </span>
        <div class="condition-output-fields">
          <input
            v-model="output.label"
            class="nodrag condition-output-name"
            :aria-label="`出口 ${index + 1} 名称`"
            @blur="ensureOutputLabel(output, index)"
            @click.stop
          />
          <label class="condition-field">
            <span>表达式 <small>字符串</small></span>
            <textarea
              v-model="output.condition"
              class="nodrag nopan nowheel"
              :aria-label="`出口 ${index + 1} 表达式`"
              placeholder="输入此出口的表达式"
              rows="2"
              spellcheck="false"
              @pointerdown.stop
              @click.stop
              @keydown="preventGraphDeletion"
              @keyup="preventGraphDeletion"
            />
          </label>
        </div>
        <button
          type="button"
          class="nodrag delete-output-button"
          title="删除出口并断开对应连线"
          :aria-label="`删除出口 ${index + 1}`"
          @click.stop="deleteOutput(output)"
        >
          ×
        </button>
        <Handle
          :id="output.id"
          class="condition-output-handle"
          type="source"
          :position="Position.Right"
          :title="output.label"
          :aria-label="output.label"
        />
      </div>

      <div v-if="!node.outputs.length" class="condition-port-row no-outputs">
        <span class="condition-input-label">
          <Handle
            id="input"
            class="condition-input-handle"
            type="target"
            :position="Position.Left"
            title="条件分支入口"
            aria-label="条件分支入口"
          />
          入口
        </span>
        <span>暂无出口，请点击“＋ 出口”</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.condition-branch-node {
  --dsfg-handle-fill: #c69bf2;
  --dsfg-handle-ring: #352746;
  width: 300px;
  overflow: visible;
  color: #f4effb;
  background: #26222e;
  border: 1px solid #665678;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(24, 12, 34, 0.3);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.condition-branch-node:hover {
  border-color: #9074aa;
}

.condition-branch-node.selected {
  border-color: #c095ea;
  box-shadow:
    0 0 0 2px rgba(192, 149, 234, 0.22),
    0 10px 28px rgba(24, 12, 34, 0.38);
  transform: translateY(-1px);
}

.condition-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 8px 0 11px;
  background: linear-gradient(90deg, #66439b, #8b60bd);
  border-radius: 9px 9px 0 0;
}

.condition-kind {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.11em;
}

.add-output-button {
  padding: 4px 7px;
  color: #f7efff;
  background: rgba(28, 14, 43, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 5px;
  font-size: 10px;
  cursor: pointer;
}

.add-output-button:hover {
  background: rgba(28, 14, 43, 0.42);
}

.condition-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 11px 7px;
}

.condition-name {
  min-width: 0;
  flex: 1;
  padding: 0;
  color: #f1eafa;
  background: transparent;
  border: 0;
  outline: 0;
  font: inherit;
  font-size: 14px;
  font-weight: 700;
}

.condition-title-row > span {
  color: #a99bb7;
  font-size: 9px;
  white-space: nowrap;
}

.condition-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 0;
  color: #afa2bc;
  font-size: 10px;
}

.condition-field > span {
  display: flex;
  justify-content: space-between;
  color: #d9c9e8;
  font-weight: 600;
}

.condition-field small {
  color: #887b95;
  font-weight: 400;
}

.condition-field textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 6px;
  color: #f1eafa;
  background: #26212e;
  border: 1px solid #51465e;
  border-radius: 4px;
  resize: none;
  font: inherit;
  font-size: 11px;
  line-height: 1.5;
}

.condition-field textarea:focus {
  outline: 1px solid #c095ea;
}

.condition-field textarea::placeholder {
  color: #887b95;
}

.condition-ports {
  overflow: visible;
  border-top: 1px solid #4b4057;
  border-radius: 0 0 9px 9px;
}

.condition-port-row {
  position: relative;
  display: grid;
  grid-template-columns: 32px 9px minmax(0, 1fr) 24px;
  align-items: center;
  min-height: 32px;
  padding: 8px 7px 8px 11px;
  background: #2d2836;
  border-bottom: 1px solid #413849;
}

.condition-port-row:last-child {
  border-bottom: 0;
  border-radius: 0 0 9px 9px;
}

.condition-input-label {
  color: #a99bb7;
  font-size: 10px;
}

.condition-output-fields {
  min-width: 0;
}

.condition-output-name {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px 6px;
  color: #e3d5f0;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  outline: 0;
  text-align: left;
  font: inherit;
  font-size: 10px;
}

.condition-output-name:hover,
.condition-output-name:focus {
  background: #211d28;
  border-color: #5d4d6d;
}

.connected-dot {
  display: block;
  width: 5px;
  height: 5px;
  background: #6ce0a7;
  border-radius: 50%;
  box-shadow: 0 0 5px rgba(108, 224, 167, 0.55);
}

.delete-output-button {
  width: 22px;
  height: 22px;
  padding: 0;
  color: #8f819c;
  background: transparent;
  border: 0;
  border-radius: 4px;
  font-size: 16px;
  cursor: pointer;
}

.delete-output-button:hover {
  color: #ffd2df;
  background: rgba(174, 70, 100, 0.23);
}

.condition-input-handle,
.condition-output-handle {
  z-index: 4;
}

.no-outputs {
  grid-template-columns: 48px 1fr;
  color: #b59a76;
  background: rgba(102, 70, 32, 0.23);
  font-size: 9px;
}

.no-outputs > span:last-child {
  text-align: right;
}
</style>
