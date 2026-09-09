<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DialogueProject } from "./types/FileStruct";
import { buildDialogueTextPreview, type TextPreviewBlock } from "./utils/dialogueTextPreview";
import { layoutDialogueTextPreview } from "./utils/dialogueTextPreviewLayout";
import { shouldShowDialogueSpeaker } from "./utils/dialogueTextEditing";
import { getTextPreviewNavigationTarget, type TextPreviewNavigationTarget } from "./utils/dialogueTextNavigation";

const props = defineProps<{ project: DialogueProject }>();
const emit = defineEmits<{ navigate: [target: TextPreviewNavigationTarget] }>();
const preview = computed(() => buildDialogueTextPreview(props.project));
const blockById = computed(() => new Map(preview.value.blocks.map((block) => [block.id, block])));
const edgeById = computed(() => new Map(preview.value.edges.map((edge) => [edge.id, edge])));
const heights = ref<Record<string, number>>({});
const layout = computed(() => layoutDialogueTextPreview(preview.value, heights.value));
const placedBlocks = computed(() => layout.value.blocks.map((placed) => ({
  ...placed, block: blockById.value.get(placed.id)!,
})));
const viewport = ref<HTMLElement>();
const surface = ref<HTMLElement>();
const zoom = ref(1);
const arrowId = `text-flow-arrow-${crypto.randomUUID()}`;
const returnArrowId = `${arrowId}-return`;
const lineCount = computed(() => preview.value.blocks.reduce(
  (count, block) => count + block.lines.filter((line) => line.hasDialogue).length, 0,
));
const detachedCount = computed(() => preview.value.blocks.filter((block) => !block.reachable).length);
const kindLabels = {
  entry: "开始", dialogue: "连续对话", select: "选项分支", condition: "条件分支", output: "结束",
};

function navigateToBlock(block: TextPreviewBlock, lineNodeId?: string, outlet = false) {
  const target = getTextPreviewNavigationTarget(block, lineNodeId, outlet);
  if (target) emit("navigate", target);
}

function changeZoom(value: number) {
  zoom.value = Math.max(0.25, Math.min(1.5, Math.round(value * 100) / 100));
}
function fitWidth() {
  if (viewport.value) changeZoom((viewport.value.clientWidth - 48) / layout.value.width);
}
function edgeDescription(id: string) {
  const edge = edgeById.value.get(id);
  if (!edge) return "";
  const source = blockById.value.get(edge.source);
  const target = blockById.value.get(edge.target);
  const outlet = source?.outlets[edge.outletIndex];
  return `${source?.title ?? ""} → ${target?.title ?? ""}${outlet?.text ? `：${outlet.text}` : ""}`;
}

let observer: ResizeObserver | undefined;
let disposed = false;
function measureBlocks() {
  const next: Record<string, number> = {};
  for (const element of surface.value?.querySelectorAll<HTMLElement>("[data-text-block]") ?? []) {
    next[element.dataset.textBlock!] = element.offsetHeight;
  }
  if (Object.keys(next).length !== Object.keys(heights.value).length ||
      Object.entries(next).some(([id, height]) => heights.value[id] !== height)) {
    heights.value = next;
  }
}
async function observeBlocks() {
  await nextTick();
  if (disposed) return;
  observer?.disconnect();
  for (const element of surface.value?.querySelectorAll("[data-text-block]") ?? []) observer?.observe(element);
  measureBlocks();
}
onMounted(() => {
  observer = new ResizeObserver(measureBlocks);
  observeBlocks();
});
watch(preview, observeBlocks);
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
});
</script>

<template>
  <section class="text-preview" aria-label="文本流程预览">
    <header class="text-preview-toolbar">
      <div class="text-preview-summary">
        <strong>文本流程</strong>
        <span>{{ lineCount }} 句台词 · {{ preview.blocks.length }} 个文本框 · 只读预览</span>
      </div>
      <div class="text-preview-zoom" role="group" aria-label="文本预览缩放">
        <button type="button" aria-label="缩小文本预览" :disabled="zoom <= 0.25" @click="changeZoom(zoom - 0.1)">−</button>
        <button type="button" title="重置为 100%" aria-label="重置文本预览缩放" @click="changeZoom(1)">{{ Math.round(zoom * 100) }}%</button>
        <button type="button" aria-label="放大文本预览" :disabled="zoom >= 1.5" @click="changeZoom(zoom + 0.1)">＋</button>
        <button type="button" @click="fitWidth">适合宽度</button>
      </div>
    </header>
    <div class="text-preview-legend">
      <span>从上到下阅读 · 可选中复制文本 · 双击卡片或台词定位节点</span>
      <span class="return-legend">虚线：返回前文</span>
      <span v-if="detachedCount" class="detached-legend">{{ detachedCount }} 个框未接入开始流程</span>
    </div>
    <div v-if="!preview.blocks.length" class="text-preview-empty">还没有可预览的对话，请先在节点编辑中创建 Group。</div>
    <div v-else ref="viewport" class="text-preview-viewport" tabindex="0" aria-label="文本流程画布">
      <div class="text-preview-size" :style="{ width: `${layout.width * zoom}px`, height: `${layout.height * zoom}px` }">
        <div ref="surface" class="text-preview-surface" :style="{ width: `${layout.width}px`, height: `${layout.height}px`, transform: `scale(${zoom})` }">
          <svg class="text-preview-connections" :width="layout.width" :height="layout.height" aria-label="文本框之间的流程连线">
            <defs>
              <marker :id="arrowId" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8195ac" /></marker>
              <marker :id="returnArrowId" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9871c4" /></marker>
            </defs>
            <g v-for="edge in layout.edges" :key="edge.id" :data-text-edge="edge.id" :class="{ 'return-edge': edge.isReturn }">
              <title>{{ edge.isReturn ? '返回前文：' : '' }}{{ edgeDescription(edge.id) }}</title>
              <path :d="edge.path" class="text-flow-edge" :marker-end="`url(#${edge.isReturn ? returnArrowId : arrowId})`" />
            </g>
          </svg>
          <article v-for="placed in placedBlocks" :key="placed.id" :data-text-block="placed.id"
            class="text-flow-block" :class="[`block-${placed.block.kind}`, { 'block-detached': !placed.block.reachable }]"
            :style="{ left: `${placed.x}px`, top: `${placed.y}px`, width: `${placed.width}px` }" :aria-label="placed.block.title"
            tabindex="0" title="双击定位到节点编辑；连续台词可双击具体的一句"
            @dblclick.stop="navigateToBlock(placed.block)" @keydown.enter.self.stop.prevent="navigateToBlock(placed.block)">
            <header v-if="placed.block.kind !== 'dialogue' || !placed.block.reachable" class="text-block-header">
              <span class="text-block-kind">{{ kindLabels[placed.block.kind] }}</span>
              <span v-if="placed.block.lines.length > 1">{{ placed.block.lines.length }} 句台词</span>
              <span v-if="!placed.block.reachable" class="detached-badge">未接入</span>
            </header>
            <h3 v-if="['entry', 'output', 'condition'].includes(placed.block.kind)" class="text-block-title">{{ placed.block.title }}</h3>
            <div v-if="placed.block.lines.length" class="text-block-lines">
              <div v-for="(line, index) in placed.block.lines" :key="line.nodeId" class="text-dialogue-line" :data-dialogue-id="line.nodeId"
                :class="{ 'speaker-start': shouldShowDialogueSpeaker(placed.block.lines, index) }"
                :title="`双击定位到 ${line.name || 'Group'}`" @dblclick.stop="navigateToBlock(placed.block, line.nodeId)">
                <div class="text-dialogue-identity">
                  <template v-if="line.hasDialogue && shouldShowDialogueSpeaker(placed.block.lines, index)">
                    <strong v-if="line.speaker" class="text-dialogue-speaker">{{ line.speaker }}</strong>
                    <span v-if="line.subtitle" class="text-dialogue-subtitle">（{{ line.subtitle }}）</span>
                  </template>
                </div>
                <p class="text-dialogue-content" :class="{ 'empty-dialogue': !line.hasDialogue || !line.content }">{{ line.hasDialogue ? (line.content || '（空台词）') : '（此 Group 没有台词）' }}</p>
              </div>
            </div>
            <ol v-if="placed.block.outlets.some((outlet) => outlet.kind === 'select' || outlet.kind === 'condition')" class="text-block-outlets"
              title="双击定位到此分支的节点" @dblclick.stop="navigateToBlock(placed.block, undefined, true)">
              <li v-for="(outlet, index) in placed.block.outlets" :key="outlet.id">
                <span class="text-outlet-number">{{ index + 1 }}</span>
                <div><small>{{ outlet.label }}</small><p>{{ outlet.text || (outlet.kind === 'condition' ? '（未填写表达式）' : outlet.kind === 'next' ? outlet.label : '（空选项）') }}</p></div>
                <span v-if="!outlet.connected" class="unconnected-outlet">未连接</span>
              </li>
            </ol>
            <p v-for="(warning, index) in placed.block.warnings" :key="index" class="text-flow-warning">{{ warning }}</p>
            <p v-if="placed.block.outlets.length === 1 && !placed.block.outlets[0].connected && ['next', 'entry'].includes(placed.block.outlets[0].kind)" class="text-flow-end">下一步未连接</p>
            <div v-if="placed.block.outlets.length" class="text-block-ports" aria-hidden="true">
              <span v-for="(outlet, index) in placed.block.outlets" :key="outlet.id" class="text-block-port" :class="{ 'port-unconnected': !outlet.connected }"
                :style="{ left: `${(index + 1) / (placed.block.outlets.length + 1) * 100}%` }">{{ placed.block.outlets.length > 1 ? index + 1 : '' }}</span>
            </div>
          </article>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.text-preview { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; color: #27354b; background: #f5f7fb; }
.text-preview-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 14px 18px 10px; background: #fff; }
.text-preview-summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
.text-preview-summary strong { font-size: 15px; }
.text-preview-summary span, .text-preview-legend { font-size: 12px; color: #78859a; }
.text-preview-zoom { display: flex; align-items: center; gap: 4px; }
.text-preview-zoom button { min-width: 30px; padding: 5px 9px; border: 1px solid #dbe2ec; border-radius: 6px; color: #425470; background: #fff; cursor: pointer; font-size: 12px; }
.text-preview-zoom button:hover { background: #edf3fc; }
.text-preview-zoom button:disabled { opacity: .35; cursor: default; }
.text-preview-legend { display: flex; flex-wrap: wrap; gap: 18px; padding: 0 18px 12px; background: #fff; border-bottom: 1px solid #e5eaf2; }
.return-legend { color: #8863b1; }
.return-legend::before { content: ''; display: inline-block; width: 20px; margin-right: 6px; vertical-align: middle; border-top: 2px dashed #9871c4; }
.detached-legend { color: #a3773b; }
.text-preview-viewport { flex: 1; min-height: 0; overflow: auto; padding: 24px; outline-offset: -3px; background-image: radial-gradient(#dce3ee .8px, transparent .8px); background-size: 20px 20px; }
.text-preview-size { position: relative; margin: 0 auto; }
.text-preview-surface { position: absolute; inset: 0 auto auto 0; transform-origin: top left; }
.text-preview-connections { position: absolute; inset: 0; overflow: visible; }
.text-flow-edge { stroke: #8195ac; stroke-width: 1.8; fill: none; stroke-linejoin: round; }
.return-edge .text-flow-edge { stroke: #9871c4; stroke-dasharray: 6 4; }
.text-flow-block { position: absolute; box-sizing: border-box; padding: 0 0 18px; border: 1px solid #d4dfe9; border-radius: 12px; background: #fff; box-shadow: 0 3px 10px #283e6110; --block-color: #417dc0; }
.text-flow-block:focus-visible { outline: 2px solid #417dc0; outline-offset: 4px; }
.text-block-header { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 11px 11px 0 0; background: #f2f6fc; color: #7b8ba1; font-size: 11px; }
.text-block-kind { color: var(--block-color); font-size: 11px; font-weight: 700; letter-spacing: .04em; margin-right: auto; }
.text-block-title { margin: 14px 18px 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.text-block-lines { margin: 16px 16px 0; }
.text-dialogue-line { display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: start; gap: 14px; margin-top: 10px; }
.text-dialogue-line:first-child { margin-top: 0; }
.text-dialogue-line.speaker-start:not(:first-child) { margin-top: 22px; }
.text-dialogue-identity { min-width: 0; padding: 3px 4px; font-size: 13px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.text-dialogue-speaker { color: #4671a2; font-weight: 600; }
.text-dialogue-subtitle { color: #8190a2; font-size: 11px; }
.text-dialogue-content { margin: 0; padding: 3px 4px; color: #27354b; font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.text-dialogue-line .empty-dialogue { color: #93a0af; font-style: italic; font-size: 12px; }
.block-select { --block-color: #b87928; border-color: #e6d5bb; }
.block-select .text-block-header { background: #fcf6ec; }
.block-condition { --block-color: #8460ab; border-color: #d9cdea; }
.block-condition .text-block-header { background: #f6f1fb; }
.block-entry, .block-output { --block-color: #3c8b71; padding: 0; border: 0; background: transparent; box-shadow: none; }
.block-entry .text-block-header, .block-output .text-block-header { display: none; }
.block-entry .text-block-title, .block-output .text-block-title { width: 120px; margin: 0 auto; padding: 12px; border: 1px solid #c5e0d5; border-radius: 30px; background: #edf7f2; text-align: center; color: #3a7e66; }
.block-entry.block-detached .text-block-title, .block-output.block-detached .text-block-title { border-style: dashed; }
.block-detached { border-style: dashed; }
.detached-badge { color: #b17f41; }
.text-block-outlets { list-style: none; margin: 12px 12px 4px; padding: 0; }
.text-block-outlets li { display: flex; align-items: flex-start; gap: 8px; padding: 9px 8px; margin-top: 6px; border: 1px solid #e8eaf0; border-radius: 7px; background: #fafbfe; }
.text-block-outlets li > div { flex: 1; min-width: 0; }
.text-block-outlets small { color: #8b95a5; font-size: 10px; overflow-wrap: anywhere; }
.text-block-outlets p { margin: 3px 0 0; font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.text-outlet-number { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; flex-shrink: 0; border-radius: 5px; color: var(--block-color); background: #edf0f7; font-size: 11px; font-weight: 700; }
.unconnected-outlet { flex-shrink: 0; color: #9aa4b4; font-size: 10px; padding-top: 3px; }
.text-block-ports { position: absolute; bottom: 0; left: 0; width: 100%; }
.text-block-port { position: absolute; top: 0; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box; background: var(--block-color); color: #fff; font-size: 10px; }
.text-block-port:empty { min-width: 7px; height: 7px; }
.text-block-port.port-unconnected { background: #fff; border: 1px solid #c4ccd7; color: #9aa5b3; }
.text-flow-warning { margin: 10px 16px 0; padding: 8px; border-radius: 5px; background: #fff7e6; color: #a9762c; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.text-flow-end { margin: 10px 18px 0; font-size: 11px; color: #929daa; }
.text-preview-empty { flex: 1; display: grid; place-content: center; padding: 30px; font-size: 14px; color: #8a98ab; }
</style>
