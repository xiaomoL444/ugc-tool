<template>
  <Teleport to="body">
    <div class="vfx-library-backdrop" @pointerdown.self="emit('close')" @keydown.esc.stop.prevent="emit('close')" @keydown.space.stop @pointerdown.stop>
      <section ref="dialog" class="vfx-library" :style="panelStyle" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown.tab="trapFocus">
        <header><div><h2>{{ title }}</h2><small>{{ t('clientUIAnimationEditor.ui.vfx.resourceCount', { count: assets.length }) }}</small></div><button :aria-label="t('clientUIAnimationEditor.ui.actions.close')" @click="emit('close')">×</button></header>
        <div class="vfx-search">
          <input ref="searchInput" v-model="search" type="search" :placeholder="t('clientUIAnimationEditor.ui.vfx.search')" :aria-label="t('clientUIAnimationEditor.ui.vfx.search')" />
          <button class="vfx-filter-toggle" :class="{ active: filtersOpen || loopFilter !== 'all' || tagFilter }" :aria-label="t('clientUIAnimationEditor.ui.vfx.filterEffects')" :aria-expanded="filtersOpen" @click="filtersOpen = !filtersOpen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18l-7 8v7l-4 2v-9Z" /></svg></button>
        </div>
        <div v-if="filtersOpen" class="vfx-filters">
          <select v-model="loopFilter" :aria-label="t('clientUIAnimationEditor.ui.vfx.playbackFilter')"><option value="all">{{ t('clientUIAnimationEditor.ui.vfx.all') }}</option><option value="loop">{{ t('clientUIAnimationEditor.ui.vfx.loop') }}</option><option value="once">{{ t('clientUIAnimationEditor.ui.vfx.once') }}</option></select>
          <select v-model="tagFilter" :aria-label="t('clientUIAnimationEditor.ui.vfx.tagFilter')"><option value="">{{ t('clientUIAnimationEditor.ui.vfx.allTags') }}</option><option v-for="tag in tags" :key="tag.id" :value="String(tag.id)">{{ uiVfxTagLabel(tag) }}</option></select>
        </div>
        <div v-if="uiVfxLoading" class="vfx-empty" role="status">{{ t('clientUIAnimationEditor.ui.vfx.loading') }}</div>
        <div v-else-if="uiVfxError" class="vfx-empty" role="alert">{{ t('clientUIAnimationEditor.ui.vfx.loadError') }}<button @click="reload">{{ t('clientUIAnimationEditor.ui.vfx.retry') }}</button></div>
        <div v-else class="vfx-library-body">
          <div ref="list" class="vfx-list">
            <details v-for="group in groups" :key="group.key" open><summary>{{ group.label }} <small>{{ group.assets.length }}</small></summary>
              <div v-for="asset in group.assets" :key="asset.id" class="vfx-row" :class="{ selected: asset.id === selectedId, previewing: asset.id === previewAsset?.id }">
                <button class="vfx-row-select" :aria-label="t('clientUIAnimationEditor.ui.vfx.selectAsset', { name: uiVfxLabel(asset), id: asset.id })" :aria-pressed="asset.id === selectedId" @click="emit('select', asset)"><UIVfxIcon :src="asset.icon" :label="uiVfxLabel(asset)" /><span><strong>{{ uiVfxLabel(asset) }}</strong><small>{{ t('clientUIAnimationEditor.ui.vfx.index', { id: asset.id }) }}</small></span></button>
                <button class="vfx-row-play" :aria-label="t('clientUIAnimationEditor.ui.vfx.previewAsset', { name: uiVfxLabel(asset), id: asset.id })" :aria-pressed="asset.id === previewAsset?.id" @click="preview(asset)">▶</button>
              </div>
            </details>
            <p v-if="!assets.length" class="vfx-empty">{{ t('clientUIAnimationEditor.ui.vfx.noResults') }}</p>
          </div>
        </div>
        <footer v-if="previewAsset"><span>{{ uiVfxLabel(previewAsset) }}</span><button @click="preview(null)">{{ t('clientUIAnimationEditor.ui.vfx.stopPreview') }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { CSSProperties } from "vue";
import { t } from "../../i18n";
import { loadUIVfxCatalog, uiVfxAssets, uiVfxTags, uiVfxLoading, uiVfxError, uiVfxLabel, uiVfxTagLabel, useUIVfxTranslations } from "./uiVfxAssets";
import type { UIVfxAsset, UIVfxScope } from "./uiVfxAssets";
import UIVfxIcon from "./UIVfxIcon.vue";
const props = defineProps<{ scope: UIVfxScope; selectedId: number | null; anchorElement?: HTMLElement | null }>();
const emit = defineEmits<{ (e: "select", asset: UIVfxAsset): void; (e: "preview", asset: UIVfxAsset | null): void; (e: "close"): void }>();
const search = ref(""), loopFilter = ref("all"), tagFilter = ref(""), filtersOpen = ref(false);
const previewAsset = ref<UIVfxAsset | null>(null);
const dialog = ref<HTMLElement | null>(null), searchInput = ref<HTMLInputElement | null>(null), list = ref<HTMLElement | null>(null);
const panelStyle = ref<CSSProperties>({ visibility: 'hidden' });
const restoreFocus = document.activeElement as HTMLElement | null;
const translations = useUIVfxTranslations();
const title = computed(() => t(props.scope === "ui" ? "clientUIAnimationEditor.ui.vfx.selectUI" : "clientUIAnimationEditor.ui.vfx.selectScreen"));
const scopeAssets = computed(() => uiVfxAssets.value.filter(asset => asset.scope === props.scope));
const tags = computed(() => uiVfxTags.value.filter(tag => scopeAssets.value.some(asset => asset.tagList.includes(tag.id))));
const assets = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return scopeAssets.value.filter(asset => (!query || `${asset.id} ${uiVfxLabel(asset)} ${asset.tagList.map(id => { const tag = uiVfxTags.value.find(tag => tag.id === id); return tag ? uiVfxTagLabel(tag) : ""; }).join(" ")}`.toLocaleLowerCase().includes(query))
    && (loopFilter.value === "all" || asset.isLoop === (loopFilter.value === "loop")) && (!tagFilter.value || asset.tagList.includes(Number(tagFilter.value))));
});
const groups = computed(() => [true, false].map(loop => ({ key: String(loop), label: t(loop ? "clientUIAnimationEditor.ui.vfx.loop" : "clientUIAnimationEditor.ui.vfx.once"), assets: assets.value.filter(asset => asset.isLoop === loop) })).filter(group => group.assets.length));
function preview(asset: UIVfxAsset | null) { previewAsset.value = asset; emit('preview', asset); }
async function reload() { await Promise.all([loadUIVfxCatalog(true), translations(true)]); }
function revealSelectedAsset() {
  const container = list.value, row = container?.querySelector<HTMLElement>('.vfx-row.selected');
  if (!container || !row) return;
  const group = row.closest('details');
  if (group) group.open = true;
  // Scroll only the resource list, keeping the editor and popup in place.
  container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientTop
    - (container.clientHeight - row.getBoundingClientRect().height) / 2;
}
watch([list, () => props.selectedId], revealSelectedAsset, { flush: 'post' });
function positionPanel() {
  const margin = 12, gap = 10, width = Math.min(380, window.innerWidth - margin * 2), height = Math.min(620, window.innerHeight - margin * 2);
  const anchor = props.anchorElement?.getBoundingClientRect();
  let left = anchor ? anchor.left - width - gap : (window.innerWidth - width) / 2;
  if (anchor && left < margin) left = anchor.right + gap;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  const top = Math.max(margin, Math.min(anchor?.top ?? margin, window.innerHeight - height - margin));
  panelStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` };
}
function trapFocus(event: KeyboardEvent) {
  const elements = dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]');
  if (!elements?.length) return;
  const first = elements[0], last = elements[elements.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
onMounted(async () => {
  await nextTick(); positionPanel(); searchInput.value?.focus();
  window.addEventListener('resize', positionPanel); window.addEventListener('scroll', positionPanel, true);
  void loadUIVfxCatalog(); void translations();
  await nextTick(); revealSelectedAsset();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', positionPanel); window.removeEventListener('scroll', positionPanel, true);
  if (restoreFocus?.isConnected) restoreFocus.focus();
});
</script>
<style scoped>
.vfx-library-backdrop { position: fixed; inset: 0; z-index: 3500; color: #e4e7ef; font-size: 12px; line-height: 1.5; }
.vfx-library { position: fixed; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; background: #292e39; border: 1px solid #4a5365; border-radius: 9px; box-shadow: 0 10px 32px #0007; outline: none; }
header { display: flex; justify-content: space-between; align-items: center; padding: 10px 13px; background: #222631; border-bottom: 1px solid #454b58; }
h2 { margin: 0; font-size: 15px; } header small, p, .vfx-row small { color: #aab4c8; }
button, select, input { font: inherit; } button, select { cursor: pointer; }
button { color: inherit; background: #333b4b; border: 1px solid #4b566b; border-radius: 6px; padding: 7px 10px; }
button:hover { background: #415172; border-color: #789ce8; } button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #9cbbff; outline-offset: 2px; }
.vfx-search { display: flex; gap: 8px; margin: 10px 12px; }
.vfx-search input { flex: 1; min-width: 0; box-sizing: border-box; height: 34px; padding: 5px 10px; background: #202631; color: inherit; border: 1px solid #505b71; border-radius: 18px; }
.vfx-filter-toggle { flex: none; display: grid; place-items: center; width: 34px; height: 34px; padding: 6px; border-radius: 50%; }
.vfx-filter-toggle svg { width: 18px; height: 18px; fill: currentColor; } .vfx-filter-toggle.active { background: #415b99; border-color: #789ce8; }
header > button { padding: 0 3px; background: transparent; border: 0; font-size: 25px; line-height: 1; }
.vfx-filters { display: flex; gap: 8px; padding: 0 12px 10px; }
.vfx-filters select { width: 50%; min-width: 0; min-height: 30px; padding: 5px 8px; background: #202631; color: inherit; border: 1px solid #505b71; border-radius: 6px; }
.vfx-library-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.vfx-list { flex: 1; min-height: 0; overflow: auto; padding: 0 7px 8px; border-top: 1px solid #454b58; scrollbar-width: thin; scrollbar-color: #6d7588 transparent; }
summary { cursor: pointer; margin: 6px 0; padding: 8px 10px; border-radius: 5px; background: #ffffff08; color: #c4cde0; font-weight: 600; } summary small { margin-left: 8px; font-weight: 400; color: #8f9db6; }
.vfx-row { display: flex; align-items: center; gap: 8px; padding: 5px; margin-bottom: 4px; border: 1px solid transparent; border-radius: 7px; background: #ffffff04; }
.vfx-row:hover { background: #ffffff0b; } .vfx-row.previewing { border-color: #718fcb; } .vfx-row.selected { background: #4362a68a; }
.vfx-row-select { display: flex; align-items: center; gap: 11px; flex: 1; min-width: 0; padding: 0; text-align: left; border: 0; background: transparent; }
.vfx-row-select > span { display: grid; min-width: 0; gap: 2px; } .vfx-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.vfx-row-select:hover { background: transparent; }
.vfx-row-play { flex: none; width: 32px; height: 32px; padding: 0; } .vfx-row-play[aria-pressed=true] { background: #415b99; }
.vfx-empty { padding: 30px 16px; text-align: center; color: #b4bfd2; } .vfx-empty button { display: block; margin: 12px auto; }
footer { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid #454b58; background: #222631; }
footer span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b7c9ed; } footer button { font-size: 11px; }
</style>
