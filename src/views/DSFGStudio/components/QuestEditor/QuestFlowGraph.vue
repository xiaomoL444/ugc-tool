<script setup lang="ts">
import StudioSelectField from "../StudioSelectField.vue";
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from "vue";
import { studioEditorActiveKey } from "../studioSessionHistory";
import { VueFlow, Handle, Position, MarkerType, useVueFlow, type Node, type Edge, type Connection, type NodeDragEvent, type NodeMouseEvent, type EdgeMouseEvent } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { toast } from "vue-sonner";
import type { QuestProject, QuestSelection } from "./types";
import { buildQuestFlow, connectQuestFlow, disconnectQuestFlow, layoutQuestFlowGroups, fitQuestFlowGroupBounds, questFlowAbsolutePositions, questNodeId, QUEST_FLOW_PAGE_SIZE, type QuestFlowBox, type QuestFlowEdge } from "./questFlow";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = defineProps<{ project: QuestProject; selection: QuestSelection | null }>();
const emit = defineEmits<{ (event: "select", id: number): void; (event: "edit", id: number): void }>();
const flowId = `quest-flow-${crypto.randomUUID()}`;
const editorActive = inject(studioEditorActiveKey, () => true);
const { fitView, zoomIn, zoomOut, panBy } = useVueFlow(flowId);
const panning = ref(false);
let cancelPan: (() => void) | undefined;

// Group backgrounds also carry Vue Flow's no-pan class. Capture their left drags,
// while leaving group headings, task cards and connection handles to native node interactions.
function startCanvasPan(event: PointerEvent) {
  if (!editorActive()) return;
  const target = event.target as Element | null;
  const groupBackground = target?.closest(".flow-group") && !target.closest(".group-heading");
  if (event.button !== 2 && !(event.button === 0 && groupBackground)) return;
  event.preventDefault();
  event.stopPropagation();
  cancelPan?.();
  const pointerId = event.pointerId;
  let x = event.clientX, y = event.clientY;
  panning.value = true;
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    next.preventDefault();
    panBy({ x: next.clientX - x, y: next.clientY - y });
    x = next.clientX; y = next.clientY;
  };
  const end = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", cleanup);
    panning.value = false;
    cancelPan = undefined;
  };
  cancelPan = cleanup;
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", cleanup);
}
onBeforeUnmount(() => cancelPan?.());
watch(editorActive, active => { if (!active) cancelPan?.(); }, { flush: "sync" });
const mainId = ref<number | null>(null);
const page = ref(0);
const nodes = ref<Node[]>([]);
const edges = ref<Edge[]>([]);
const selectedEdge = ref<QuestFlowEdge>();
const positions = new Map<string, { x: number; y: number }>();
const parents = new Map<string, string | undefined>();
const projection = computed(() => buildQuestFlow(props.project, mainId.value, page.value));
const selectedSub = computed(() => props.selection?.kind === "sub" ? props.project.subQuests.find(sub => sub.id === props.selection?.id) : undefined);
let fittedScope = "";
let active = true;

function fit() { void nextTick(() => { if (active && editorActive()) void fitView({ padding: .22, duration: 250, maxZoom: 1 }); }); }
onActivated(() => { active = true; fit(); });
onDeactivated(() => { active = false; cancelPan?.(); });
function updateNodes(result: ReturnType<typeof buildQuestFlow>, reset = false) {
  const boxes = layoutQuestFlowGroups(result.nodes, result.edges, result.groups);
  if (reset) { positions.clear(); parents.clear(); }
  // Cache canvas coordinates so resizing a parent or changing pages never shifts its children.
  const absolute = questFlowAbsolutePositions(boxes);
  boxes.forEach((box, id) => {
    const saved = positions.get(id);
    if (saved && parents.get(id) === box.parentId) absolute.set(id, saved);
  });
  boxes.forEach((box, id) => {
    const position = absolute.get(id)!;
    const parent = box.parentId ? absolute.get(box.parentId)! : { x: 0, y: 0 };
    box.position = { x: position.x - parent.x, y: position.y - parent.y };
  });
  fitQuestFlowGroupBounds(boxes, result.groups);
  rememberPositions(boxes);
  function geometry(id: string) {
    const box = boxes.get(id)!;
    return { position: box.position, parentNode: box.parentId, width: box.width, height: box.height };
  }
  // Vue Flow needs parents before children to resolve nested positions.
  nodes.value = [
    ...result.groups.map(group => ({ id: group.id, type: "quest-group", ...geometry(group.id), data: group,
      draggable: true, dragHandle: ".group-heading", selectable: false, connectable: false, zIndex: group.kind === "chapter" ? 0 : 1 })),
    ...result.nodes.map(node => ({ id: node.id, type: "quest", ...geometry(node.id), data: node,
      selected: node.questId === selectedSub.value?.id, draggable: true, connectable: !node.missing, zIndex: 3 })),
  ];
}
watch(projection, result => {
  selectedEdge.value = undefined;
  updateNodes(result);
  edges.value = result.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target,
    // Vue Flow adds one level for each parent: main groups render at 2, task cards at 4.
    // Keep the entire edge (path, arrow and label) above group fills and below task cards.
    sourceHandle: edge.kind, targetHandle: "in", type: "smoothstep", data: edge, zIndex: 3,
    label: edge.kind === "failure" ? "失败回溯" : `后续 ${edge.index + 1}`,
    markerEnd: { type: MarkerType.ArrowClosed, color: edge.kind === "failure" ? "#d89a51" : "#185abd" },
    style: { stroke: edge.kind === "failure" ? "#d89a51" : "#185abd", strokeWidth: edge.kind === "failure" ? 2 : 3, strokeDasharray: edge.kind === "failure" ? "6 4" : undefined },
    labelStyle: { fill: edge.kind === "failure" ? "#667997" : "#17417b", fontSize: 11, fontWeight: edge.kind === "failure" ? 400 : 600 }, labelBgStyle: { fill: "#fff", fillOpacity: 1 },
  }));
  const scope = `${mainId.value}:${result.page}`;
  if (scope !== fittedScope) { fittedScope = scope; fit(); }
}, { immediate: true });

watch(() => props.selection, selection => {
  if (selection?.kind === "main") { mainId.value = selection.id; page.value = 0; }
  if (selection?.kind === "sub") {
    const selected = props.project.subQuests.find(sub => sub.id === selection.id);
    if (selected) {
      if (mainId.value !== null && mainId.value !== selected.mainQuestId) mainId.value = selected.mainQuestId;
      const filtered = props.project.subQuests.filter(sub => mainId.value === null || sub.mainQuestId === mainId.value);
      page.value = Math.floor(filtered.findIndex(sub => sub.id === selected.id) / QUEST_FLOW_PAGE_SIZE);
    }
  }
  nodes.value = nodes.value.map(node => ({ ...node, selected: selection?.kind === "sub" && node.id === questNodeId(selection.id) }));
}, { immediate: true });
watch(() => props.project, () => { cancelPan?.(); positions.clear(); parents.clear(); mainId.value = null; page.value = 0; fittedScope = ""; }, { flush: "sync" });

function changeMain(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  mainId.value = value === "" ? null : Number(value);
  page.value = 0;
}
function arrange() {
  updateNodes(projection.value, true);
  fit();
}
function rememberPositions(boxes: Map<string, QuestFlowBox>) {
  questFlowAbsolutePositions(boxes).forEach((position, id) => positions.set(id, position));
  boxes.forEach((box, id) => parents.set(id, box.parentId));
}
function dragStop(event: NodeDragEvent) {
  const dragged = new Map(event.nodes.map(node => [node.id, node.position]));
  const boxes = new Map<string, QuestFlowBox>(nodes.value.map(node => [node.id, {
    position: { ...(dragged.get(node.id) ?? node.position) }, parentId: node.parentNode,
    width: Number(node.width) || 226, height: Number(node.height) || 132,
  }]));
  fitQuestFlowGroupBounds(boxes, projection.value.groups);
  // Update in place while dragging to preserve Vue Flow's active drag session.
  nodes.value.forEach(node => {
    const box = boxes.get(node.id)!;
    node.position = box.position; node.width = box.width; node.height = box.height;
  });
  rememberPositions(boxes);
}
function selectNode({ node }: NodeMouseEvent) {
  selectedEdge.value = undefined;
  if (node.type !== "quest") return;
  if (!node.data.missing && node.data.questId !== null) emit("select", node.data.questId);
}
function editNode({ node }: NodeMouseEvent) {
  if (node.type !== "quest") return;
  if (!node.data.missing && node.data.questId !== null) emit("edit", node.data.questId);
}
function selectEdge({ edge }: EdgeMouseEvent) { selectedEdge.value = projection.value.edges.find(item => item.id === edge.id); }
function connect(connection: Connection) {
  const source = projection.value.nodes.find(node => node.id === connection.source);
  const target = projection.value.nodes.find(node => node.id === connection.target);
  if (!source || !target || source.missing || target.missing || source.questId === null || target.questId === null) return;
  const message = connectQuestFlow(props.project, source.questId, target.questId, connection.sourceHandle === "failure" ? "failure" : "next");
  if (message) toast.warning(message);
}
function removeLink() {
  if (selectedEdge.value) disconnectQuestFlow(props.project, selectedEdge.value);
  selectedEdge.value = undefined;
}
</script>

<template>
  <section class="quest-flow" aria-label="任务衔接图">
    <header class="flow-toolbar">
      <div class="scope-control"><strong>任务衔接</strong><StudioSelectField :value="mainId ?? ''" aria-label="衔接图主任务范围" @change="changeMain"><option value="">全部主任务</option><option v-for="main in project.mainQuests" :key="main.id" :value="main.id">{{ main.title || '未命名主任务' }} #{{ main.id }}</option></StudioSelectField></div>
      <div class="flow-controls"><button type="button" @click="arrange">整理布局</button><button type="button" @click="fit">适应画布</button><button type="button" aria-label="缩小任务图" @click="zoomOut()">−</button><button type="button" aria-label="放大任务图" @click="zoomIn()">＋</button></div>
    </header>
    <div class="flow-guide"><span class="legend-next">后续任务</span><span class="legend-failure">失败回溯</span><span>自由拖动子任务，外框自动包裹 · 拖动分组标题整体移动 · 双击子任务编辑属性</span></div>
    <p v-if="projection.omitted" class="flow-warning" role="status">当前图省略了 {{ projection.omitted }} 条连线，任务数据完整保留。可切换主任务或在任务属性中查看全部衔接。</p>
    <div class="flow-canvas" :class="{ 'is-panning': panning }" @pointerdown.capture="startCanvasPan" @contextmenu.prevent>
      <VueFlow v-if="nodes.length" :id="flowId" v-model:nodes="nodes" v-model:edges="edges" :min-zoom=".15" :max-zoom="1.6" :delete-key-code="null" :disable-keyboard-a11y="!editorActive()" :edges-updatable="false" :pan-on-drag="[0]" fit-view-on-init
        @connect="connect" @node-click="selectNode" @node-double-click="editNode" @node-drag="dragStop" @node-drag-stop="dragStop" @edge-click="selectEdge" @pane-click="selectedEdge = undefined">
        <template #node-quest-group="slot">
          <div class="flow-group" :class="'group-' + slot.data.kind">
            <header class="group-heading" :title="'拖动整体移动：' + slot.data.title">
              <span class="group-kind">{{ slot.data.kind === 'chapter' ? (slot.data.entityId === null ? '直属' : '章节') : '主任务' }}</span>
              <strong>{{ slot.data.title }}</strong><small v-if="slot.data.entityId !== null">#{{ slot.data.entityId }}</small>
              <span class="group-count">{{ slot.data.count === slot.data.total ? slot.data.total : slot.data.count + '/' + slot.data.total }} {{ slot.data.kind === 'chapter' ? '个主任务' : '个子任务' }}</span>
            </header>
            <span v-if="!slot.data.count" class="group-empty">{{ slot.data.kind === 'chapter' ? '暂无主任务' : '暂无子任务' }}</span>
          </div>
        </template>
        <template #node-quest="slot">
          <div class="flow-node" :class="{ 'is-selected': slot.selected, 'is-boundary': slot.data.boundary, 'is-missing': slot.data.missing }">
            <Handle id="in" type="target" :position="Position.Left" :connectable="!slot.data.missing" />
            <div class="node-meta"><span>{{ slot.data.questId === null ? '空引用' : '#' + slot.data.questId }}</span><span v-if="slot.data.boundary && !slot.data.missing">范围外关联</span></div>
            <strong :title="slot.data.title">{{ slot.data.title }}</strong><small :title="slot.data.parent">{{ slot.data.parent }}</small>
            <div v-if="!slot.data.missing && !slot.data.boundary" class="node-ports"><span v-if="slot.data.finish" class="finish-tag">完成主任务</span><span class="port-label next-port">后续</span><span class="port-label failure-port">回溯</span></div>
            <Handle v-if="!slot.data.missing && !slot.data.boundary" id="next" type="source" :position="Position.Right" :style="{ top: '78px' }" />
            <Handle v-if="!slot.data.missing && !slot.data.boundary" id="failure" type="source" :position="Position.Right" :style="{ top: '108px', background: '#d89a51' }" />
          </div>
        </template>
        <Background pattern-color="#aab9d5" :gap="22" :size="1" />
      </VueFlow>
      <div v-else class="flow-empty"><strong>从子任务开始建立衔接</strong><p>在左侧选择主任务，再点击上方「＋ 子任务」。</p></div>
    </div>
    <footer class="flow-footer">
      <div v-if="selectedEdge" class="selection-actions"><span>#{{ selectedEdge.sourceId }} → {{ selectedEdge.targetId === null ? '空引用' : '#' + selectedEdge.targetId }} · {{ selectedEdge.kind === 'failure' ? '失败回溯' : '后续第 ' + (selectedEdge.index + 1) + ' 项' }}</span><button type="button" class="danger" @click="removeLink">移除此连线</button></div>
      <div v-else-if="selectedSub" class="selection-actions"><span>{{ selectedSub.title || '未命名子任务' }} · #{{ selectedSub.id }}</span><button type="button" @click="emit('edit', selectedSub.id)">编辑任务属性</button></div>
      <span v-else>点击连线可移除关联；拖动卡片可调整布局。</span>
      <div v-if="projection.pageCount > 1" class="flow-pages"><button type="button" :disabled="projection.page === 0" @click="page = projection.page - 1">上一页</button><span>{{ projection.page + 1 }}/{{ projection.pageCount }} · {{ projection.total }} 个子任务</span><button type="button" :disabled="projection.page + 1 >= projection.pageCount" @click="page = projection.page + 1">下一页</button></div>
    </footer>
  </section>
</template>

<style scoped>
.quest-flow { display: flex; flex-direction: column; min-height: 0; height: 100%; min-width: 0; color: #415675; text-align: left; }
.flow-toolbar, .flow-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px 16px; }
.flow-toolbar { border-bottom: 1px solid #dde5f4; background: #ffffffa8; }
.scope-control, .flow-controls, .selection-actions, .flow-pages { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.scope-control strong { font-size: 14px; margin-right: 6px; }
button, select { font: inherit; font-size: 12px; color: #526c91; background: #fff; border: 1px solid #d6e1f3; border-radius: 6px; padding: 7px 10px; }
.studio-select-field { max-width: 260px; }
button { cursor: pointer; }
button:hover:not(:disabled) { background: #edf5ff; border-color: #94bce9; }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, select:focus-visible { outline: 2px solid #6ba4ef; outline-offset: 2px; }
.flow-guide { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; padding: 10px 16px; font-size: 11px; color: #8191ad; }
.legend-next::before, .legend-failure::before { content: ''; display: inline-block; width: 22px; margin-right: 6px; vertical-align: middle; border-top: 2px solid #185abd; }
.legend-next::before { border-top-width: 3px; }
.legend-failure::before { border-color: #d89a51; border-top-style: dashed; }
.flow-warning { margin: 0; padding: 8px 16px; background: #fff7e8; color: #986724; font-size: 12px; }
.flow-canvas { flex: 1; min-height: 280px; position: relative; border-block: 1px solid #e1e7f4; background: #f5f8ff60; }
.flow-canvas.is-panning, .flow-canvas.is-panning :deep(*) { cursor: grabbing !important; user-select: none; }
.flow-node { box-sizing: border-box; position: relative; width: 226px; height: 132px; padding: 12px 16px; border: 1px solid #cbd9f2; border-top: 3px solid #36a7ee; border-radius: 10px; background: #fff; box-shadow: 0 3px 12px #4b669412; }
.flow-group { position: relative; box-sizing: border-box; width: 100%; height: 100%; border: 1px solid #b5a7e6; border-radius: 16px; background: #f1edff70; color: #8772bd; cursor: grab; }
.flow-group.group-main { border-color: #9fc4e8; border-radius: 12px; background: #f3f9ffbf; color: #5282b5; }
.group-heading { display: flex; align-items: center; gap: 8px; position: absolute; left: 16px; right: 16px; top: 12px; height: 30px; cursor: grab; user-select: none; white-space: nowrap; }
.group-heading:active { cursor: grabbing; }
.group-heading strong { overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
.group-heading small { flex-shrink: 0; opacity: .7; font-size: 10px; }
.group-kind { flex-shrink: 0; padding: 3px 6px; border-radius: 5px; background: #e8e0fa; font-size: 10px; }
.group-main .group-kind { background: #deedfb; }
.group-count { flex-shrink: 0; margin-left: auto; padding-left: 10px; font-size: 10px; opacity: .8; }
.group-empty { position: absolute; top: 74px; left: 26px; opacity: .6; font-size: 12px; }
.flow-node.is-selected { border-color: #669eed; box-shadow: 0 0 0 3px #659bea25; }
.flow-node.is-boundary { background: #f6f8fd; border-style: dashed; }
.flow-node.is-missing { border-color: #e2b47f; background: #fffaf2; }
.node-meta { display: flex; justify-content: space-between; gap: 8px; color: #879ab6; font-size: 10px; }
.flow-node strong { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; margin-top: 8px; color: #3c5278; font-size: 14px; }
.flow-node small { display: block; max-width: 145px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 7px; color: #8e9db6; font-size: 11px; }
.port-label { position: absolute; right: 12px; font-size: 10px; }
.next-port { top: 70px; color: #5493d3; }
.failure-port { top: 100px; color: #b58851; }
.finish-tag { display: inline-block; color: #519d87; background: #edf8f4; border-radius: 4px; padding: 2px 5px; margin-top: 8px; font-size: 10px; }
:deep(.vue-flow__handle) { width: 9px; height: 9px; background: #649ce1; border: 2px solid #fff; }
:deep(.vue-flow__edge.selected .vue-flow__edge-path) { stroke-width: 4; }
.flow-footer { font-size: 11px; color: #8493ab; background: #ffffff94; }
.selection-actions > span { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.danger { color: #b76464; }
.flow-empty { height: 100%; display: flex; align-items: center; justify-content: center; flex-direction: column; color: #8c9bb2; }
.flow-empty strong { color: #5d7395; font-size: 16px; }
.flow-empty p { font-size: 12px; }
</style>
