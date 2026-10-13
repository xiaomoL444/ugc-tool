<template>
  <div class="event-timeline" tabindex="0" :aria-label="t('clientUIAnimationEditor.ui.events.triggerTrack')" @keydown="keyboard" @pointerdown.stop>
    <div class="event-row" :style="{ minHeight: `${Math.max(1, maxStack) * 24 + 8}px` }">
      <div class="event-label"><strong>{{ t('clientUIAnimationEditor.ui.events.titleSymbol') }}</strong><button :title="t('clientUIAnimationEditor.ui.events.addAtPlayhead')" @click="add(currentTime)">＋</button><button @click="expanded = !expanded">{{ expanded ? t('clientUIAnimationEditor.ui.actions.collapse') : t('clientUIAnimationEditor.ui.events.editLog') }}</button></div>
      <div class="event-lane"><div ref="lane" class="event-content" @dblclick.self="add(pointerTime($event.clientX))">
        <button v-for="entry in markers" :key="entry.event.id" class="event-marker" :class="{ selected: selectedId === entry.event.id }" :style="{ left: `${entry.event.time / duration * 100}%`, top: `${entry.stack * 24 + 2}px` }" :title="`${entry.event.time}s · ${entry.event.name}`" :aria-label="t('clientUIAnimationEditor.ui.events.markerLabel', { name: entry.event.name, time: entry.event.time })" @pointerdown.stop="drag($event, entry.event)" @click.stop="select(entry.event.id)">⚑</button>
      </div></div>
    </div>
    <div v-if="expanded" class="event-details">
      <div class="event-list"><button v-for="(event, index) in events" :key="event.id" :class="{ selected: selectedId === event.id }" @click="select(event.id)">{{ index + 1 }} · {{ event.time.toFixed(2) }}s · {{ event.name }}</button><span v-if="!events.length">{{ t('clientUIAnimationEditor.ui.events.addByDoubleClickHint') }}</span></div>
      <form v-if="selected" class="event-form" @submit.prevent="save">
        <label>{{ t('clientUIAnimationEditor.ui.events.time') }}<ScrubbableNumberInput v-model="draft.time" :min="0" :max="duration" :step="0.01" :aria-label="t('clientUIAnimationEditor.ui.events.eventTime')" /></label>
        <label>{{ t('clientUIAnimationEditor.ui.properties.name') }}<input v-model="draft.name" maxlength="80" :aria-label="t('clientUIAnimationEditor.ui.events.name')" /></label>
        <label>{{ t('clientUIAnimationEditor.ui.events.target') }}<select v-model="draft.nodeId" :aria-label="t('clientUIAnimationEditor.ui.events.eventTarget')"><option value="">{{ t('clientUIAnimationEditor.ui.events.animationRoot') }}</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.name }}</option></select></label>
        <label class="event-params">{{ t('clientUIAnimationEditor.ui.events.stringParameters') }}<textarea v-model="draft.params" maxlength="4096" :aria-label="t('clientUIAnimationEditor.ui.events.parameters')" :placeholder="t('clientUIAnimationEditor.ui.events.paramsHint')" /></label>
        <div class="event-actions"><button type="submit">{{ t('clientUIAnimationEditor.ui.actions.apply') }}</button><button type="button" @click="copy">{{ t('clientUIAnimationEditor.ui.actions.copy') }}</button><button type="button" :disabled="!copied" @click="paste">{{ t('clientUIAnimationEditor.ui.events.pasteAtPlayhead') }}</button><button type="button" :disabled="selectedIndex === 0" @click="reorder(-1)">{{ t('clientUIAnimationEditor.ui.events.moveUp') }}</button><button type="button" :disabled="selectedIndex === events.length - 1" @click="reorder(1)">{{ t('clientUIAnimationEditor.ui.events.moveDown') }}</button><button type="button" @click="remove">{{ t('clientUIAnimationEditor.ui.common.delete') }}</button></div>
        <p v-if="error" role="alert">{{ error }}</p>
      </form>
      <div class="event-log"><strong>{{ t('clientUIAnimationEditor.ui.events.previewLog') }}</strong><button @click="$emit('clear-log')">{{ t('clientUIAnimationEditor.ui.common.clear') }}</button><p>{{ t('clientUIAnimationEditor.ui.events.playbackOrderHint') }}</p><div v-for="(line, index) in logs" :key="index">{{ line }}</div></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { t } from '../../i18n';
import { computed, onBeforeUnmount, ref, watch } from "vue";
import ScrubbableNumberInput from "./ScrubbableNumberInput.vue";
import { normalizeTimelineEvents } from "./timelineEvents";
import type { UITimelineEvent, UINode } from "./types";
const props = defineProps<{ events: UITimelineEvent[]; nodes: UINode[]; duration: number; currentTime: number; snapEnabled: boolean; snapTimes: number[]; logs: Array<string> }>();
const emit = defineEmits<{ (e: "change", events: UITimelineEvent[]): void; (e: "begin-edit" | "end-edit" | "clear-log" | "select"): void }>();
const lane = ref<HTMLElement | null>(null), selectedId = ref<string | null>(null), expanded = ref(false), error = ref<string>('');
const copied = ref<UITimelineEvent | null>(null);
const draft = ref({ time: 0 as number | null, name: "", nodeId: "", params: "" });
const selectedIndex = computed(() => props.events.findIndex(e => e.id === selectedId.value));
const selected = computed(() => props.events[selectedIndex.value]);
const markers = computed(() => {
  const counts = new Map<number, number>();
  return props.events.map(event => { const stack = counts.get(event.time) ?? 0; counts.set(event.time, stack + 1); return { event, stack }; });
});
const maxStack = computed(() => Math.max(1, ...markers.value.map(e => e.stack + 1)));
watch(selected, value => { if (value) draft.value = { time: value.time, name: value.name, nodeId: value.nodeId ?? "", params: value.params }; }, { immediate: true });
function id() { return `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function select(value: string) { selectedId.value = value; expanded.value = true; error.value = ""; emit("select"); }
function commit(events: UITimelineEvent[]) { try { emit("change", normalizeTimelineEvents(events, props.nodes)); error.value = ""; return true; } catch (e) { error.value = (e instanceof Error ? e.message : String(e)); return false; } }
function add(time: number) { const event = { id: id(), time: Math.max(0, Math.min(props.duration, time)), name: "Event", nodeId: null, params: "" }; if (commit([...props.events, event])) select(event.id); }
function save() { if (!selected.value) return; try { const event = { ...selected.value, time: draft.value.time as number, name: draft.value.name, nodeId: draft.value.nodeId || null, params: draft.value.params }; if (event.time > props.duration) { error.value = t('clientUIAnimationEditor.ui.events.exceedsDuration'); return; } commit(props.events.map(e => e.id === event.id ? event : e)); } catch (e) { error.value = (e instanceof Error ? e.message : String(e)); } }
function remove() { commit(props.events.filter(e => e.id !== selectedId.value)); selectedId.value = null; }
function copy() { if (selected.value) copied.value = JSON.parse(JSON.stringify(selected.value)); }
function paste() { if (!copied.value) return; const event = { ...JSON.parse(JSON.stringify(copied.value)), id: id(), time: props.currentTime }; if (commit([...props.events, event])) select(event.id); }
function reorder(delta: number) { const list = [...props.events], i = selectedIndex.value, j = i + delta; if (i < 0 || j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; commit(list); }
function keyboard(e: KeyboardEvent) { if ((e.target as HTMLElement)?.closest("input, textarea, select") || e.isComposing) return; if ((e.ctrlKey || e.metaKey) && ["c", "v"].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); if (e.key.toLowerCase() === "c") copy(); else paste(); } else if (["Delete", "Backspace"].includes(e.key) && selected.value) { e.preventDefault(); e.stopPropagation(); remove(); } }
function pointerTime(x: number) { const rect = lane.value!.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(props.duration, (x - rect.left) / Math.max(1, rect.width) * props.duration)) * 1000) / 1000; }
let stop: (() => void) | null = null;
function drag(e: PointerEvent, event: UITimelineEvent) {
    if (e.button !== 0) return; e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus?.(); stop?.(); select(event.id);
  const startX = e.clientX, startTime = event.time, rect = lane.value!.getBoundingClientRect(), playhead = props.currentTime;
  let started = false;
  const move = (p: PointerEvent) => {
    if (p.pointerId !== e.pointerId || !started && Math.abs(p.clientX - startX) < 3) return;
    if (!started) { started = true; emit("begin-edit"); }
    let time = Math.max(0, Math.min(props.duration, startTime + (p.clientX - startX) / Math.max(1, rect.width) * props.duration));
    if (props.snapEnabled) { const targets = [0, props.duration, playhead, ...props.snapTimes, ...props.events.filter(x => x.id !== event.id).map(x => x.time)]; const nearest = targets.sort((a, b) => Math.abs(a - time) - Math.abs(b - time))[0]; if (Math.abs(nearest - time) <= props.duration * 8 / Math.max(1, rect.width)) time = nearest; }
    commit(props.events.map(x => x.id === event.id ? { ...x, time: Math.round(time * 1000) / 1000 } : x));
  };
  const end = (p: PointerEvent) => { if (p.pointerId === e.pointerId) cleanup(); };
  const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); window.removeEventListener("blur", cleanup); if (started) emit("end-edit"); stop = null; };
  stop = cleanup; window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end); window.addEventListener("blur", cleanup);
}
onBeforeUnmount(() => stop?.());
</script>
<style scoped>
.event-timeline{color:#dfc1ff;background:#292638;border-bottom:1px solid #514564;font-size:11px;outline:none}.event-row{display:grid;grid-template-columns:220px minmax(0,1fr)}.event-label{position:sticky;left:0;z-index:4;background:#302b40;display:flex;gap:8px;align-items:center;padding:0 10px;border-right:1px solid #514564}.event-label strong{margin-right:auto}.event-lane{position:relative}.event-content{position:absolute;inset:0 14px;cursor:crosshair}.event-marker{position:absolute;transform:translateX(-50%);width:22px;height:22px;padding:0!important;touch-action:none;color:#d6a3ff!important}.event-timeline button{background:#383146;border:1px solid #615071;border-radius:4px;color:inherit;cursor:pointer;padding:3px 6px;font:inherit}.event-timeline button.selected{background:#79579b;color:white;border-color:#ddb5ff}.event-timeline button:disabled{opacity:.4}.event-details{position:relative;z-index:6;display:grid;grid-template-columns:210px 1fr 240px;gap:12px;padding:12px;background:#252330}.event-list{display:flex;flex-direction:column;gap:4px;max-height:200px;overflow:auto}.event-list button{text-align:left}.event-form{display:grid;grid-template-columns:100px 1fr 1fr;gap:8px}.event-form label{display:flex;flex-direction:column;gap:4px}.event-form input,.event-form select,.event-form textarea{box-sizing:border-box;width:100%;background:#1c1e28;color:#e7dcf7;border:1px solid #5e4a70;border-radius:4px;padding:5px;font:inherit}.event-params,.event-actions,.event-form p{grid-column:1/-1}.event-params textarea{height:64px;resize:vertical}.event-actions{display:flex;flex-wrap:wrap;gap:6px}.event-form p{color:#ffb5bf;margin:0}.event-log{max-height:220px;overflow:auto;color:#c2b3d0;overflow-wrap:anywhere}.event-log>button{margin-left:8px}.event-log p{font-size:10px}.event-timeline button:focus-visible{outline:2px solid #d6a3ff;outline-offset:1px}
</style>
