<template>
  <SectionLayout :title="t('animationViewer.title')">
    <div class="animation-browser">
      <div class="library-toolbar">
        <div class="search-row">
          <label class="search-label" for="animation-search">{{ t('animationViewer.search.label') }}</label>
          <input id="animation-search" v-model="search" type="search" autocomplete="off"
            :placeholder="t('animationViewer.search.placeholder')" />
          <span class="search-count" role="status"
            :title="t('animationViewer.stats', { skills: matchingSkillCount, parts: matchingPartCount })">
            {{ t('animationViewer.resultCount', { count: matchingPartCount }) }}
          </span>
          <button class="toggle-all" type="button" :disabled="!matchingGroups.length" @click="toggleAllCategories">
            {{ t(allMatchingExpanded ? 'animationViewer.collapseAll' : 'animationViewer.expandAll') }}
          </button>
        </div>
        <div v-if="catalog.data.length && groups.length" class="library-controls">
          <div class="category-controls">
            <button v-for="group in groups" :key="group.category.id" type="button" class="category-header category-toggle"
              :class="{ expanded: !collapsedCategories.has(group.category.id) }"
              :disabled="!group.skills.length || loadState === 'loading'"
              :aria-expanded="!collapsedCategories.has(group.category.id)"
              :aria-controls="`animation-category-${group.category.id}`" @click="toggleCategory(group.category.id)">
              <span class="category-arrow" :class="{ expanded: !collapsedCategories.has(group.category.id) }" aria-hidden="true">▶</span>
              <span class="category-title" :title="t(group.category.nameI18nKey)">{{ t(group.category.nameI18nKey) }}</span>
              <span class="category-count">{{ group.partCount }}</span>
            </button>
          </div>
          <select v-model="selectedVersion" class="version-filter" :aria-label="t('animationViewer.versionFilter')"
            :disabled="loadState !== 'ready'">
            <option value="">{{ t('animationViewer.allVersions') }}</option>
            <option v-for="version in availableVersions" :key="version" :value="version">{{ version }}</option>
          </select>
        </div>
      </div>

      <div class="library-content" :aria-busy="loadState === 'loading'">
        <div v-if="loadState === 'loading'" class="status-panel" role="status">
          <span class="loading-spinner" aria-hidden="true" />
          <p>{{ t('animationViewer.loading') }}</p>
        </div>
        <div v-else-if="loadState === 'error' || loadState === 'invalid'" class="status-panel" role="alert">
          <p>{{ t(loadState === 'invalid' ? 'animationViewer.invalidData' : 'animationViewer.loadFailed') }}</p>
          <button type="button" @click="loadCatalog">{{ t('animationViewer.retry') }}</button>
        </div>
        <template v-else-if="!catalog.data.length" />
        <div v-else-if="!matchingGroups.length" class="status-panel" role="status">
          <p>{{ t('animationViewer.noResults') }}</p>
        </div>
        <template v-else-if="allMatchingCollapsed" />
        <VVirtualList v-else ref="libraryList" class="animation-virtual-list" :items="virtualRows"
          :item-size="128" item-resizable key-field="id" :padding-top="2" :padding-bottom="10">
          <template #default="{ item: row }: { item: AnimationRow }">
            <div class="category-row" :class="[{ 'group-first': row.isFirst, 'group-last': row.isLast }, `category-${row.category.id}`]"
              :data-animation-row="row.id">
              <fieldset :id="row.isFirst ? `animation-category-${row.category.id}` : undefined"
                class="animation-category" :class="{ 'group-first': row.isFirst, 'group-last': row.isLast }"
                :data-animation-category="row.category.id" :aria-label="t(row.category.nameI18nKey)">
                <legend v-if="row.isFirst">{{ t(row.category.nameI18nKey) }}</legend>
                <div class="skill-grid">
                  <section v-for="entry in row.skills" :key="entry.key" class="skill-group"
                    :class="{ 'is-single': entry.skill.type === 'single', 'is-wide': entry.skill.parts.length > 3 }"
                    :data-animation-skill="entry.key" :data-animation-type="entry.skill.type">
                    <div v-if="entry.skill.type !== 'single'" class="skill-heading">
                      <h2>
                        <button type="button" class="copy-name" :title="t('animationViewer.copyName', { name: skillName(entry.skill) })"
                          :aria-label="t('animationViewer.copyName', { name: skillName(entry.skill) })"
                          @click.stop="Clipboard(skillName(entry.skill))">{{ skillName(entry.skill) }}</button>
                      </h2>
                      <div class="skill-meta">
                        <span>{{ t(`animationViewer.type.${entry.skill.type}`) }}</span>
                      </div>
                    </div>
                    <div class="parts-grid" :style="{ '--part-columns': Math.min(entry.skill.parts.length, 4) }">
                      <article v-for="(part, partIndex) in entry.skill.parts" :key="partIndex" class="animation-part"
                        :data-animation-part="`${entry.key}:${partIndex}`" :data-animation-part-type="part.type">
                        <div class="part-preview">
                          <AnimationPreview :part="part" :title="previewName(entry.skill, part)"
                            :cache-key="`${entry.key}:${partIndex}`" :suspended="Boolean(selected)" />
                          <button type="button" class="preview-open" :aria-label="t('animationViewer.preview', { name: previewName(entry.skill, part) })"
                            @click="openPreview(entry, partIndex)">
                            <span class="expand-icon" aria-hidden="true">⤢</span>
                          </button>
                        </div>
                        <div class="part-info">
                          <button type="button" class="part-name copy-name" :title="t('animationViewer.copyName', { name: partName(entry.skill, part) })"
                            :aria-label="t('animationViewer.copyName', { name: partName(entry.skill, part) })"
                            @click.stop="Clipboard(partName(entry.skill, part))">{{ partName(entry.skill, part) }}</button>
                          <span v-if="part.type === 'continuous' || part.duration !== undefined" class="part-meta">
                            <span v-if="part.type === 'continuous'">{{ t('animationViewer.loop') }} ↻</span>
                            <span v-if="part.duration !== undefined" :data-part-duration="part.duration">
                              {{ t('animationViewer.partDuration', { seconds: formatDuration(part.duration) }) }}
                            </span>
                          </span>
                        </div>
                      </article>
                    </div>
                  </section>
                </div>
              </fieldset>
            </div>
          </template>
        </VVirtualList>
      </div>
    </div>
  </SectionLayout>

  <Teleport to="body">
    <dialog ref="previewDialog" class="animation-preview-dialog" :aria-label="t('animationViewer.title')"
      @cancel.prevent="closePreview" @close="onPreviewClosed" @click="onDialogClick">
      <template v-if="selected">
        <div class="preview-heading">
          <h2>
            <button type="button" class="copy-name" :title="t('animationViewer.copyName', { name: previewName(selected.skill, selected.part) })"
              :aria-label="t('animationViewer.copyName', { name: previewName(selected.skill, selected.part) })"
              @click.stop="Clipboard(previewName(selected.skill, selected.part))">{{ previewName(selected.skill, selected.part) }}</button>
          </h2>
          <button type="button" class="close-preview" :aria-label="t('animationViewer.closePreview')" @click="closePreview">×</button>
        </div>
        <AnimationPreview :key="selected.key" :part="selected.part"
          :title="previewName(selected.skill, selected.part)" :cache-key="selected.key" variant="modal" />
      </template>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VVirtualList, type VVirtualListInst } from 'vueuc';
import SectionLayout from '@/components/Layout/SectionLayout.vue';
import { createOss } from '@/utils/oss';
import { Clipboard } from '@/utils/clipboard';
import { useOssTranslations } from '@/i18n/useOssTranslations';
import AnimationPreview from './AnimationPreview.vue';
import { normalizeAnimationData } from './animationData';
import { buildAnimationRows } from './animationRows';
import type { AnimationRow, AnimationSkillEntry } from './animationRows';
import type { AnimationDataFile, AnimationPart, AnimationSkill } from './animationData';

type SkillEntry = AnimationSkillEntry;
interface SelectedPart { key: string; skill: AnimationSkill; part: AnimationPart; partIndex: number }
type LoadState = 'loading' | 'ready' | 'error' | 'invalid';

const { t, locale } = useI18n({ useScope: 'global' });
const oss = createOss('AnimationViewer');
const loadTranslations = useOssTranslations('AnimationViewer', 'animationViewer');
const catalog = shallowRef<AnimationDataFile>({ data: [], category: [] });
const loadState = ref<LoadState>('loading');
const search = ref('');
const selectedVersion = ref('');
const collapsedCategories = ref(new Set<number>());
const selected = shallowRef<SelectedPart | null>(null);
const previewDialog = ref<HTMLDialogElement | null>(null);
const libraryList = ref<VVirtualListInst | null>(null);
const viewportWidth = ref(window.innerWidth);
let requestController: AbortController | null = null;
let requestVersion = 0;
let destroyed = false;
let previewTrigger: HTMLElement | null = null;

function skillName(skill: AnimationSkill) { return t(skill.nameI18nKey); }
function partName(skill: AnimationSkill, part: AnimationPart) {
  if (part.nameI18nKey) return t(part.nameI18nKey);
  return skillName(skill);
}
function previewName(skill: AnimationSkill, part: AnimationPart) {
  const name = partName(skill, part);
  return skill.type === 'single' ? name : `${skillName(skill)} · ${name}`;
}
const availableVersions = computed(() => [...new Set(catalog.value.data.flatMap(skill => skill.giVersion ? [skill.giVersion] : []))]
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));
const groups = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const entries = catalog.value.data.map((skill, index) => ({ key: String(index), skill }))
    .filter(({ skill }) => !selectedVersion.value || skill.giVersion === selectedVersion.value)
    .filter(({ skill }) => !query || skillName(skill).toLocaleLowerCase().includes(query)
      || skill.parts.some(part => partName(skill, part).toLocaleLowerCase().includes(query)))
    .sort((a, b) => (a.skill.order ?? 0) - (b.skill.order ?? 0));
  return catalog.value.category.map(category => {
    const skills = entries.filter(entry => entry.skill.category === category.id);
    return { category, skills, partCount: skills.reduce((total, entry) => total + entry.skill.parts.length, 0) };
  });
});
const matchingGroups = computed(() => groups.value.filter(group => group.skills.length));
const expandedGroups = computed(() => matchingGroups.value.filter(group => !collapsedCategories.value.has(group.category.id)));
const virtualRows = computed(() => buildAnimationRows(expandedGroups.value, viewportWidth.value));
const allMatchingCollapsed = computed(() => matchingGroups.value.length > 0 && expandedGroups.value.length === 0);
const allMatchingExpanded = computed(() => matchingGroups.value.length > 0 && expandedGroups.value.length === matchingGroups.value.length);
const matchingSkillCount = computed(() => matchingGroups.value.reduce((total, group) => total + group.skills.length, 0));
const matchingPartCount = computed(() => matchingGroups.value.reduce((total, group) => total + group.partCount, 0));

function toggleCategory(id: number) {
  const next = new Set(collapsedCategories.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  collapsedCategories.value = next;
}
function toggleAllCategories() {
  const next = new Set(collapsedCategories.value);
  for (const group of matchingGroups.value) {
    if (allMatchingExpanded.value) next.add(group.category.id); else next.delete(group.category.id);
  }
  collapsedCategories.value = next;
}
function formatDuration(seconds: number) {
  return new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }).format(seconds);
}
async function openPreview(entry: SkillEntry, partIndex: number) {
  previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  selected.value = { key: `${entry.key}:${partIndex}`, skill: entry.skill, part: entry.skill.parts[partIndex], partIndex };
  await nextTick();
  if (!destroyed && selected.value && previewDialog.value && !previewDialog.value.open) previewDialog.value.showModal();
}
function closePreview() {
  if (previewDialog.value?.open) previewDialog.value.close();
  else onPreviewClosed();
}
function onPreviewClosed() {
  selected.value = null;
  if (previewTrigger?.isConnected) previewTrigger.focus();
  else if (previewTrigger) document.getElementById('animation-search')?.focus();
  previewTrigger = null;
}
function onDialogClick(event: MouseEvent) {
  if (event.target === previewDialog.value) closePreview();
}
async function loadCatalog() {
  const version = ++requestVersion;
  requestController?.abort();
  requestController = new AbortController();
  const controller = requestController;
  loadState.value = 'loading';
  closePreview();
  try {
    const response = await fetch(`${oss.path('data.json')}?_t=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    if (destroyed || version !== requestVersion) return;
    if (response.status === 404) {
      catalog.value = { data: [], category: [] };
      loadState.value = 'ready';
      return;
    }
    if (!response.ok) throw new Error(`Animation index returned ${response.status}`);
    let next: AnimationDataFile;
    try { next = normalizeAnimationData(await response.json()); }
    catch (error) {
      if (controller.signal.aborted || destroyed || version !== requestVersion) return;
      console.warn('Invalid AnimationViewer data.json', error);
      loadState.value = 'invalid';
      return;
    }
    if (destroyed || version !== requestVersion) return;
    catalog.value = next;
    loadState.value = 'ready';
    if (next.data.length || next.category.length) void loadTranslations();
  } catch (error) {
    if (controller.signal.aborted || destroyed || version !== requestVersion) return;
    console.warn('Could not load AnimationViewer data.json', error);
    loadState.value = 'error';
  }
}
function updateViewportWidth() { viewportWidth.value = window.innerWidth; }
watch([search, selectedVersion, locale, collapsedCategories], async () => {
  await nextTick();
  libraryList.value?.scrollTo({ top: 0, debounce: false });
});
onMounted(() => {
  window.addEventListener('resize', updateViewportWidth);
  void loadCatalog();
});
onBeforeUnmount(() => {
  destroyed = true;
  window.removeEventListener('resize', updateViewportWidth);
  requestController?.abort();
  if (previewDialog.value?.open) previewDialog.value.close();
});
</script>

<style scoped>
.animation-browser { display: flex; flex: 1; flex-direction: column; min-height: 0; text-align: left; }
.library-toolbar { flex-shrink: 0; padding: 6px 9px 10px; }
.search-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.search-label { flex: 0 0 auto; font-size: 0.9rem; white-space: nowrap; }
input, select, button { font: inherit; }
input[type='search'] { min-width: 180px; flex: 1; padding: 10px 12px; border: 1px solid rgba(106, 90, 205, 0.22); border-radius: 8px; background: rgba(255, 255, 255, 0.88); color: inherit; }
button, select { color: inherit; border: 1px solid rgba(106, 90, 205, 0.35); background: rgba(255, 255, 255, 0.3); border-radius: 8px; }
button { cursor: pointer; padding: 7px 12px; }
button:where(:not(.category-header)):hover:not(:disabled) { background: rgba(106, 90, 205, 0.1); }
button:disabled { cursor: default; opacity: 0.55; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #5378c8; outline-offset: 2px; }
.search-count, .category-count { color: rgba(0, 0, 0, 0.55); font-size: 0.85rem; white-space: nowrap; }
.search-count { flex: 0 0 auto; }
.toggle-all { flex: 0 0 auto; height: 28px; padding: 0 12px; border-radius: 6px; background: rgba(106, 90, 205, 0.1); color: #4d429b; font-size: 0.85rem; white-space: nowrap; }
.toggle-all:hover:not(:disabled) { background: rgba(106, 90, 205, 0.18); }
.library-controls { display: flex; flex-wrap: wrap; align-items: start; gap: 4px; margin-top: 6px; }
.category-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 4px; flex: 1 1 560px; min-width: 0; }
.category-row { --category-color: #6a5acd; --category-rgb: 106, 90, 205; }
.category-1 { --category-color: #5378c8; --category-rgb: 83, 120, 200; }
.category-2 { --category-color: #4c9a72; --category-rgb: 76, 154, 114; }
.category-3 { --category-color: #a66bb5; --category-rgb: 166, 107, 181; }
.category-4 { --category-color: #c46a62; --category-rgb: 196, 106, 98; }
.category-5 { --category-color: #a77c3d; --category-rgb: 167, 124, 61; }
.category-6 { --category-color: #4d95a8; --category-rgb: 77, 149, 168; }
.category-7 { --category-color: #6f72b8; --category-rgb: 111, 114, 184; }
.category-header { box-sizing: border-box; display: flex; align-items: center; width: 100%; height: 38px; min-width: 0; padding: 0 8px; border: 1px solid rgba(106, 90, 205, 0.2); border-radius: 8px; background: rgba(106, 90, 205, 0.04); color: inherit; cursor: pointer; text-align: left; font-family: inherit; }
.category-header.expanded { border-color: rgba(106, 90, 205, 0.55); background: rgba(106, 90, 205, 0.14); }
.category-header:hover { background: rgba(106, 90, 205, 0.08); }
.category-header:focus-visible { outline: 2px solid #0ea2e5; outline-offset: 2px; }
.category-arrow { margin-right: 8px; font-size: 0.7rem; transition: transform 0.18s ease; }
.category-arrow.expanded { transform: rotate(90deg); }
.category-title { min-width: 0; margin-right: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.version-filter { box-sizing: border-box; height: 38px; max-width: 100%; margin-left: auto; padding: 0 8px; border-color: rgba(106, 90, 205, 0.2); background: #f1f1ff; cursor: pointer; }
.library-content { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.animation-virtual-list { flex: 1; min-height: 0; width: 100%; overflow-anchor: none; }
.category-row { box-sizing: border-box; padding: 0 9px; }
.category-row.group-last { padding-bottom: 18px; }
.animation-category { box-sizing: border-box; min-inline-size: 0; margin: 0; padding: 0 8px 14px; border: solid var(--category-color); border-width: 0 2px; background: rgba(var(--category-rgb), 0.05); }
.animation-category.group-first { border-top-width: 2px; border-top-left-radius: 10px; border-top-right-radius: 10px; padding-top: 10px; }
.animation-category.group-last { border-bottom-width: 2px; border-bottom-left-radius: 10px; border-bottom-right-radius: 10px; padding-bottom: 9px; }
.animation-category legend { color: var(--category-color); padding: 0 7px; margin-left: 3px; font-size: 0.85rem; }
.skill-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); align-items: start; gap: 14px; }
.skill-group { min-width: 0; grid-column: span 6; }
.skill-group.is-single { grid-column: span 3; }
.skill-group.is-wide { grid-column: 1 / -1; }
.skill-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 0 2px 8px; }
.skill-heading h2 { margin: 0; font-size: 0.85rem; font-weight: 500; overflow-wrap: anywhere; }
.skill-meta { display: flex; flex-wrap: wrap; gap: 4px 8px; max-width: 100%; color: #7b7f91; font-size: 0.72rem; overflow-wrap: anywhere; }
.parts-grid { display: grid; grid-template-columns: repeat(var(--part-columns), minmax(0, 1fr)); gap: 7px; }
.animation-part { min-width: 0; overflow: hidden; border-radius: 9px; background: rgba(255, 255, 255, 0.6); }
.part-preview { position: relative; }
.preview-open { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; border-radius: 0; padding: 0; background: transparent; }
.preview-open:hover:not(:disabled) { background: rgba(255, 255, 255, 0.025); }
.preview-open:focus-visible { outline-offset: -3px; }
.expand-icon { position: absolute; top: 7px; right: 8px; font-size: 1.1rem; line-height: 1; color: #d5dcee; }
.part-info { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 9px; }
.copy-name { max-width: 100%; min-width: 0; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; overflow-wrap: anywhere; cursor: copy; }
.copy-name:hover:not(:disabled) { background: none; text-decoration: underline; }
.part-name { min-width: 0; font-size: 0.82rem; overflow-wrap: anywhere; }
.part-meta { display: flex; flex-wrap: wrap; gap: 4px 8px; color: #6a5acd; font-size: 0.7rem; max-width: 100%; overflow-wrap: anywhere; }
.status-panel { min-height: 240px; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; color: #71768a; padding: 24px; box-sizing: border-box; }
.status-panel p { margin: 0; line-height: 1.6; }
.loading-spinner { width: 22px; height: 22px; border: 2px solid rgba(106, 90, 205, 0.15); border-top-color: #6a5acd; border-radius: 50%; animation: animation-viewer-spin 0.8s linear infinite; }
@keyframes animation-viewer-spin { to { transform: rotate(360deg); } }
.animation-preview-dialog { width: min(900px, calc(100% - 36px)); max-height: calc(100% - 36px); padding: 16px; box-sizing: border-box; border: 1px solid rgba(106, 90, 205, 0.3); border-radius: 14px; background: #f1f1ff; color: #2c3e50; overflow: auto; }
.animation-preview-dialog::backdrop { background: rgba(24, 29, 48, 0.6); }
.preview-heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin-bottom: 12px; }
.preview-heading h2 { min-width: 0; margin: 0; font-size: 1rem; font-weight: 500; overflow-wrap: anywhere; }
.close-preview { padding: 2px 10px; font-size: 1.5rem; }
@media (min-width: 1500px) { .skill-group.is-single { grid-column: span 2; } .skill-group { grid-column: span 4; } .skill-group.is-wide { grid-column: 1 / -1; } }
@media (max-width: 950px) { .skill-group { grid-column: 1 / -1; } .skill-group.is-single { grid-column: span 4; } }
@media (max-width: 600px) {
  .library-toolbar { padding: 5px 4px 9px; }
  .category-row { padding-left: 4px; padding-right: 4px; }
  .search-row { gap: 8px; }
  .search-row input { flex-basis: calc(100% - 60px); min-width: 0; }
  .toggle-all { margin-left: auto; }
  .skill-group.is-single { grid-column: span 6; }
  .parts-grid { grid-template-columns: 1fr; }
  .skill-group.is-single .parts-grid { grid-template-columns: 1fr; }
  .part-info { padding: 8px; }
  .part-meta { font-size: 0.72rem; }
  .animation-preview-dialog { width: calc(100% - 20px); padding: 12px; }
}
@media (prefers-reduced-motion: reduce) { .loading-spinner { animation: none; } .category-arrow { transition: none; } }
</style>
