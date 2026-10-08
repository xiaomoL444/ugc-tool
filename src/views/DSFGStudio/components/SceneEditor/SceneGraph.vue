<script setup lang="ts">
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from "vue";
import { studioEditorActiveKey } from "../studioSessionHistory";
import { VueFlow, Handle, Position, MarkerType, useVueFlow, type Node, type Edge, type NodeMouseEvent, type NodeDragEvent } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import type { SceneProject } from "./sceneProject";
import { buildSceneGraph, type SceneSelection } from "./sceneGraph";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = defineProps<{ project: SceneProject; selection: SceneSelection }>();
const emit = defineEmits<{ select: [selection: SceneSelection]; edit: [selection: SceneSelection] }>();
const flowId = `scene-graph-${crypto.randomUUID()}`;
const editorActive = inject(studioEditorActiveKey, () => true);
const { fitView, zoomIn, zoomOut, panBy } = useVueFlow(flowId);
const nodes = ref<Node[]>([]);
const edges = ref<Edge[]>([]);
const positions = new Map<string, { x: number; y: number }>();
const projection = computed(() => buildSceneGraph(props.project));
const selectedBox = computed(() => projection.value.boxes.find(box => box.data.selection?.kind === props.selection.kind && box.data.selection.index === props.selection.index));
const panning = ref(false);
let disposed = false;
let active = true;
let cancelPan: (() => void) | undefined;
function fit() { void nextTick(() => { if (!disposed && active && editorActive()) void fitView({ padding: .18, duration: 250, maxZoom: 1 }); }); }
onActivated(() => { active = true; fit(); });
onDeactivated(() => { active = false; cancelPan?.(); });
watch(editorActive, active => { if (!active) cancelPan?.(); }, { flush: "sync" });
function sync() {
  nodes.value = projection.value.boxes.map(box => ({ id: box.id, type: "scene-area", position: positions.get(box.id) ?? box.position,
    parentNode: box.parentId, width: box.width, height: box.height, data: box.data,
    draggable: !box.parentId, dragHandle: ".area-heading", connectable: false, selectable: false,
    zIndex: box.data.kind === "world" ? 0 : box.data.kind === "main" ? 1 : 2 }));
  edges.value = projection.value.edges.map(edge => ({ ...edge, sourceHandle: "out", targetHandle: "in", type: "smoothstep",
    style: { stroke: "#185abd", strokeWidth: 3 }, zIndex: 5, selectable: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#185abd", width: 22, height: 22 },
    labelStyle: { fill: "#17417b", fontSize: 11 }, labelBgStyle: { fill: "#fff", fillOpacity: .95 }, labelBgPadding: [6, 4] }));
}
watch(() => props.project, () => { positions.clear(); cancelPan?.(); }, { flush: "sync" });
watch(projection, sync, { immediate: true });
function arrange() { positions.clear(); sync(); fit(); }
function selectNode({ node }: NodeMouseEvent) { if (node.data.selection) emit("select", node.data.selection); }
function editNode({ node }: NodeMouseEvent) { if (node.data.selection) emit("edit", node.data.selection); }
function remember({ node }: NodeDragEvent) { if (!node.parentNode) positions.set(node.id, { ...node.position }); }
function isSelected(data: { selection?: SceneSelection }) { return data.selection?.kind === props.selection.kind && data.selection.index === props.selection.index; }
function startPan(event: PointerEvent) {
  if (!editorActive()) return;
  const target = event.target as Element | null;
  const background = target?.closest(".area-group") && !target.closest(".area-heading");
  if (event.button !== 2 && !(event.button === 0 && background)) return;
  event.preventDefault(); event.stopPropagation(); cancelPan?.();
  const pointerId = event.pointerId;
  let x = event.clientX, y = event.clientY;
  panning.value = true;
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    next.preventDefault(); panBy({ x: next.clientX - x, y: next.clientY - y });
    x = next.clientX; y = next.clientY;
  };
  const end = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
  const cleanup = () => {
    window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end); window.removeEventListener("blur", cleanup);
    panning.value = false; cancelPan = undefined;
  };
  cancelPan = cleanup;
  window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end); window.addEventListener("blur", cleanup);
}
onBeforeUnmount(() => { disposed = true; cancelPan?.(); });
</script>

<template>
  <section class="scene-graph" aria-label="场景示意图">
    <div class="graph-toolbar">
      <span>世界 → 一级区域 → 二级区域</span>
      <div class="graph-actions"><button type="button" @click="arrange">整理布局</button><button type="button" @click="fit">适应画布</button><button type="button" aria-label="缩小场景示意图" @click="zoomOut()">−</button><button type="button" aria-label="放大场景示意图" @click="zoomIn()">＋</button></div>
    </div>
    <p class="graph-guide"><span class="link-legend">世界连接</span>拖动世界标题整体移动 · 空白区域或右键拖动画布 · 双击区域编辑属性</p>
    <p v-for="warning in projection.warnings" :key="warning" class="graph-warning" role="status">{{ warning }}</p>
    <div class="graph-canvas" :class="{ 'is-panning': panning }" @pointerdown.capture="startPan" @contextmenu.prevent>
      <VueFlow v-if="nodes.length" :id="flowId" v-model:nodes="nodes" v-model:edges="edges" :min-zoom=".08" :max-zoom="1.6" :pan-on-drag="[0]" :delete-key-code="null" :disable-keyboard-a11y="!editorActive()" :nodes-connectable="false" :edges-updatable="false" :zoom-on-double-click="false" fit-view-on-init
        @node-click="selectNode" @node-double-click="editNode" @node-drag-stop="remember">
        <template #node-scene-area="slot">
          <div class="area-box" :class="['area-' + slot.data.kind, { 'area-group': slot.data.kind !== 'sub', 'is-selected': isSelected(slot.data), 'is-missing': slot.data.missing }]">
            <template v-if="slot.data.kind === 'world' && slot.data.selection"><Handle id="in" type="target" :position="Position.Left" :connectable="false" /><Handle id="out" type="source" :position="Position.Right" :connectable="false" /></template>
            <div class="area-heading" :title="slot.data.title"><span class="area-kind">{{ slot.data.kind === 'world' ? '世界' : slot.data.kind === 'main' ? '一级' : '二级' }}</span><strong>{{ slot.data.title }}</strong><small v-if="slot.data.entityId !== undefined">#{{ slot.data.entityId }}</small></div>
            <span v-if="slot.data.kind !== 'sub'" class="area-count">{{ slot.data.count }} 个{{ slot.data.kind === 'world' ? '一级区域' : '二级区域' }}</span>
            <span v-if="slot.data.kind !== 'sub' && !slot.data.count" class="area-empty">暂无下属区域</span>
          </div>
        </template>
        <Background :gap="24" :size="1" pattern-color="#c3cce4" />
      </VueFlow>
      <div v-else class="graph-empty">暂无世界，点击右上角“新增世界”开始。</div>
    </div>
    <div class="graph-footer"><template v-if="selectedBox?.data.selection"><span>{{ selectedBox.data.title }} · #{{ selectedBox.data.entityId }}</span><button type="button" @click="emit('edit', selectedBox.data.selection)">编辑所选属性</button></template><span v-else>选择世界或区域查看属性</span></div>
  </section>
</template>

<style scoped>
.scene-graph { display: flex; flex-direction: column; height: clamp(460px, 68vh, 900px); min-height: 380px; border: 1px solid #d4d8f4; border-radius: 10px; overflow: hidden; color: #405477; background: #ffffff40; }
.graph-toolbar, .graph-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 12px 16px; background: #ffffff9c; font-size: 13px; }
.graph-actions { display: flex; gap: 8px; flex-wrap: wrap; }
button { border: 1px solid #cbd8ee; border-radius: 6px; padding: 7px 10px; color: #42659b; background: #fff; cursor: pointer; font: inherit; font-size: 12px; }
button:hover { background: #edf5ff; } button:focus-visible { outline: 2px solid #6ba4ef; outline-offset: 2px; }
.graph-guide { display: flex; flex-wrap: wrap; gap: 14px; padding: 10px 16px; margin: 0; color: #7585a3; font-size: 11px; }
.link-legend { color: #185abd; } .link-legend::before { content: ''; display: inline-block; width: 22px; border-top: 3px solid #185abd; margin-right: 6px; vertical-align: middle; }
.graph-warning { margin: 0; padding: 6px 16px; font-size: 12px; background: #fff8e6; color: #96691c; }
.graph-canvas { position: relative; flex: 1; min-height: 280px; border-block: 1px solid #dce3f4; }
.graph-canvas.is-panning, .graph-canvas.is-panning :deep(*) { cursor: grabbing !important; user-select: none; }
.graph-empty { display: grid; place-items: center; height: 100%; color: #8391ae; font-size: 13px; }
.area-box { box-sizing: border-box; width: 100%; height: 100%; position: relative; border: 1px solid #b1a1e4; border-radius: 14px; background: #f0ecffb8; color: #7963ab; }
.area-main { border-color: #9cbee9; background: #eff6ffeb; color: #406c9f; border-radius: 10px; }
.area-sub { border-color: #cad8ee; border-top: 3px solid #00a9eb; background: white; color: #405477; border-radius: 8px; box-shadow: 0 3px 10px #3550800d; }
.area-heading { position: absolute; inset: 12px 16px auto; display: flex; align-items: center; gap: 8px; height: 24px; cursor: pointer; white-space: nowrap; }
.area-world > .area-heading { cursor: grab; } .area-world > .area-heading:active { cursor: grabbing; }
.area-heading strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
.area-kind { padding: 2px 5px; border-radius: 4px; background: #e4def9; flex-shrink: 0; font-size: 10px; }
.area-main .area-kind { background: #dcebf9; } .area-sub .area-kind { background: #e5f5fc; color: #2284ac; }
.area-heading small { margin-left: auto; font-size: 10px; flex-shrink: 0; opacity: .8; }
.area-count { position: absolute; top: 40px; left: 16px; font-size: 10px; opacity: .8; }
.area-sub .area-heading { inset: 0 12px; height: 100%; flex-wrap: wrap; align-content: center; gap: 4px 6px; }
.area-sub .area-heading strong { flex: 1; font-size: 13px; } .area-sub .area-heading small { flex-basis: 100%; }
.area-empty { position: absolute; top: 78px; left: 24px; font-size: 12px; opacity: .7; }
.area-box.is-selected { border-color: #1689ed; box-shadow: 0 0 0 2px #1689ed55; }
.area-box.is-missing { border-style: dashed; border-color: #d3a452; }
:deep(.vue-flow__node-scene-area) { padding: 0; border: 0; background: transparent; }
:deep(.vue-flow__handle) { width: 8px; height: 8px; background: #185abd; border: 2px solid white; }
</style>
