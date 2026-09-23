<template>
  <button ref="trigger" type="button" class="ease-trigger" aria-label="关键帧缓动" aria-haspopup="dialog" :aria-expanded="opened" :disabled="disabled" @click.stop="open">
    <svg viewBox="0 0 160 128" aria-hidden="true"><path :d="easeCurvePath(modelValue)" /></svg>
    <span>{{ selectedLabel }}<small>{{ modelValue }}</small></span><span aria-hidden="true">▦</span>
  </button>
  <Teleport to="body">
    <dialog ref="panel" class="ease-panel" role="dialog" aria-label="选择缓动效果" @close="closed" @click.self="close" @keydown.stop @pointerdown.stop>
      <header><div><strong>选择缓动效果</strong><p>作用于当前关键帧 → 下一帧 · 横轴时间 / 纵轴进度</p></div><button type="button" aria-label="关闭缓动面板" @click="close">✕</button></header>
      <div class="ease-search"><input v-model="query" type="search" placeholder="搜索名称，例如 回弹 / Out / Sine" aria-label="搜索缓动效果" /><span>{{ filtered.length }} / {{ tweenEaseOptions.length }}</span></div>
      <div class="ease-grid">
        <button v-for="ease in filtered" :key="ease.value" type="button" class="ease-card" :class="{ selected: modelValue === ease.value }" :aria-pressed="modelValue === ease.value" :aria-label="`${ease.label} ${ease.value}`" @click="choose(ease.value)">
          <span class="ease-card-title">{{ ease.label }}<span v-if="modelValue === ease.value" aria-hidden="true">✓</span></span>
          <svg viewBox="0 0 160 128" aria-hidden="true"><path class="ease-gridlines" d="M16 28H144 M16 64H144 M16 100H144 M16 28V100 M80 28V100 M144 28V100" /><path class="ease-diagonal" d="M16 100L144 28" /><path class="ease-curve" :d="easeCurvePath(ease.value)" /><circle cx="16" cy="100" r="2.5" /><circle cx="144" cy="28" r="2.5" /></svg>
          <small>{{ ease.value }}</small>
        </button>
        <p v-if="!filtered.length" class="ease-empty">没有匹配的缓动效果，请更换关键词。</p>
      </div>
      <footer>点击曲线立即应用 · Esc 关闭 · 回弹和弹性曲线允许超出 0–1</footer>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { tweenEaseOptions } from "./tweenRegistry";
import { easeCurvePath } from "./easeCurve";
import type { TweenEaseType } from "./types";
const props = defineProps<{ modelValue: TweenEaseType; disabled?: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: TweenEaseType): void }>();
const panel = ref<HTMLDialogElement | null>(null), trigger = ref<HTMLButtonElement | null>(null);
const opened = ref(false), query = ref("");
const selectedLabel = computed(() => tweenEaseOptions.find(e => e.value === props.modelValue)?.label ?? props.modelValue);
const filtered = computed(() => tweenEaseOptions.filter(e => `${e.label} ${e.value}`.toLowerCase().includes(query.value.trim().toLowerCase())));
function open() { if (props.disabled) return; query.value = ""; panel.value?.showModal(); opened.value = true; }
function close() { panel.value?.close(); }
function closed() { opened.value = false; trigger.value?.focus(); }
function choose(value: TweenEaseType) { if (props.disabled) return; emit("update:modelValue", value); close(); }
watch(() => props.disabled, value => { if (value) close(); });
onBeforeUnmount(close);
</script>

<style scoped>
.ease-trigger{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:1px solid #86575e;border-radius:5px;background:#442f3a;color:#e7eaf3;cursor:pointer;text-align:left;font:inherit}.ease-trigger>svg{width:40px;height:32px}.ease-trigger path{fill:none;stroke:#caafff;stroke-width:5}.ease-trigger>span:first-of-type{flex:1}.ease-trigger small{display:block;color:#b5acbe;font-size:10px}.ease-trigger:disabled{opacity:.4;cursor:not-allowed}
.ease-panel{box-sizing:border-box;width:min(860px,calc(100vw - 32px));max-height:calc(100dvh - 40px);padding:0;border:1px solid #535b70;border-radius:12px;background:#242a36;color:#e7eaf3;box-shadow:0 24px 80px #0008;font:13px/1.5 system-ui,sans-serif;overflow:auto}.ease-panel::backdrop{background:#10151db3;backdrop-filter:blur(3px)}.ease-panel header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px 10px}.ease-panel strong{font-size:19px}.ease-panel p{margin:5px 0;color:#a4afc3;font-size:12px}.ease-panel header button{border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer}.ease-search{display:flex;align-items:center;gap:16px;padding:4px 24px 16px}.ease-search input{flex:1;min-width:0;border:1px solid #485267;border-radius:6px;padding:9px 12px;background:#1c222d;color:inherit;font:inherit}.ease-search span{color:#a4afc3;font-size:12px}.ease-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(125px,1fr));gap:8px;padding:0 16px 16px}.ease-card{border:1px solid #414b60;border-radius:8px;background:#2d3543;color:#dce3f2;cursor:pointer;padding:8px;text-align:left;font:12px/1.4 system-ui,sans-serif;transition:border-color .12s,background .12s}.ease-card:hover{background:#35405a;border-color:#94a7d9}.ease-card.selected{background:#343754;border-color:#ae8bff;box-shadow:inset 0 0 0 1px #ae8bff}.ease-card-title{display:flex;justify-content:space-between;gap:4px}.ease-card-title>span{color:#c4a9ff}.ease-card svg{display:block;width:100%;height:72px}.ease-gridlines{fill:none;stroke:#8999b3;stroke-opacity:.17}.ease-diagonal{fill:none;stroke:#8999b3;stroke-opacity:.35;stroke-dasharray:3 4}.ease-curve{fill:none;stroke:#b89aff;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}.ease-card circle{fill:#d7c6ff}.ease-card small{color:#aebbd3}.ease-empty{grid-column:1/-1;padding:30px;text-align:center}.ease-panel footer{padding:12px 24px;background:#202632;border-top:1px solid #3b4353;color:#a4afc3;font-size:12px}.ease-panel button:focus-visible,.ease-panel input:focus-visible,.ease-trigger:focus-visible{outline:2px solid #c4a9ff;outline-offset:3px}@media(max-width:560px){.ease-grid{grid-template-columns:repeat(auto-fill,minmax(110px,1fr));padding:0 12px 12px;gap:6px}.ease-panel header,.ease-search{padding-left:12px;padding-right:12px}.ease-card{padding:6px}.ease-card svg{height:64px}}
</style>
