<template>
  <section ref="root" class="kf-timeline" tabindex="0" aria-label="关键帧时间轴" @keydown="handleKeyDown" @pointerdown="menu = null">
    <header class="kf-toolbar">
      <span class="kf-title" :title="animationName"><EditorIcon name="timeline" :size="16" /><span class="kf-animation-name">{{ animationName || '关键帧时间轴' }}</span></span>
      <button aria-label="回到起点" title="回到起点" @click="emit('rewind')"><EditorIcon name="skip-back" :size="15" /></button>
      <button :aria-label="playing ? '暂停时间轴' : '播放时间轴'" :title="playing ? '暂停 · 空格' : '播放 · 空格'" @click="emit('toggle-play')"><EditorIcon :name="playing ? 'pause' : 'play'" :size="15" /></button>
      <output>{{ formatTime(currentTime) }} s</output>
      <button class="kf-snap" :class="{ active: snapEnabled }" :aria-pressed="snapEnabled" aria-label="关键帧吸附" @click="emit('toggle-snap')"><EditorIcon name="magnet" :size="14" />吸附</button>
      <label class="kf-duration">序列时长<ScrubbableNumberInput :model-value="duration" :min="lastKeyTime || 0.01" :step="0.01" :scrub-speed="0.01" aria-label="关键帧序列时长" @update:model-value="changeDuration" /><span>s</span></label>
      <span class="kf-toolbar-hint">双击空白添加关键帧 · 拖动菱形调整时间</span>
    </header>
    <div class="kf-workspace">
      <div ref="scrollArea" class="kf-scroll" @scroll="menu = null">
        <div class="kf-grid">
          <div class="kf-row kf-ruler-row">
            <div class="kf-name kf-ruler-name">控件 / 属性轨道</div>
            <div class="kf-lane"><div ref="ruler" class="kf-track-content kf-ruler" role="slider" tabindex="0" aria-label="关键帧播放进度" :aria-valuemin="0" :aria-valuemax="safeDuration" :aria-valuenow="currentTime" @pointerdown="startSeek" @keydown="handleRulerKey">
              <span v-for="tick in ticks" :key="tick" class="kf-tick" :style="{ left: percent(tick) }">{{ formatTime(tick) }}</span>
            </div></div>
          </div>
          <div v-for="row in rows" :key="row.id" class="kf-row" :class="{ 'is-node': row.kind === 'node', 'is-selected': row.node.id === selectedNodeId }">
            <div v-if="row.kind === 'node'" class="kf-name kf-node-name" :style="{ paddingLeft: `${10 + row.depth * 12}px` }">
              <button class="kf-collapse" :aria-label="`${collapsed.has(row.node.id) ? '展开' : '折叠'} ${row.node.name}`" @click.stop="toggleCollapsed(row.node.id)">{{ collapsed.has(row.node.id) ? '▸' : '▾' }}</button>
              <button class="kf-node-select" :title="row.node.name" @click="emit('select-node', row.node.id)"><EditorIcon :name="row.node.type" :size="13" /><span>{{ row.node.name }}</span></button>
              <button class="kf-add-track" :aria-label="`为 ${row.node.name} 添加属性轨道`" title="添加可动画属性" @click.stop="emit('select-node', row.node.id); emit('add-track', row.node.id)"><EditorIcon name="plus" :size="13" /></button>
            </div>
            <div v-else class="kf-name kf-property-name" :class="{ 'selected-track': selection?.track.id === row.track.id }" :style="{ paddingLeft: `${28 + row.depth * 12}px` }">
              <button :title="row.track.fieldKey" @click="emit('select-node', row.node.id)">{{ fieldLabel(row.node, row.track) }}</button>
              <button class="kf-set-key" :aria-label="`为 ${fieldLabel(row.node, row.track)} 在播放头添加关键帧`" title="在当前时间添加 / 更新关键帧" @click.stop="addKey(row.track, currentTime)">◇</button>
            </div>
            <div class="kf-lane" :class="{ 'kf-node-lane': row.kind === 'node' }">
              <div class="kf-track-content" @pointerdown.self="startSeek" @dblclick.self="row.kind === 'track' && addKey(row.track, pointerTime($event.currentTarget as HTMLElement, $event.clientX))" @contextmenu.prevent.stop="row.kind === 'track' && openMenu($event, row.track)">
                <span v-for="tick in ticks" :key="tick" class="kf-gridline" :style="{ left: percent(tick) }" />
                <template v-if="row.kind === 'track'">
                  <span v-for="segment in segments(row.track)" :key="segment.id" class="kf-segment" :class="{ 'is-step': segment.step }" :style="{ left: percent(segment.start), width: percent(segment.end - segment.start) }" />
                  <button v-for="key in sortedKeys(row.track)" :key="key.id" class="kf-key" :class="{ selected: key.id === selectedKeyframeId, 'is-step': key.interpolation === 'step' }" :style="{ left: percent(key.time) }" :aria-label="`${fieldLabel(row.node, row.track)} · ${formatTime(key.time)} 秒关键帧`" :title="`${formatTime(key.time)}s · ${key.relative ? '增量 ' : ''}${formatValue(key.value)} · ${key.interpolation === 'step' ? '阶跃' : key.easeType}`" @pointerdown.stop="startKeyDrag($event, row.track, key)" @click.stop="selectKey(row.track, key)" @dblclick.stop @contextmenu.prevent.stop="openMenu($event, row.track, key)"><span /></button>
                </template>
              </div>
            </div>
          </div>
          <div class="kf-row kf-filler"><div class="kf-name" /><div class="kf-lane"><div class="kf-track-content" @pointerdown="startSeek"><span v-for="tick in ticks" :key="tick" class="kf-gridline" :style="{ left: percent(tick) }" /></div></div></div>
          <!-- Only the ruler handle accepts pointers. The full-height line must never cover keys. -->
          <div class="kf-playhead-area" aria-hidden="true"><div class="kf-playhead" :style="{ left: percent(currentTime) }"><button class="kf-playhead-handle" tabindex="-1" title="拖动播放进度" @pointerdown.stop="startSeek($event, ruler)" /></div></div>
          <div v-if="!nodes.length" class="kf-empty">先创建或导入控件，再添加属性关键帧。</div>
        </div>
      </div>
      <aside class="kf-inspector" aria-label="关键帧参数">
        <template v-if="selection">
          <header><span>◆ 关键帧</span><button aria-label="删除所选关键帧" title="删除关键帧" @click="removeSelectedKey"><EditorIcon name="trash" :size="14" /></button></header>
          <div class="kf-selection-name">{{ selection.node.name }} / {{ fieldLabel(selection.node, selection.track) }}</div>
          <p v-if="selection.key.value === null" role="status">当前帧尚未设置属性值，请填写后再导出。</p>
          <label class="kf-field">时间 <span class="kf-with-unit"><ScrubbableNumberInput :model-value="selection.key.time" :animated="true" :min="0" :max="safeDuration" :step="0.01" :scrub-speed="0.01" aria-label="关键帧时间" @update:model-value="changeKeyTime" /><i>s</i></span></label>
          <ColorRGBAField v-if="selection.field?.valueKind === 'color'" label="关键帧颜色" :model-value="selectedColor" :animated="true" @update:model-value="patchSelected({ value: $event })" />
          <label v-else class="kf-field">{{ selection.key.relative ? '增量值' : '属性值' }}<ScrubbableNumberInput :model-value="typeof selection.key.value === 'number' ? selection.key.value : null" :animated="true" :min="selection.key.relative ? undefined : selection.field?.min" :max="selection.key.relative ? undefined : selection.field?.max" :step="selection.field?.step ?? 0.01" :scrub-speed="selection.field?.scrubSpeed ?? 0.1" aria-label="关键帧属性值" @update:model-value="patchSelected({ value: $event })" /></label>
          <button v-if="isRelativeTweenField(selection.track.fieldKey)" class="kf-relative is-animated" data-animated="true" :class="{ active: selection.key.relative }" :aria-pressed="!!selection.key.relative" @click="patchSelected({ relative: !selection.key.relative })">{{ selection.key.relative ? '✓ ' : '' }}相对前帧增量</button>
          <label class="kf-field">到下一帧<select class="is-animated" data-animated="true" :value="selection.key.interpolation" aria-label="关键帧插值方式" @change="changeInterpolation"><option value="tween">补间</option><option value="step">阶跃（保持当前值）</option></select></label>
          <label class="kf-field">缓动<select class="is-animated" data-animated="true" :value="selection.key.easeType" :disabled="selection.key.interpolation === 'step'" aria-label="关键帧缓动" @change="changeEase"><option v-for="ease in tweenEaseOptions" :key="ease.value" :value="ease.value">{{ ease.label }}</option></select></label>
          <p>缓动与补间作用于当前帧 → 下一帧。最后一帧之后保持该帧值。</p>
        </template>
        <div v-else class="kf-inspector-empty"><span>◇</span>选择菱形关键帧<p>编辑时间、属性值与下一段补间。<br />右键属性轨道可添加关键帧。</p></div>
      </aside>
    </div>
    <footer class="kf-status" role="status">{{ notice || 'Ctrl+C / Ctrl+V 复制粘贴关键帧 · Delete 删除所选关键帧' }}</footer>
    <Teleport to="body"><div v-if="menu" class="kf-context-menu" role="menu" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" @pointerdown.stop @contextmenu.prevent>
      <button role="menuitem" @click="menuAddKey">在 {{ formatTime(menu.time) }} 秒添加关键帧</button>
      <button v-if="menu.keyId" role="menuitem" @click="menuDeleteKey">删除此关键帧</button>
      <button class="danger" role="menuitem" @click="menuDeleteTrack">删除属性轨道</button>
    </div></Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import EditorIcon from "./EditorIcon.vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import ColorRGBAField from "./ColorRGBAField.vue";
import { getTweenableField, isRelativeTweenField, isTweenEaseType, tweenEaseOptions } from "./tweenRegistry";
import type { ColorRGBA, UIKeyframe, UIKeyframeTrack, UINode, UITweenValue } from "./types";

const props = defineProps<{ nodes: UINode[]; tracks: UIKeyframeTrack[]; selectedNodeId: string | null; selectedKeyframeId: string | null; currentTime: number; duration: number; playing: boolean; snapEnabled: boolean; animationName?: string }>();
const emit = defineEmits<{
  (event: "select-node", nodeId: string): void;
  (event: "add-track", nodeId: string): void;
  (event: "select-keyframe", trackId: string, keyId: string): void;
  (event: "seek", time: number): void;
  (event: "update-duration", value: number): void;
  (event: "toggle-play" | "toggle-snap" | "rewind" | "begin-edit" | "end-edit"): void;
  (event: "upsert-keyframe", trackId: string, time: number): void;
  (event: "move-keyframe", trackId: string, keyId: string, time: number): void;
  (event: "update-keyframe", trackId: string, keyId: string, patch: Partial<UIKeyframe>): void;
  (event: "remove-keyframe", trackId: string, keyId: string): void;
  (event: "remove-track", trackId: string): void;
}>();
const root = ref<HTMLElement | null>(null);
const ruler = ref<HTMLElement | null>(null);
const scrollArea = ref<HTMLElement | null>(null);
const collapsed = ref(new Set<string>());
const notice = ref("");
const menu = ref<{ trackId: string; keyId?: string; time: number; x: number; y: number } | null>(null);
const clipboard = ref<{ trackId: string; key: UIKeyframe } | null>(null);
let stopDrag: (() => void) | null = null;
let pasteRevision = 0;
const EPS = 0.000001;
const safeDuration = computed(() => Number.isFinite(props.duration) && props.duration > 0 ? props.duration : 1);
const ticks = computed(() => Array.from({ length: 11 }, (_, index) => safeDuration.value * index / 10));
const lastKeyTime = computed(() => props.tracks.reduce((latest, track) => track.keyframes.reduce((end, key) => Math.max(end, key.time), latest), 0));
const selection = computed(() => {
  for (const track of props.tracks) {
    const key = track.keyframes.find((item) => item.id === props.selectedKeyframeId);
    const node = props.nodes.find((item) => item.id === track.nodeId);
    if (key && node) return { track, key, node, field: getTweenableField(node.type, track.fieldKey) };
  }
  return null;
});
const selectedColor = computed<ColorRGBA>(() => {
  const value = selection.value?.key.value;
  return value && typeof value === "object" ? value : { r: 255, g: 255, b: 255, a: 1 };
});
type TimelineRow = { kind: "node"; id: string; node: UINode; depth: number } | { kind: "track"; id: string; node: UINode; depth: number; track: UIKeyframeTrack };
const rows = computed<TimelineRow[]>(() => props.nodes.flatMap((node) => {
  const byId = new Map(props.nodes.map((item) => [item.id, item]));
  let parent = node.parentId; let depth = 0; const visited = new Set([node.id]);
  while (parent && !visited.has(parent)) { visited.add(parent); depth += 1; parent = byId.get(parent)?.parentId ?? null; }
  const result: TimelineRow[] = [{ kind: "node", id: `node:${node.id}`, node, depth }];
  if (!collapsed.value.has(node.id)) for (const track of props.tracks.filter((item) => item.nodeId === node.id)) result.push({ kind: "track", id: `track:${track.id}`, node, depth, track });
  return result;
}));
function formatTime(time: number) { return Number(time.toFixed(3)).toString(); }
function percent(time: number) { return `${Math.max(0, Math.min(100, time / safeDuration.value * 100))}%`; }
function clampTime(time: number) { return Math.round(Math.max(0, Math.min(safeDuration.value, time)) * 1e6) / 1e6; }
function sortedKeys(track: UIKeyframeTrack) { return [...track.keyframes].sort((a, b) => a.time - b.time); }
function fieldLabel(node: UINode, track: UIKeyframeTrack) { return getTweenableField(node.type, track.fieldKey)?.label ?? track.fieldKey; }
function formatValue(value: UITweenValue) { return value === null ? "未设置" : typeof value === "number" ? String(value) : `RGBA(${value.r}, ${value.g}, ${value.b}, ${Math.round(value.a * 100)}%)`; }
function segments(track: UIKeyframeTrack) { const keys = sortedKeys(track); return keys.slice(0, -1).map((key, index) => ({ id: key.id, start: key.time, end: keys[index + 1].time, step: key.interpolation === "step" })); }
function toggleCollapsed(id: string) { const next = new Set(collapsed.value); next.has(id) ? next.delete(id) : next.add(id); collapsed.value = next; }
function selectKey(track: UIKeyframeTrack, key: UIKeyframe) { emit("select-node", track.nodeId); emit("select-keyframe", track.id, key.id); }
function pointerTime(element: HTMLElement | null, x: number) { if (!element) return props.currentTime; const rect = element.getBoundingClientRect(); return clampTime((x - rect.left) / Math.max(1, rect.width) * safeDuration.value); }
function occupied(track: UIKeyframeTrack, time: number, excluded?: string) { return track.keyframes.some((key) => key.id !== excluded && Math.abs(key.time - time) <= EPS); }
function snapTime(raw: number, track: UIKeyframeTrack, keyId?: string, width = ruler.value?.clientWidth ?? 600, playhead = props.currentTime) {
  const clamped = clampTime(raw);
  if (!props.snapEnabled) return clamped;
  const targets = [0, safeDuration.value, playhead, ...ticks.value, ...props.tracks.flatMap((item) => item.keyframes.filter((key) => key.id !== keyId).map((key) => key.time))];
  const threshold = safeDuration.value * 9 / Math.max(1, width);
  const best = targets.filter((time) => !occupied(track, time, keyId)).sort((a, b) => Math.abs(a - clamped) - Math.abs(b - clamped))[0];
  return best !== undefined && Math.abs(best - clamped) <= threshold ? clampTime(best) : clamped;
}
function dragPointer(event: PointerEvent, move: (event: PointerEvent) => void, edit: boolean) {
  stopDrag?.(); const pointerId = event.pointerId;
  if (edit) emit("begin-edit");
  const onMove = (next: PointerEvent) => { if (next.pointerId === pointerId) move(next); };
  const onEnd = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
  const cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onEnd); window.removeEventListener("pointercancel", onEnd); window.removeEventListener("blur", cleanup); if (stopDrag !== cleanup) return; stopDrag = null; if (edit) emit("end-edit"); };
  stopDrag = cleanup;
  window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onEnd); window.addEventListener("pointercancel", onEnd); window.addEventListener("blur", cleanup);
}
function startSeek(event: PointerEvent, source?: HTMLElement | null) {
  if (event.button !== 0) return;
  const element = source ?? event.currentTarget as HTMLElement;
  if (!element) return;
  event.preventDefault(); root.value?.focus({ preventScroll: true });
  emit("seek", pointerTime(element, event.clientX));
  dragPointer(event, (next) => emit("seek", pointerTime(element, next.clientX)), false);
}
function startKeyDrag(event: PointerEvent, track: UIKeyframeTrack, key: UIKeyframe) {
  if (event.button !== 0) return;
  // Selection and movement may seek the parent's playhead. Keep the original
  // playhead as a snap target, not the key's own preceding drag position.
  const playheadAtStart = props.currentTime;
  event.preventDefault(); root.value?.focus({ preventScroll: true }); selectKey(track, key); menu.value = null;
  const element = (event.currentTarget as HTMLElement).parentElement;
  const width = Math.max(1, element?.getBoundingClientRect().width ?? 600);
  const startX = event.clientX; const initialTime = key.time;
  dragPointer(event, (next) => {
    const current = props.tracks.find((item) => item.id === track.id);
    if (!current?.keyframes.some((item) => item.id === key.id)) { stopDrag?.(); return; }
    const time = snapTime(initialTime + (next.clientX - startX) / width * safeDuration.value, current, key.id, width, playheadAtStart);
    if (occupied(current, time, key.id)) { notice.value = "同一属性轨道的关键帧不能位于同一时间。"; return; }
    notice.value = ""; emit("move-keyframe", track.id, key.id, time);
  }, true);
}
function changeDuration(value: number | null) { if (value !== null && Number.isFinite(value)) emit("update-duration", Math.max(0.01, lastKeyTime.value, value)); }
function changeKeyTime(value: number | null) {
  const selected = selection.value; if (!selected || value === null || !Number.isFinite(value)) return;
  const time = clampTime(value);
  if (occupied(selected.track, time, selected.key.id)) { notice.value = "该时间已有关键帧。"; return; }
  notice.value = ""; emit("move-keyframe", selected.track.id, selected.key.id, time);
}
function patchSelected(patch: Partial<UIKeyframe>) { const selected = selection.value; if (selected) emit("update-keyframe", selected.track.id, selected.key.id, patch); }
function changeEase(event: Event) { const value = (event.target as HTMLSelectElement).value; if (isTweenEaseType(value)) patchSelected({ easeType: value }); }
function changeInterpolation(event: Event) { const value = (event.target as HTMLSelectElement).value; if (value === "tween" || value === "step") patchSelected({ interpolation: value }); }
function addKey(track: UIKeyframeTrack, time: number) { menu.value = null; notice.value = ""; emit("upsert-keyframe", track.id, clampTime(time)); }
function removeSelectedKey() { const selected = selection.value; if (selected) emit("remove-keyframe", selected.track.id, selected.key.id); }
function openMenu(event: MouseEvent, track: UIKeyframeTrack, key?: UIKeyframe) { if (key) selectKey(track, key); menu.value = { trackId: track.id, keyId: key?.id, time: key?.time ?? pointerTime(event.currentTarget as HTMLElement, event.clientX), x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 128)) }; }
function menuAddKey() { const current = menu.value; const track = props.tracks.find((item) => item.id === current?.trackId); if (track && current) addKey(track, current.time); }
function menuDeleteKey() { const current = menu.value; menu.value = null; if (current?.keyId) emit("remove-keyframe", current.trackId, current.keyId); }
function menuDeleteTrack() { const current = menu.value; menu.value = null; if (current) emit("remove-track", current.trackId); }
function copyKey() { const selected = selection.value; if (!selected) return; clipboard.value = { trackId: selected.track.id, key: { ...selected.key, value: typeof selected.key.value === "object" && selected.key.value !== null ? { ...selected.key.value } : selected.key.value } }; notice.value = "已复制关键帧；移动播放头后按 Ctrl+V 粘贴到原属性轨道。"; }
async function pasteKey() {
  const copied = clipboard.value; if (!copied) return;
  const track = props.tracks.find((item) => item.id === copied.trackId); const time = clampTime(props.currentTime);
  if (!track) { notice.value = "原属性轨道已删除，无法粘贴。"; return; }
  if (occupied(track, time)) { notice.value = "该时间已有关键帧，请先移动播放头。"; return; }
  const revision = ++pasteRevision; emit("begin-edit");
  try {
    emit("upsert-keyframe", track.id, time); await nextTick();
    if (revision !== pasteRevision) return;
    const created = props.tracks.find((item) => item.id === track.id)?.keyframes.find((key) => Math.abs(key.time - time) <= EPS);
    if (!created) return;
    const { value, relative, easeType, interpolation } = copied.key;
    emit("update-keyframe", track.id, created.id, { value: value && typeof value === "object" ? { ...value } : value, relative: Boolean(relative), easeType, interpolation });
    emit("select-keyframe", track.id, created.id); notice.value = `已在 ${formatTime(time)} 秒粘贴关键帧。`;
  } finally { emit("end-edit"); }
}
function handleKeyDown(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.defaultPrevented) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
  const key = event.key.toLowerCase();
  if (key === "escape") { menu.value = null; stopDrag?.(); return; }
  if (key === "delete" || key === "backspace") { if (!selection.value) return; event.preventDefault(); event.stopPropagation(); if (!event.repeat) removeSelectedKey(); }
  if ((event.ctrlKey || event.metaKey) && (key === "c" || key === "v")) { event.preventDefault(); event.stopPropagation(); if (!event.repeat) { if (key === "c") copyKey(); else void pasteKey(); } }
}
function handleRulerKey(event: KeyboardEvent) { let time: number; if (event.key === "Home") time = 0; else if (event.key === "End") time = safeDuration.value; else if (event.key === "ArrowLeft" || event.key === "ArrowRight") time = props.currentTime + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 0.1 : 0.01); else return; event.preventDefault(); emit("seek", clampTime(time)); }
function outsideMenu(event: PointerEvent) { if (!(event.target as HTMLElement | null)?.closest(".kf-context-menu")) menu.value = null; }
watch(() => props.tracks, () => { if (clipboard.value && !props.tracks.some((track) => track.id === clipboard.value?.trackId)) { clipboard.value = null; pasteRevision += 1; } if (menu.value && !props.tracks.some((track) => track.id === menu.value?.trackId)) menu.value = null; });
onMounted(() => window.addEventListener("pointerdown", outsideMenu));
onBeforeUnmount(() => { pasteRevision += 1; stopDrag?.(); window.removeEventListener("pointerdown", outsideMenu); });
</script>

<style scoped>
.kf-timeline { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; min-height: 0; height: 100%; background: #1c222b; color: #cbd3df; font-size: 11px; outline: none; }
.kf-timeline button { display: inline-flex; justify-content: center; align-items: center; gap: 5px; min-width: 24px; padding: 4px 6px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.kf-timeline button:hover { background: #354050; color: #fff; }
.kf-timeline button:focus-visible { outline: 1px solid #8ab5ff; }
.kf-toolbar { display: flex; flex: 0 0 39px; gap: 6px; align-items: center; padding: 0 10px; border-bottom: 1px solid #38414f; }
.kf-title { display: flex; align-items: center; gap: 7px; margin-right: 10px; color: #e1e8f2; font-weight: 600; white-space: nowrap; }
.kf-animation-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.kf-toolbar output { min-width: 67px; color: #d9e5ff; font-variant-numeric: tabular-nums; }
.kf-toolbar .active, .kf-relative.active { background: #345378; color: #a9d2ff; border-color: #4d77a5; }
.kf-duration { display: flex; align-items: center; gap: 5px; margin-left: 10px; white-space: nowrap; }
.kf-duration :deep(input) { width: 58px !important; height: 25px; padding: 3px 5px !important; border: 1px solid #424d5e !important; border-radius: 4px; background: #181d25 !important; color: #e1e9f4 !important; font-size: 11px !important; }
.kf-toolbar-hint { margin-left: auto; color: #7c899a; white-space: nowrap; font-size: 10px; }
.kf-workspace { display: flex; flex: 1; min-height: 0; min-width: 0; }
.kf-scroll { flex: 1; min-width: 0; overflow: auto; overscroll-behavior: contain; }
.kf-grid { position: relative; display: flex; flex-direction: column; min-width: 800px; min-height: 100%; }
.kf-row { display: grid; grid-template-columns: 220px minmax(0, 1fr); flex: 0 0 30px; min-height: 30px; }
.kf-row.is-node { background: #242d39; }
.kf-row.is-selected.is-node { background: #2c3d52; }
.kf-name { position: sticky; z-index: 4; left: 0; display: flex; align-items: center; gap: 4px; min-width: 0; padding: 0 8px; border-right: 1px solid #435065; border-bottom: 1px solid #303947; background: #232b36; box-sizing: border-box; }
.is-selected.is-node .kf-name { background: #2c3d52; }
.kf-name button { min-width: 0; overflow: hidden; }
.kf-node-select { flex: 1; justify-content: flex-start !important; min-width: 0; }
.kf-node-select span, .kf-property-name > button:first-child { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
.kf-name .kf-collapse { padding: 1px 2px; width: 11px; flex: 0 0 11px; color: #8f9db1; }
.kf-name .kf-add-track { margin-left: auto; flex: 0 0 23px; color: #9bb9db; }
.kf-property-name { background: #1e2732; font-size: 10px; }
.kf-property-name.selected-track { color: #bdddff; background: #26354a; }
.kf-property-name > button:first-child { flex: 1; justify-content: flex-start; }
.kf-property-name .kf-set-key { flex: 0 0 24px; color: #edc879; font-size: 19px; line-height: 20px; padding: 0; }
.kf-lane { position: relative; min-width: 0; border-bottom: 1px solid #303947; }
.kf-track-content { position: absolute; inset: 0 14px; cursor: crosshair; }
.kf-ruler-row { position: sticky; top: 0; z-index: 7; flex-basis: 32px; min-height: 32px; background: #222a35; }
.kf-ruler-name { background: #293340; color: #a4b2c6; padding-left: 14px; }
.kf-ruler { outline: none; }
.kf-tick { position: absolute; top: 9px; padding-left: 4px; border-left: 1px solid #77879e; height: 23px; font-size: 10px; color: #a8b5c7; font-variant-numeric: tabular-nums; pointer-events: none; }
.kf-tick:last-child { transform: translateX(-100%); padding-left: 0; padding-right: 3px; border-left: 0; border-right: 1px solid #77879e; }
.kf-gridline { position: absolute; top: 0; bottom: 0; width: 1px; background: #697b9321; pointer-events: none; }
.kf-segment { position: absolute; top: 14px; height: 2px; background: #799cbf7a; pointer-events: none; }
.kf-segment.is-step { height: 0; border-top: 1px dashed #8b9ba9; background: transparent; }
.kf-timeline .kf-key { position: absolute; z-index: 3; top: 50%; width: 18px; height: 24px; min-width: 18px; padding: 0; border: 0; background: transparent; transform: translate(-50%, -50%); cursor: ew-resize; touch-action: none; }
.kf-key > span { display: block; width: 9px; height: 9px; transform: rotate(45deg); border: 1px solid #d7e3f3; border-radius: 1px; background: #91aac5; box-shadow: 0 1px 3px #0008; }
.kf-key.is-step > span { background: #1f2a39; }
.kf-key.selected > span { width: 11px; height: 11px; border-color: #ffecc2; background: #efc66b; box-shadow: 0 0 7px #d4ac634a; }
.kf-key:hover > span { border-color: #fff; background: #c7dfff; }
.kf-filler { flex: 1; min-height: 46px; }
.kf-playhead-area { position: absolute; z-index: 8; top: 0; bottom: 0; left: 234px; right: 14px; pointer-events: none; }
.kf-playhead { position: absolute; top: 0; bottom: 0; width: 1px; background: #f0c673; box-shadow: 0 0 3px #f0c633; pointer-events: none; }
.kf-timeline .kf-playhead-handle { position: sticky; top: 0; display: block; width: 12px; height: 25px; min-width: 12px; padding: 0; margin-left: -5px; border: 0; border-radius: 0 0 4px 4px; background: #f0c673; opacity: .9; pointer-events: auto; cursor: ew-resize; touch-action: none; }
.kf-empty { position: absolute; left: 245px; right: 20px; top: 62px; text-align: center; color: #738398; pointer-events: none; }
.kf-inspector { flex: 0 0 224px; min-width: 0; overflow: auto; padding: 10px 12px; border-left: 1px solid #3c4656; background: #252d38; box-sizing: border-box; }
.kf-inspector > header { display: flex; justify-content: space-between; align-items: center; color: #efd093; }
.kf-selection-name { margin: 6px 0 8px; color: #99a8bd; overflow-wrap: anywhere; font-size: 10px; }
.kf-field { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 9px 0; white-space: nowrap; }
.kf-field :deep(input), .kf-field select { box-sizing: border-box; width: 124px !important; min-width: 0; height: 27px; border: 1px solid #485568 !important; border-radius: 4px; background: #1c2430 !important; color: #e5ecf7 !important; padding: 4px 6px !important; font-size: 11px !important; }
.kf-field select:disabled { opacity: .45; }
.kf-field :deep(input.is-animated), .kf-field select.is-animated, .kf-relative.is-animated { border-color: #a66571 !important; background: #533843 !important; }
.kf-field :deep(input.is-animated:hover), .kf-field select.is-animated:hover, .kf-relative.is-animated:hover { border-color: #d58e9b !important; }
.kf-with-unit { display: flex; align-items: center; gap: 5px; }
.kf-with-unit :deep(input) { width: 108px !important; }
.kf-with-unit i { color: #8191a6; font-style: normal; }
.kf-relative { width: 100%; margin: 5px 0; border: 1px solid #42526a !important; }
.kf-inspector p { color: #8393aa; line-height: 1.6; font-size: 10px; margin: 10px 0; }
.kf-inspector-empty { text-align: center; padding-top: 20px; color: #9baabd; }
.kf-inspector-empty > span { display: block; font-size: 29px; color: #697d98; margin-bottom: 5px; }
.kf-status { flex: 0 0 22px; padding: 4px 12px; box-sizing: border-box; border-top: 1px solid #343f4d; color: #8e9eb5; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kf-context-menu { position: fixed; z-index: 12000; display: flex; flex-direction: column; min-width: 218px; padding: 5px; border: 1px solid #54667e; border-radius: 7px; background: #252f3f; box-shadow: 0 12px 32px #0008; }
.kf-context-menu button { border: 0; border-radius: 4px; padding: 8px 12px; background: transparent; color: #d4deeb; text-align: left; font: 12px sans-serif; cursor: pointer; }
.kf-context-menu button:hover { background: #3a4c65; }
.kf-context-menu .danger { color: #e5a0a0; }
@media (max-width: 1250px) { .kf-toolbar-hint { display: none; } .kf-inspector { flex-basis: 204px; } .kf-field :deep(input), .kf-field select { width: 108px !important; } }
</style>
