<template>
  <div class="curve-editor">
    <div class="curve-heading"><span>{{ label }}</span><span>拖动关键点 · 双击添加</span></div>
    <svg ref="graph" viewBox="0 0 280 90" role="img" :aria-label="label" @dblclick="addKey" @pointermove="moveKey" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
      <path d="M12 12H268M12 45H268M12 78H268M12 12V78M140 12V78M268 12V78" class="grid" />
      <path :d="`${path} L268 78 L12 78 Z`" class="area" /><path :d="path" class="line" />
      <circle v-for="(key, index) in modelValue" :key="index" :cx="12 + key.t * 256" :cy="78 - key.value / max * 66" r="4.5" :class="{ selected: selected === index }" @pointerdown.stop.prevent="startDrag($event, index)" @dblclick.stop />
      <text x="12" y="89">出生</text><text x="245" y="89">消失</text>
    </svg>
    <div class="key-values">
      <label>时间<input aria-label="曲线关键点时间" type="number" :value="modelValue[selected]?.t" min="0" max="1" step="0.01" :disabled="selected === 0 || selected === modelValue.length - 1" @change="editKey('t', $event)" /></label>
      <label>值<input aria-label="曲线关键点数值" type="number" :value="modelValue[selected]?.value" min="0" :max="max" step="0.05" @change="editKey('value', $event)" /></label>
      <button :disabled="selected === 0 || selected >= modelValue.length - 1" @click="removeKey">删除点</button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CurveKey } from "./particleModel";
const props = defineProps<{ label: string; modelValue: CurveKey[]; max: number }>();
const emit = defineEmits<{ (event: "update:modelValue", value: CurveKey[]): void }>();
const graph = ref<SVGSVGElement>(); const selected = ref(0); let pointer: number | null = null;
const path = computed(() => props.modelValue.map((k, i) => `${i ? 'L' : 'M'}${12 + k.t * 256} ${78 - k.value / props.max * 66}`).join(' '));
watch(() => props.modelValue.length, length => { selected.value = Math.min(selected.value, length - 1); });
function coordinates(event: MouseEvent | PointerEvent) {
  const rect = graph.value!.getBoundingClientRect(), scale = Math.min(rect.width / 280, rect.height / 90);
  const x = (event.clientX - rect.left - (rect.width - 280 * scale) / 2) / scale;
  const y = (event.clientY - rect.top - (rect.height - 90 * scale) / 2) / scale;
  return { t: Math.max(0, Math.min(1, (x - 12) / 256)), value: Math.max(0, Math.min(props.max, (78 - y) / 66 * props.max)) };
}
function updateKey(t: number, value: number) {
  const keys = props.modelValue.map(k => ({ ...k })), i = selected.value;
  keys[i].value = Math.round(value * 100) / 100;
  if (i > 0 && i < keys.length - 1) { const gap = Math.min(.001, (keys[i + 1].t - keys[i - 1].t) / 3); keys[i].t = Math.max(keys[i - 1].t + gap, Math.min(keys[i + 1].t - gap, Math.round(t * 1000) / 1000)); }
  emit('update:modelValue', keys);
}
function startDrag(event: PointerEvent, index: number) { selected.value = index; pointer = event.pointerId; graph.value?.setPointerCapture(event.pointerId); }
function moveKey(event: PointerEvent) { if (pointer !== event.pointerId) return; const p = coordinates(event); updateKey(p.t, p.value); }
function endDrag() { pointer = null; }
function addKey(event: MouseEvent) {
  if (props.modelValue.length >= 16) return;
  const p = coordinates(event), t = Math.round(p.t * 100) / 100;
  if (props.modelValue.some(k => Math.abs(k.t - t) < .025)) return;
  const keys = [...props.modelValue, { t, value: Math.round(p.value * 100) / 100 }].sort((a, b) => a.t - b.t);
  selected.value = keys.findIndex(k => k.t === t); emit('update:modelValue', keys);
}
function editKey(field: 't' | 'value', event: Event) {
  const n = Number((event.target as HTMLInputElement).value); if (!Number.isFinite(n)) return;
  const k = props.modelValue[selected.value]; updateKey(field === 't' ? n : k.t, field === 'value' ? Math.max(0, Math.min(props.max, n)) : k.value);
}
function removeKey() { if (selected.value <= 0 || selected.value >= props.modelValue.length - 1) return; const keys = props.modelValue.filter((_, i) => i !== selected.value); selected.value = 0; emit('update:modelValue', keys); }
</script>
<style scoped>
.curve-editor{margin:14px 0}.curve-heading{display:flex;justify-content:space-between;font-size:11px;color:#d8deed}.curve-heading span+span{color:#7f8ca4;font-size:10px}svg{display:block;width:100%;height:100px;touch-action:none;overflow:visible}.grid{stroke:#303b50;fill:none;stroke-width:1}.area{fill:#86a7ff14}.line{stroke:#8bafff;fill:none;stroke-width:2}circle{fill:#202a3e;stroke:#9ebcff;stroke-width:2;cursor:grab}circle.selected{fill:#bdd0ff}text{font-size:8px;fill:#7f8ca4}.key-values{display:flex;gap:8px;align-items:center}.key-values label{display:flex;align-items:center;gap:4px;font-size:10px;color:#9ba8bf}.key-values input{width:52px;background:#151c29;border:1px solid #354159;color:#d8e2f6;padding:4px;border-radius:4px;font:inherit}.key-values button{margin-left:auto;font:inherit;font-size:10px;background:none;color:#a7b6cf;border:0;cursor:pointer}.key-values :disabled{opacity:.4}
</style>


