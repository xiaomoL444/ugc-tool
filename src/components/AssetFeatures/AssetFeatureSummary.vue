<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import type { AssetFeatureDescription } from '../../utils/assetFeatures';
import { assetFeatureLabels } from './labels';
import AssetFeaturePanel from './AssetFeaturePanel.vue';

const props = defineProps<{ parts: AssetFeatureDescription[]; locale: string; iconOnly?: boolean }>();
const labels = computed(() => assetFeatureLabels(props.locale));
const summary = computed(() => props.parts.map(part => part.short).filter(Boolean).join(' · '));
const anchor = ref<HTMLElement | null>(null), tooltip = ref<HTMLElement | null>(null);
const visible = ref(false);
const position = ref<CSSProperties>({ left: '0px', top: '0px' });
const tooltipId = `asset-feature-${Math.random().toString(36).slice(2)}`;
let touchInput = false;

function hide() { visible.value = false; }
async function show() {
  if (!props.parts.length) return;
  visible.value = true;
  await nextTick();
  if (!visible.value || !anchor.value || !tooltip.value) return;
  const bounds = anchor.value.getBoundingClientRect(), panel = tooltip.value.getBoundingClientRect();
  const margin = 12, gap = 8;
  let top = bounds.bottom + gap;
  if (top + panel.height > window.innerHeight - margin && bounds.top - gap - panel.height >= margin) top = bounds.top - gap - panel.height;
  top = Math.max(margin, Math.min(top, window.innerHeight - margin - panel.height));
  const left = Math.max(margin, Math.min(bounds.left, window.innerWidth - margin - panel.width));
  position.value = { top: `${top}px`, left: `${left}px` };
}
function toggle() { if (visible.value) hide(); else void show(); }
function enter(event: PointerEvent) { if (event.pointerType !== 'touch') void show(); }
function leave(event: PointerEvent) { if (event.pointerType !== 'touch') hide(); }
function pointerDown(event: PointerEvent) { touchInput = event.pointerType === 'touch'; }
function click(event: MouseEvent) { if (touchInput || event.detail === 0) toggle(); else void show(); }
function focus() { if (!touchInput) void show(); }
function keyDown(event: KeyboardEvent) { if (event.key === 'Tab') touchInput = false; }
function outside(event: Event) { if (event.target instanceof Node && !anchor.value?.contains(event.target)) hide(); }
function listen(enabled: boolean) {
  const action = enabled ? 'addEventListener' : 'removeEventListener';
  document[action]('pointerdown', outside, true);
  document[action]('scroll', hide, true);
  window[action]('resize', hide);
}
watch(visible, open => listen(open));
watch(() => props.parts, hide);
onBeforeUnmount(() => listen(false));
</script>

<template>
  <span v-if="summary" ref="anchor" class="asset-feature-summary" role="button" tabindex="0"
    :class="{ 'icon-only': iconOnly }"
    :aria-label="`${labels.expand}: ${summary}`" :aria-expanded="visible" :aria-describedby="visible ? tooltipId : undefined"
    @pointerenter="enter" @pointerleave="leave" @pointerdown.stop="pointerDown" @click.stop="click"
    @focus="focus" @blur="hide" @keydown="keyDown" @keydown.escape.stop="hide" @keydown.enter.stop.prevent="toggle" @keydown.space.stop.prevent="toggle">
    <span v-if="!iconOnly" class="asset-feature-summary-text">{{ summary }}</span>
    <svg aria-hidden="true" viewBox="0 0 16 16" class="asset-feature-info"><circle cx="8" cy="8" r="5.8" /><path d="M8 7v4M8 4.5v.3" /></svg>
  </span>
  <Teleport to="body">
    <div v-if="visible" :id="tooltipId" ref="tooltip" role="tooltip" class="asset-feature-tooltip" :style="position">
      <AssetFeaturePanel :parts="parts" :locale="locale" />
    </div>
  </Teleport>
</template>

<style scoped>
.asset-feature-summary { display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; color: #667f9e; cursor: help; font-size: 12px; line-height: 1.5; text-align: start; }
.asset-feature-summary.icon-only { box-sizing: border-box; flex: none; justify-content: center; width: 24px; height: 23px; }
.asset-feature-summary-text { display: block; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-feature-info { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: round; }
.asset-feature-summary:hover, .asset-feature-summary:focus-visible { color: #1389e0; }
.asset-feature-summary:focus-visible { outline: 2px solid #94caff; outline-offset: 3px; border-radius: 3px; }
.asset-feature-tooltip { position: fixed; z-index: 4000; box-sizing: border-box; width: 450px; max-width: calc(100vw - 24px); max-height: min(75vh, 560px); padding: 16px 18px; border: 1px solid #cedbf0; border-radius: 11px; background: #fff; box-shadow: 0 10px 28px #35496e20; overflow: hidden; pointer-events: none; }
</style>
