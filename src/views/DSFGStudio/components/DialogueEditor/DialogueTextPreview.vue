<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DialogueProject } from "./types/FileStruct";
import { buildDialogueTextPreview, isDialogueCollectionNode, type TextPreviewBlock } from "./utils/dialogueTextPreview";
import { layoutDialogueTextPreview } from "./utils/dialogueTextPreviewLayout";
import { shouldShowDialogueSpeaker, type DialogueTextEdit } from "./utils/dialogueTextEditing";
import { applyDialogueTextAction, type DialogueTextAction } from "./utils/dialogueTextActions";
import { canUndoDialogueDeletion, captureDialogueDeletion } from "./utils/dialogueDeletionUndo";
import DialogueTextLine from "./components/DialogueTextLine.vue";
import DialogueOptionText from "./components/DialogueOptionText.vue";
import VisualConditionEditor from "./components/VisualConditionEditor.vue";
import SelectOptionIcon from "./components/SelectOptionIcon.vue";
import { DEFAULT_SELECT_ICON_ID } from "./config/selectStyleRegistry";
import type { EntityPreset } from "../EntityPresetEditor/entityPresets";
import { getTextPreviewNavigationTarget, type TextPreviewNavigationTarget } from "./utils/dialogueTextNavigation";

const props = withDefaults(defineProps<{ project: DialogueProject; entityPresets?: EntityPreset[]; presetsError?: string }>(), { entityPresets: () => [], presetsError: "" });
const emit = defineEmits<{
  navigate: [target: TextPreviewNavigationTarget];
  edit: [edit: DialogueTextEdit];
  option: [nodeId: string, optionId: string, value: string];
  optionIcon: [nodeId: string, optionId: string, icon: number];
  replace: [project: DialogueProject];
  retryPresets: [];
}>();
const preview = computed(() => buildDialogueTextPreview(props.project));
const namedPresets = computed(() => props.entityPresets.filter(preset => preset.talker.trim()));
const speakerAliases = computed(() => {
  const aliases = new Map<string, string>();
  // Presets arrive system-first; use the first nonempty alias for an exact Talker match.
  for (const preset of props.entityPresets) {
    if (preset.talker.trim() && preset.name.trim() && !aliases.has(preset.talker)) {
      aliases.set(preset.talker, preset.name);
    }
  }
  return aliases;
});
const deletedDialogue = ref<ReturnType<typeof captureDialogueDeletion>>();
watch(() => props.project, project => {
  if (deletedDialogue.value && !canUndoDialogueDeletion(deletedDialogue.value, project)) deletedDialogue.value = undefined;
}, { deep: true });
async function undoDeletion() {
  const snapshot = deletedDialogue.value;
  if (!snapshot || !canUndoDialogueDeletion(snapshot, props.project)) return;
  deletedDialogue.value = undefined;
  emit("replace", snapshot.project);
  await nextTick();
  const block = preview.value.blocks.find(item => snapshot.blockId ? item.id === snapshot.blockId : item.nodeIds.includes(snapshot.nodeId));
  if (block) focusBlock(block.id);
}
const blockById = computed(() => new Map(preview.value.blocks.map((block) => [block.id, block])));
const edgeById = computed(() => new Map(preview.value.edges.map((edge) => [edge.id, edge])));
const heights = ref<Record<string, number>>({});
const collectionWidth = ref(560);
const layout = computed(() => layoutDialogueTextPreview(preview.value, heights.value, collectionWidth.value));
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
const detachedBlocks = computed(() => preview.value.blocks.filter((block) => !block.reachable && block.kind !== 'entry' && block.kind !== 'output'));
const detachedCount = computed(() => detachedBlocks.value.length);
const activeBlockId = ref("");
const activeBlock = computed(() => blockById.value.get(activeBlockId.value));
const chosenOutletId = ref("");
const activeOutletId = computed(() => activeBlock.value?.outlets.find((outlet) => outlet.id === chosenOutletId.value)?.id ?? activeBlock.value?.outlets[0]?.id ?? "");
function selectBlock(id: string) {
  if (activeBlockId.value !== id) chosenOutletId.value = "";
  activeBlockId.value = id;
}
function append(kind: "dialogue" | "select" | "condition", preset?: EntityPreset) {
  if (!activeBlock.value || !activeOutletId.value) return;
  act({ type: "append", blockId: activeBlock.value.id, outletId: activeOutletId.value, kind, preset });
}
const draggingLine = ref("");
const dropLine = ref("");
let lineDrag: { pointerId: number; x: number; y: number; element: HTMLElement } | undefined;
const panning = ref(false);
let pan: { pointerId: number; x: number; y: number; left: number; top: number } | undefined;
function startPan(event: PointerEvent) {
  const target = event.target as HTMLElement;
  if (event.button !== 1 && (event.button !== 0 || target.closest("article, button, input, textarea, select"))) return;
  if (!viewport.value) return;
  event.preventDefault();
  pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.value.scrollLeft, top: viewport.value.scrollTop };
  viewport.value.setPointerCapture(event.pointerId);
  panning.value = true;
}
function movePan(event: PointerEvent) {
  if (!pan || !viewport.value) return;
  viewport.value.scrollLeft = pan.left + pan.x - event.clientX;
  viewport.value.scrollTop = pan.top + pan.y - event.clientY;
}
function endPan() { pan = undefined; panning.value = false; }
function focusBlock(id: string) {
  const placed = layout.value.blocks.find((item) => item.id === id);
  if (!placed || !viewport.value) return;
  selectBlock(id);
  const element = surface.value?.querySelector<HTMLElement>(`[data-text-block="${CSS.escape(id)}"]`);
  if (element) viewport.value.scrollBy({
    left: element.getBoundingClientRect().left - viewport.value.getBoundingClientRect().left - (viewport.value.clientWidth - placed.width * zoom.value) / 2,
    top: element.getBoundingClientRect().top - viewport.value.getBoundingClientRect().top - 32,
    behavior: "smooth",
  });
}
async function act(action: DialogueTextAction) {
  // Preserve the edited sentence's screen position across block regrouping.
  const id = "nodeId" in action ? action.nodeId : undefined;
  const oldElement = id ? surface.value?.querySelector<HTMLElement>(`[data-dialogue-id="${CSS.escape(id)}"]`) : undefined;
  const oldRect = oldElement?.getBoundingClientRect();
  const result = applyDialogueTextAction(props.project, action);
  if (!result) return;
  const deleting = action.type === "delete" || action.type === "delete-outlet" || action.type === "delete-block";
  deletedDialogue.value = deleting ? captureDialogueDeletion(props.project, result.project, id ?? "", "blockId" in action ? action.blockId : undefined) : undefined;
  emit("replace", result.project);
  await nextTick();
  measureBlocks();
  await nextTick();
  if (result.focusBlockId && blockById.value.has(result.focusBlockId)) {
    focusBlock(result.focusBlockId);
  } else if (result.nodeId) {
    const block = preview.value.blocks.find((item) => item.nodeIds.includes(result.nodeId!));
    if (block) selectBlock(block.id);
    const element = surface.value?.querySelector<HTMLElement>(`[data-dialogue-id="${CSS.escape(result.nodeId)}"]`);
    if (oldRect && element && viewport.value) {
      const rect = element.getBoundingClientRect();
      viewport.value.scrollLeft += rect.left - oldRect.left;
      viewport.value.scrollTop += rect.top - oldRect.top;
    }
    element?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (block && !element?.querySelector("textarea")) focusBlock(block.id);
  } else if (deleting && !blockById.value.has(activeBlockId.value)) {
    const block = preview.value.blocks.find(item => item.kind === "entry") ?? preview.value.blocks[0];
    if (block) focusBlock(block.id);
  }
}
function movable(id: string) {
  const node = props.project.dialogue.nodes[id];
  return !!node && isDialogueCollectionNode(node) && node.dialogue?.advanceMode === "PlayerInput";
}
function canMove(block: TextPreviewBlock, index: number, delta: number) {
  return !!block.lines[index + delta] && movable(block.lines[index].nodeId) && movable(block.lines[index + delta].nodeId);
}
function moveLine(block: TextPreviewBlock, index: number, delta: number) {
  if (canMove(block, index, delta)) act({ type: "move", nodeId: block.lines[index].nodeId, targetId: block.lines[index + delta].nodeId });
}
function insertLine(id: string) { act({ type: "insert", nodeId: id, before: !movable(id) }); }
function startLineDrag(event: PointerEvent, id: string) {
  if (event.button !== 0 || !(event.target as HTMLElement).closest(".line-grip")) return;
  event.preventDefault();
  event.stopPropagation();
  draggingLine.value = id;
  const element = event.currentTarget as HTMLElement;
  element.setPointerCapture(event.pointerId);
  lineDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, element };
}
function canDrop(block: TextPreviewBlock, id: string) {
  return id !== draggingLine.value && movable(id) && block.lines.some((line) => line.nodeId === draggingLine.value);
}
function dragLine(event: PointerEvent) {
  if (!lineDrag || Math.hypot(event.clientX - lineDrag.x, event.clientY - lineDrag.y) < 4) return;
  const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-dialogue-id]");
  const id = element?.dataset.dialogueId;
  const block = preview.value.blocks.find((item) => item.lines.some((line) => line.nodeId === id));
  dropLine.value = id && block && canDrop(block, id) ? id : "";
  const bounds = viewport.value?.getBoundingClientRect();
  if (bounds && event.clientY > bounds.top && event.clientY < bounds.bottom) {
    if (event.clientY < bounds.top + 36) viewport.value?.scrollBy(0, -16);
    else if (event.clientY > bounds.bottom - 36) viewport.value?.scrollBy(0, 16);
  }
}
function endLineDrag(commit = false) {
  if (!lineDrag) return;
  const action: DialogueTextAction | undefined = commit && dropLine.value
    ? { type: "move", nodeId: draggingLine.value, targetId: dropLine.value } : undefined;
  const { element, pointerId } = lineDrag;
  lineDrag = undefined;
  draggingLine.value = ""; dropLine.value = "";
  if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  if (action) act(action);
}
function outletTarget(blockId: string, index: number) {
  return preview.value.edges.find((edge) => edge.source === blockId && edge.outletIndex === index)?.target ?? "";
}
function tailId(block: TextPreviewBlock) { return block.nodeIds[block.nodeIds.length - 1]; }
function editOption(block: TextPreviewBlock, outletId: string, value: string) {
  emit("option", tailId(block), outletId.slice("select:".length), value);
}
const kindLabels = {
  entry: "开始", dialogue: "对话集合", select: "选项卡", action: "演出节点", condition: "条件分支", output: "结束",
};
function blockLabel(block: TextPreviewBlock) {
  return block.kind === "select" && block.lines.some((line) => line.hasDialogue) ? "对话 + 选项" : kindLabels[block.kind];
}

function navigateToBlock(block: TextPreviewBlock, lineNodeId?: string, outlet = false) {
  const target = getTextPreviewNavigationTarget(block, lineNodeId, outlet);
  if (target) emit("navigate", target);
}

function changeZoom(value: number) {
  const previous = zoom.value;
  const view = viewport.value;
  const centerX = view ? (view.scrollLeft + view.clientWidth / 2) / previous : 0;
  const centerY = view ? (view.scrollTop + view.clientHeight / 2) / previous : 0;
  zoom.value = Math.max(0.4, Math.min(1.5, Math.round(value * 100) / 100));
  nextTick(() => { if (view) { view.scrollLeft = centerX * zoom.value - view.clientWidth / 2; view.scrollTop = centerY * zoom.value - view.clientHeight / 2; } });
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
  if (viewport.value) collectionWidth.value = Math.max(320, Math.min(560, viewport.value.clientWidth - 64));
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
  if (viewport.value) observer?.observe(viewport.value);
  for (const element of surface.value?.querySelectorAll("[data-text-block]") ?? []) observer?.observe(element);
  measureBlocks();
}
onMounted(async () => {
  selectBlock(preview.value.blocks.find((block) => block.reachable && block.lines.length)?.id ?? preview.value.blocks[0]?.id ?? "");
  observer = new ResizeObserver(measureBlocks);
  await observeBlocks();
  await nextTick();
  measureBlocks();
  await nextTick();
  if (!disposed) focusBlock(activeBlockId.value);
});
watch(collectionWidth, async () => {
  await nextTick();
  measureBlocks();
  await nextTick();
  if (!disposed) focusBlock(activeBlockId.value);
});
watch(preview, (value, previous) => {
  if (!value.blocks.some((block) => block.id === activeBlockId.value)) {
    const previousIds = previous.blocks.find((block) => block.id === activeBlockId.value)?.nodeIds ?? [];
    activeBlockId.value = value.blocks.find((block) => block.nodeIds.some((id) => previousIds.includes(id)))?.id ?? value.blocks[0]?.id ?? "";
  }
  observeBlocks();
});
onBeforeUnmount(() => {
  disposed = true;
  endLineDrag();
  observer?.disconnect();
});
</script>

<template>
  <section class="text-preview" aria-label="文本对话编辑器">
    <header class="text-preview-toolbar">
      <div class="text-preview-summary">
        <strong>对话手稿</strong>
        <span>{{ lineCount }} 句台词 · {{ preview.blocks.filter(block => block.kind === 'dialogue').length }} 个对话集合</span>
      </div>
      <div class="text-preview-zoom" role="group" aria-label="文本预览缩放">
        <button v-if="deletedDialogue" type="button" title="继续编辑前，可恢复刚删除的内容、Clip 和连线" @click="undoDeletion">撤销删除</button>
        <button type="button" class="new-group-button" @click="act({ type: 'create' })">＋ 新建集合</button>
        <button type="button" aria-label="缩小文本预览" :disabled="zoom <= 0.4" @click="changeZoom(zoom - 0.1)">−</button>
        <button type="button" title="重置为 100%" aria-label="重置文本预览缩放" @click="changeZoom(1)">{{ Math.round(zoom * 100) }}%</button>
        <button type="button" aria-label="放大文本预览" :disabled="zoom >= 1.5" @click="changeZoom(zoom + 0.1)">＋</button>
        <button type="button" @click="fitWidth">适合宽度</button>
        <select aria-label="聚焦集合或节点" :value="activeBlockId" @change="focusBlock(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>聚焦集合或节点…</option>
          <option v-for="(block, index) in preview.blocks" :key="block.id" :value="block.id">{{ index + 1 }} · {{ block.title }}{{ !block.reachable ? ' · 散落' : '' }}</option>
        </select>
      </div>
    </header>
    <div class="text-preview-legend">
      <span>点击选择集合 · 右侧添加内容 · 拖动空白处平移 · Ctrl+Enter 续写</span>
      <span class="return-legend">虚线：返回前文</span>
      <button v-if="detachedCount" type="button" class="detached-legend" @click="focusBlock(detachedBlocks[(detachedBlocks.findIndex(block => block.id === activeBlockId) + 1) % detachedCount].id)">{{ detachedCount }} 组散落文本 · 点击查看</button>
    </div>
    <div class="text-editing-workspace">
    <div v-if="!preview.blocks.length" class="text-preview-empty"><p>从第一句对话开始。</p><button type="button" @click="act({ type: 'create' })">＋ 写下第一句</button></div>
    <div v-else ref="viewport" class="text-preview-viewport" :class="{ 'is-panning': panning }" tabindex="0" aria-label="文本流程画布"
      @pointerdown="startPan" @pointermove="movePan" @pointerup="endPan" @pointercancel="endPan" @lostpointercapture="endPan">
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
            class="text-flow-block" :class="[`block-${placed.block.kind}`, { 'block-detached': !placed.block.reachable, 'block-active': activeBlockId === placed.id }]"
            :style="{ left: `${placed.x}px`, top: `${placed.y}px`, width: `${placed.width}px` }" :aria-label="placed.block.title"
            tabindex="0" :aria-current="activeBlockId === placed.id ? 'true' : undefined" @click.capture="selectBlock(placed.id)" @focusin="selectBlock(placed.id)">
            <header class="text-block-header">
              <span class="text-block-kind">{{ blockLabel(placed.block) }}</span>
              <span v-if="placed.block.kind === 'dialogue'">{{ placed.block.lines.length }} 句对话</span>
              <span v-if="!placed.block.reachable" class="detached-badge">散落文本</span>
              <button type="button" title="聚焦此组" @click="focusBlock(placed.id)">◎</button>
              <button type="button" title="在节点图配置详细 Clip" @click="navigateToBlock(placed.block)">节点 ↗</button>
              <button v-if="placed.block.kind !== 'entry'" type="button" class="delete-content" :aria-label="`删除${blockLabel(placed.block)}`" title="删除整个集合或节点，可立即撤销" @click="act({ type: 'delete-block', blockId: placed.block.id })">删除</button>
            </header>
            <h3 v-if="['entry', 'output', 'condition'].includes(placed.block.kind)" class="text-block-title">{{ placed.block.title }}</h3>
            <div v-if="placed.block.lines.some(line => line.hasDialogue)" class="text-block-lines">
              <div v-for="(line, index) in placed.block.lines" :key="line.nodeId" :data-dialogue-id="line.nodeId" :class="{ 'line-drop-target': dropLine === line.nodeId }"
                @pointerdown="startLineDrag($event, line.nodeId)" @pointermove="dragLine"
                @pointerup="endLineDrag(true)" @pointercancel="endLineDrag()" @lostpointercapture="endLineDrag()">
                <DialogueTextLine v-if="line.hasDialogue" :line="line" :speaker-alias="speakerAliases.get(line.speaker)" :index="index" :movable="movable(line.nodeId) && placed.block.lines.length > 1" :repeat-speaker="!shouldShowDialogueSpeaker(placed.block.lines, index)"
                  :can-move-up="canMove(placed.block, index, -1)" :can-move-down="canMove(placed.block, index, 1)"
                  @edit="emit('edit', $event)" @move="moveLine(placed.block, index, $event)" @insert="insertLine(line.nodeId)"
                  @remove="act({ type: 'delete', nodeId: line.nodeId })"
                  @configure="navigateToBlock(placed.block, line.nodeId)" @add-dialogue="act({ type: 'add-dialogue', nodeId: line.nodeId })" />
              </div>
            </div>
            <p v-if="placed.block.kind === 'action'" class="text-node-summary">{{ placed.block.title }} · 详细演出在节点图配置</p>
            <ol v-if="placed.block.kind === 'select' || placed.block.kind === 'condition'" class="text-block-outlets">
              <li v-for="(outlet, index) in placed.block.outlets" :key="outlet.id">
                <span class="text-outlet-number">{{ index + 1 }}</span>
                <div><div class="option-heading"><small>{{ outlet.label }}</small><SelectOptionIcon v-if="outlet.kind === 'select'" :model-value="outlet.icon ?? DEFAULT_SELECT_ICON_ID" :label="`选项 ${index + 1} 图标`" @update:model-value="emit('optionIcon', tailId(placed.block), outlet.id.slice('select:'.length), $event)" /></div>
                  <DialogueOptionText v-if="outlet.kind === 'select'" :model-value="outlet.text" @update:model-value="editOption(placed.block, outlet.id, $event)" />
                  <VisualConditionEditor v-else-if="outlet.kind === 'condition'" :model-value="outlet.text" :label="outlet.label"
                    @update:model-value="act({ type: 'edit-condition', nodeId: tailId(placed.block), outletId: outlet.id, condition: $event })" />
                  <button class="outlet-focus" type="button" @click.stop="selectBlock(placed.id); chosenOutletId = outlet.id">{{ outlet.connected ? '已连接' : '未连接' }} · 从此出口添加</button>
                </div>
                <button v-if="outlet.connected" type="button" title="前往此分支" @click="focusBlock(outletTarget(placed.id, index))">↗</button>
                <button v-if="outlet.kind === 'select' || outlet.kind === 'condition'" type="button" class="delete-content" :aria-label="outlet.kind === 'select' ? `删除选项 ${index + 1}` : `删除条件分支项 ${index + 1}`" title="删除此项及其连线，保留下游内容" @click="act({ type: 'delete-outlet', blockId: placed.block.id, outletId: outlet.id })">×</button>
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
    <aside class="text-collection-panel" aria-label="集合操作">
      <template v-if="activeBlock">
        <header><span class="panel-eyebrow">当前选中</span><h3>{{ blockLabel(activeBlock) }}</h3><p>{{ activeBlock.kind === 'dialogue' ? `${activeBlock.lines.length} 句对话` : activeBlock.title }}</p></header>
        <p v-if="activeBlock.kind === 'dialogue'" class="panel-hint">连续对话在此集合中编辑，附带的 Clip 显示在各句旁。</p>
        <p v-else class="panel-hint">独立节点，保留自己的台词、选项或演出。</p>
        <label v-if="activeBlock.outlets.length > 1" class="panel-field">添加到哪个出口
          <select aria-label="添加到哪个出口" :value="activeOutletId" @change="chosenOutletId = ($event.target as HTMLSelectElement).value">
            <option v-for="outlet in activeBlock.outlets" :key="outlet.id" :value="outlet.id">{{ outlet.text || outlet.label }}</option>
          </select>
        </label>
        <div class="panel-section">
          <span class="panel-eyebrow">添加对话</span>
          <button type="button" class="panel-add-button" :disabled="!activeOutletId" @click="append('dialogue')"><strong>＋ 默认对话</strong><small>{{ activeBlock.kind === 'dialogue' ? '追加到当前集合末尾' : '在所选出口后创建对话集合' }}</small></button>
          <button v-for="preset in namedPresets" :key="preset.id" type="button" class="panel-add-button" :title="`Talker：${preset.talker}`" :disabled="!activeOutletId" @click="append('dialogue', preset)"><strong>＋ {{ preset.name.trim() || preset.talker }}</strong><small>{{ preset.subtitle || '无副标题' }} · 空白对话</small></button>
          <p v-if="presetsError" class="panel-hint" role="alert">{{ presetsError }} <button type="button" @click="emit('retryPresets')">重试</button></p>
          <p v-else-if="!namedPresets.length" class="panel-hint">在「编辑内容 → 预设设置 → 预设实体」保存人物，即可从这里添加。</p>
        </div>
        <div class="panel-section">
          <span class="panel-eyebrow">创建后续节点</span>
          <button type="button" class="panel-add-button" :disabled="!activeOutletId" @click="append('select')"><strong>⑂ 添加选项卡</strong><small>在集合下方创建独立选项节点</small></button>
          <button type="button" class="panel-add-button" :disabled="!activeOutletId" @click="append('condition')"><strong>◇ 添加条件分支</strong><small>创建独立条件节点</small></button>
          <p v-if="!activeOutletId" class="panel-hint">此节点没有可用出口，请在节点图配置。</p>
        </div>
        <div v-if="activeBlock.kind === 'select'" class="panel-section">
          <span class="panel-eyebrow">当前选项卡</span>
          <button type="button" class="panel-secondary" @click="act({ type: 'add-option', nodeId: tailId(activeBlock) })">＋ 增加一个选项</button>
        </div>
        <div v-if="activeOutletId" class="panel-section">
          <label class="panel-field">后续连接
            <select aria-label="连接到集合或节点" :value="outletTarget(activeBlock.id, activeBlock.outlets.findIndex(outlet => outlet.id === activeOutletId))" @change="act({ type: 'connect', blockId: activeBlock.id, outletId: activeOutletId, targetId: ($event.target as HTMLSelectElement).value })">
              <option value="">未连接</option>
              <option v-for="target in preview.blocks.filter(block => block.kind !== 'entry' && (block.id !== activeBlock!.id || outletTarget(activeBlock!.id, activeBlock!.outlets.findIndex(outlet => outlet.id === activeOutletId)) === block.id))" :key="target.id" :value="target.id">{{ blockLabel(target) }} · {{ target.lines[0]?.content?.slice(0, 20) || target.title }}</option>
            </select>
          </label>
        </div>
        <button type="button" class="panel-secondary" @click="navigateToBlock(activeBlock)">在节点图配置 Clip ↗</button>
        <div v-if="activeBlock.kind !== 'entry'" class="panel-section">
          <button type="button" class="panel-secondary delete-content" @click="act({ type: 'delete-block', blockId: activeBlock.id })">删除{{ blockLabel(activeBlock) }}</button>
          <p class="panel-hint">{{ activeBlock.kind === 'dialogue' ? '删除集合内全部对话及 Clip，并接回后续流程。' : '删除此节点及连线，保留下游集合；未接入流程的内容会标为散落文本。' }}</p>
        </div>
      </template>
      <div v-else class="panel-hint">选择画布中的集合或节点，再在这里添加内容。</div>
    </aside>
    </div>
  </section>
</template>

<style scoped>
.text-preview { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; color: #27354b; background: #f5f7fb; }
.text-editing-workspace { display: flex; flex: 1; min-height: 0; min-width: 0; }
.text-collection-panel { flex: 0 0 218px; padding: 18px 16px; box-sizing: border-box; overflow-y: auto; border-left: 1px solid #dce4ef; background: #fff; text-align: left; }
.text-collection-panel header h3 { margin: 7px 0 3px; font-size: 16px; color: #344c70; }
.text-collection-panel header p { margin: 0; color: #8a96a8; font-size: 12px; }
.panel-eyebrow { font-size: 11px; color: #8a96a8; }
.delete-content { color: #a46770 !important; }
.delete-content:hover { background: #fbe9ec !important; color: #b84251 !important; }
.panel-hint { color: #8c98a9; font-size: 11px; line-height: 1.7; text-align: left; }
.panel-section { display: grid; gap: 8px; padding: 16px 0; border-top: 1px solid #edf0f5; }
.panel-field { display: grid; gap: 7px; font-size: 11px; color: #8a96a8; margin: 12px 0; }
.panel-field select { width: 100%; min-width: 0; }
.panel-add-button { display: grid; gap: 6px; width: 100%; padding: 12px 10px; border: 1px solid #dce6f3; border-radius: 7px; text-align: left; color: #4b72a2; background: #f6f9fe; cursor: pointer; }
.panel-add-button strong { font-size: 12px; font-weight: 600; }
.panel-add-button small { color: #95a2b4; font-size: 10px; line-height: 1.6; }
.panel-add-button:hover { border-color: #93b5de; background: #eff5fd; }
.panel-add-button:disabled { opacity: .4; cursor: default; }
.panel-secondary { padding: 7px 0; border: 0; background: transparent; color: #7587a1; text-align: left; font-size: 11px; cursor: pointer; }
.text-node-summary { padding: 12px 20px; color: #8b97a8; font-size: 12px; text-align: left; }
.block-action { --block-color: #77828e; background: #fafbfc; }
.text-block-outlets .outlet-focus { padding-left: 0; text-align: left; }
.text-preview-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 14px 18px 10px; background: #fff; }
.text-preview-summary { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
.text-preview-summary strong { font-size: 15px; }
.text-preview-summary span, .text-preview-legend { font-size: 12px; color: #78859a; }
.text-preview-zoom { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.text-preview-zoom button { min-width: 30px; padding: 5px 9px; border: 1px solid #dbe2ec; border-radius: 6px; color: #425470; background: #fff; cursor: pointer; font-size: 12px; }
.text-preview-zoom button:hover { background: #edf3fc; }
.text-preview-zoom button:disabled { opacity: .35; cursor: default; }
.text-preview-legend { display: flex; flex-wrap: wrap; gap: 18px; padding: 0 18px 12px; background: #fff; border-bottom: 1px solid #e5eaf2; }
.return-legend { color: #8863b1; }
.return-legend::before { content: ''; display: inline-block; width: 20px; margin-right: 6px; vertical-align: middle; border-top: 2px dashed #9871c4; }
.detached-legend { color: #a3773b; }
.text-preview-viewport { flex: 1; min-height: 0; min-width: 0; overflow: auto; padding: 24px; outline-offset: -3px; background-image: radial-gradient(#dce3ee .8px, transparent .8px); background-size: 20px 20px; cursor: grab; overflow-anchor: none; }
.text-preview-viewport.is-panning { cursor: grabbing; user-select: none; }
.text-preview-viewport.is-panning * { cursor: grabbing !important; }
.text-preview-size { position: relative; margin: 0 auto; }
.text-preview-surface { position: absolute; inset: 0 auto auto 0; transform-origin: top left; }
.text-preview-connections { position: absolute; inset: 0; overflow: visible; }
.text-flow-edge { stroke: #8195ac; stroke-width: 1.8; fill: none; stroke-linejoin: round; }
.return-edge .text-flow-edge { stroke: #9871c4; stroke-dasharray: 6 4; }
.text-flow-block { position: absolute; box-sizing: border-box; padding: 0 0 18px; border: 1px solid #d4dfe9; border-radius: 12px; background: #fff; box-shadow: 0 3px 10px #283e6110; --block-color: #417dc0; cursor: default; }
.text-flow-block.block-active { outline: 2px dashed #6f9bce; outline-offset: 7px; box-shadow: 0 5px 20px #283e6110; }
.text-flow-block:focus-visible { outline: 2px solid #417dc0; outline-offset: 4px; }
.text-block-header { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 11px 11px 0 0; background: #f2f6fc; color: #7b8ba1; font-size: 11px; }
.text-block-kind { color: var(--block-color); font-size: 11px; font-weight: 700; letter-spacing: .04em; margin-right: auto; }
.text-block-title { margin: 14px 18px 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.text-block-lines { margin: 8px 8px 0; }
.text-preview button, .text-preview select { font-family: inherit; }
.text-block-header button, .text-block-outlets button { border: 0; border-radius: 5px; background: transparent; color: #788aa2; cursor: pointer; font-size: 11px; padding: 4px 6px; white-space: nowrap; }
.text-block-header button:hover, .text-block-outlets button:hover { background: #e9f0fa; color: #326ba9; }
.text-block-kind { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.text-preview-zoom select { max-width: 170px; }
.text-preview select { border: 1px solid #e0e6ef; border-radius: 5px; padding: 5px; color: #78879a; background: #fff; font-size: 11px; cursor: pointer; }
.text-preview-zoom .new-group-button { color: #fff; background: #477fb5; border-color: #477fb5; margin-right: 8px; }
button.detached-legend { border: 0; border-radius: 3px; background: #fff6e6; font-size: 11px; cursor: pointer; padding: 2px 6px; }
.line-drop-target { box-shadow: inset 0 2px #649ad7; }
.text-block-outlets input { display: block; width: 100%; box-sizing: border-box; border: 1px solid transparent; border-radius: 4px; padding: 4px; margin: 2px 0; background: transparent; color: #6f5837; font: inherit; font-size: 13px; }
.text-block-outlets input:focus { outline: 1px solid #dfc89f; background: #fff; }
.text-block-outlets select { max-width: 100%; width: 100%; margin-top: 4px; }
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
.option-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.text-block-outlets small { color: #8b95a5; font-size: 10px; overflow-wrap: anywhere; }
.text-block-outlets p { margin: 3px 0 0; font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.text-outlet-number { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 19px; flex-shrink: 0; border-radius: 5px; color: var(--block-color); background: #edf0f7; font-size: 11px; font-weight: 700; }
.text-block-ports { position: absolute; bottom: 0; left: 0; width: 100%; }
.text-block-port { position: absolute; top: 0; transform: translate(-50%, -50%); display: flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box; background: var(--block-color); color: #fff; font-size: 10px; }
.text-block-port:empty { min-width: 7px; height: 7px; }
.text-block-port.port-unconnected { background: #fff; border: 1px solid #c4ccd7; color: #9aa5b3; }
.text-flow-warning { margin: 10px 16px 0; padding: 8px; border-radius: 5px; background: #fff7e6; color: #a9762c; font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
.text-flow-end { margin: 10px 18px 0; font-size: 11px; color: #929daa; }
.text-preview-empty { flex: 1; display: grid; place-content: center; padding: 30px; font-size: 14px; color: #8a98ab; }
</style>
