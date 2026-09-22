<script setup lang="ts">
import { computed, ref, type HTMLAttributes } from "vue";
import { NSelect } from "naive-ui";
import { useStylePresets } from "../../../EntityPresetEditor/stylePresets";
import type { PerformanceClip } from "../../types/DialogueNode";
import { CAMERA_CLIP_COMPONENT_TEMPLATE } from "../../config/cameraClip";
import { createClipComponent } from "../../config/clipComponentRegistry";
import { createClipPropertyValues } from "../../utils/clipProperties";
import CameraMotionEditor from "./CameraMotionEditor.vue";
import ClipComponentsEditor from "./ClipComponentsEditor.vue";

const props = defineProps<{ clip: PerformanceClip }>();
// The teleported menu belongs to this editor, not the outside-click area.
const clipMenuProps: HTMLAttributes & { "data-clip-editor": string } = { "data-clip-editor": "" };
const { options: cameraPresets, ready, error, retry } = useStylePresets("cameras");
const cameraOptions = computed(() => {
  const options = cameraPresets.value.map(item => ({ value: item.value, label: `${item.label} · ${item.value}` }));
  const current = String(values.value.cameraName ?? "");
  if (!options.some(item => item.value === current)) options.push({ value: current, label: current || "未设置" });
  return options;
});
const tab = ref<"position" | "rotation">("position");
const shots = computed(() => props.clip.components.filter(item => item.templateId === "camera.shot"));
// Match the final enabled camera component used by the existing exporter.
const shot = computed(() => [...shots.value].reverse().find(item => item.enabled) ?? shots.value[0]);
const viewpointEnabled = computed(() => shot.value?.cameraViewpointEnabled !== false);
const values = computed(() => createClipPropertyValues(CAMERA_CLIP_COMPONENT_TEMPLATE.properties, shot.value?.properties));
function update(key: string, value: unknown) {
  if (!shot.value) return;
  const id = shot.value.id;
  props.clip.components = props.clip.components.map(item => item.id === id ? { ...item, properties: { ...item.properties, [key]: value } } : item);
}
function addShot() { if (!shots.value.length) props.clip.components = [...props.clip.components, createClipComponent("camera.shot")]; }
function setViewpointEnabled(event: Event) {
  const id = shot.value?.id;
  props.clip.components = props.clip.components.map(item => item.id === id ? { ...item, cameraViewpointEnabled: (event.target as HTMLInputElement).checked } : item);
}
function mode(key: string) { return String((values.value[key] as Record<string, unknown>).type || "未设置"); }
</script>

<template>
  <div class="camera-editor">
    <div v-if="shot" class="camera-basics">
      <label>镜头名称<NSelect :value="String(values.cameraName ?? '')" :options="cameraOptions" :disabled="!ready" filterable
        :menu-props="clipMenuProps"
        placeholder="搜索镜头名称" aria-label="相机预设" @update:value="update('cameraName', $event)" /></label>
      <p v-if="error" class="camera-notice" role="alert">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></p>
    </div>
    <template v-if="shot">
      <p v-if="!shot.enabled" class="camera-notice">此镜头参数已停用，可在高级设置中重新启用。</p>
      <p v-if="shots.length > 1" class="camera-notice">存在多份镜头参数，请在下方高级设置中整理。当前编辑最后一份已启用的参数。</p>
      <div class="motion-tabs" role="group" aria-label="镜头配置">
        <button type="button" :aria-pressed="tab === 'position'" @click="tab = 'position'"><span>相机位置</span><small>{{ mode('positionData') }}</small></button>
        <button type="button" :aria-pressed="tab === 'rotation'" @click="tab = 'rotation'"><span>视点位置</span><small>{{ viewpointEnabled ? mode('rotationData') : '未配置' }}</small></button>
      </div>
      <label v-if="tab === 'rotation'" class="viewpoint-toggle"><input type="checkbox" :checked="viewpointEnabled" @change="setViewpointEnabled" />配置视点位置<small>可选</small></label>
      <p v-if="tab === 'rotation' && !viewpointEnabled" class="viewpoint-empty">当前只配置相机位置。勾选后可设置视点的位置与移动方式。</p>
      <CameraMotionEditor v-else :key="tab" :kind="tab" :model-value="values[tab === 'position' ? 'positionData' : 'rotationData']" @update:model-value="update(tab === 'position' ? 'positionData' : 'rotationData', $event)" />
    </template>
    <button v-else type="button" class="restore-shot" @click="addShot">＋ 添加镜头参数</button>
    <details class="camera-advanced"><summary>高级设置<span>组件与自定义属性</span></summary><ClipComponentsEditor :clip="clip" /></details>
  </div>
</template>

<style scoped>
.camera-editor { color: var(--timeline-text, #cdd9e8); font-size: 12px; }
.camera-basics { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.camera-basics label { display: grid; gap: 7px; color: var(--timeline-muted, #91a4bc); font-size: 11px; }
.motion-tabs { display: flex; gap: 6px; margin-top: 16px; padding: 4px; border-radius: 9px; background: var(--timeline-surface, #111b29); }
.motion-tabs button { display: flex; flex: 1; align-items: center; justify-content: space-between; padding: 10px 12px; border: 0; border-radius: 6px; background: transparent; color: var(--timeline-muted, #8da1bb); cursor: pointer; }
.motion-tabs button[aria-pressed="true"] { background: var(--timeline-active, #2c405b); color: var(--timeline-active-text, #f0f5ff); box-shadow: 0 2px 5px #0002; }
.motion-tabs small { color: var(--timeline-accent, #93b6df); font-size: 10px; }
.viewpoint-toggle { display: flex; align-items: center; gap: 8px; margin: 16px 0; color: var(--timeline-text, #cdd9e8); font-size: 12px; }
.viewpoint-toggle input { width: 14px; height: 14px; padding: 0; margin: 0; accent-color: var(--timeline-accent, #74aafa); }
.viewpoint-toggle small { margin-left: auto; color: var(--timeline-subtle, #7d93af); font-size: 10px; }
.viewpoint-empty { padding: 16px; border: 1px dashed var(--timeline-border, #35455c); border-radius: 8px; color: var(--timeline-muted, #91a4bd); font-size: 12px; line-height: 1.7; }
.camera-editor :deep(button) { font-family: inherit; }
.camera-editor :deep(button:focus-visible), .camera-editor input:focus-visible { outline: 2px solid var(--timeline-accent, #83b4ff); outline-offset: 2px; }
.camera-editor :deep(.motion-modes) { display: flex; gap: 6px; margin: 14px 0 20px; }
.camera-editor :deep(.motion-modes button) { flex: 1; min-width: 0; display: grid; gap: 5px; padding: 9px 2px; border: 1px solid var(--timeline-border, #35455c); border-radius: 7px; background: transparent; color: var(--timeline-muted, #a6b6cc); cursor: pointer; }
.camera-editor :deep(.motion-modes button[aria-pressed="true"]) { background: var(--timeline-active, #253e5d); border-color: #73a7e9; color: var(--timeline-active-text, #dcecff); }
.camera-editor :deep(.motion-modes strong) { font-size: 11px; font-weight: 500; }
.camera-editor :deep(.motion-modes small) { font-size: 10px; opacity: .65; }
.camera-editor :deep(.slot-heading) { display: flex; gap: 8px; align-items: center; margin-bottom: 9px; font-size: 11px; }
.camera-editor :deep(.slot-heading small) { color: var(--timeline-subtle, #7d93af); margin-left: auto; }
.camera-editor :deep(.slot-heading button), .camera-editor :deep(.remove-slot) { padding: 0; border: 0; background: none; color: var(--timeline-accent, #93b9ea); cursor: pointer; font-size: 10px; }
.camera-editor :deep(.camera-slot) { padding: 12px; margin-top: 8px; border: 1px solid var(--timeline-border, #34445b); border-radius: 9px; background: var(--timeline-surface, #1a2535); }
.camera-editor :deep(.camera-slot header) { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.camera-editor :deep(.slot-index) { color: var(--timeline-subtle, #7997bc); font-family: inherit; font-size: 10px; }
.camera-editor :deep(.rot-hint) { margin: 10px 0 0; color: var(--timeline-subtle, #7d93af); font-size: 10px; }
.camera-editor :deep(.camera-slot strong) { font-size: 11px; font-weight: 500; }
.camera-editor :deep(.remove-slot) { margin-left: auto; color: var(--timeline-danger, #be98a0); }
.camera-editor :deep(.slot-fields) { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.camera-editor :deep(.slot-fields > .clip-property) { grid-column: 1 / -1; }
.camera-editor :deep(.slot-fields > .half-field) { grid-column: auto; }
.camera-editor :deep(.camera-motion .clip-property) { margin: 0; font-size: 11px; }
.camera-editor :deep(.camera-motion code) { display: none; }
.camera-editor :deep(.camera-motion .scalar-field), .camera-editor :deep(.camera-motion .boolean-field) { gap: 7px; }
.camera-editor :deep(.camera-motion input:not([type="checkbox"])), .camera-editor :deep(.camera-motion select) { padding: 8px; border-radius: 6px; border-color: var(--timeline-border, #36475f); background: var(--timeline-field, #121d2c); }
.camera-editor :deep(.camera-motion .vector-axes label) { background: var(--timeline-field, #121d2c); border: 1px solid var(--timeline-border, #36475f); border-radius: 6px; padding-left: 8px; gap: 2px; }
.camera-editor :deep(.camera-motion .vector-axes input) { border: 0; background: transparent; padding: 8px 4px; }
.camera-editor :deep(.camera-motion input[type="checkbox"]) { width: 14px; height: 14px; padding: 0; flex: 0 0 14px; accent-color: var(--timeline-accent, #74aafa); }
.camera-editor :deep(.add-target), .restore-shot { width: 100%; padding: 9px; margin-top: 8px; border: 1px dashed var(--timeline-border, #526c8d); border-radius: 7px; background: transparent; color: var(--timeline-accent, #a6c8ef); cursor: pointer; }
.camera-editor :deep(.motion-extras) { display: grid; gap: 14px; margin-top: 14px; padding: 12px; border-radius: 8px; background: var(--timeline-soft, #243249); }
.camera-editor :deep(.camera-notice) { color: var(--timeline-warning, #e9be7d); font-size: 11px; line-height: 1.6; }
.camera-advanced { margin-top: 22px; border-top: 1px solid var(--timeline-border, #354359); padding-top: 13px; }
.camera-advanced > summary { cursor: pointer; color: var(--timeline-muted, #91a4bd); font-size: 11px; }
.camera-advanced > summary span { margin-left: 10px; color: var(--timeline-subtle, #607891); font-size: 10px; }
</style>
