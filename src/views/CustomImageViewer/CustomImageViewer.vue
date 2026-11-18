<template>
  <Splitter ref="splitter" class="image-viewer" :layout="compact ? 'vertical' : 'horizontal'" :gutter-size="6">
    <SplitterPanel :size="compact ? 40 : 70" :min-size="24">
      <SectionLayout :title="t('customImageViewer.ui.library')">
        <div class="library">
          <div class="search-bar">
            <label class="search-label" for="image-search">{{ t('customImageViewer.ui.search') }}</label>
            <input id="image-search" v-model.trim="query" type="search" autocomplete="off"
              :placeholder="t('bgmPlayer.ui.searchPlaceholder')" @keydown.enter="selectFirstResult" />
            <span class="search-count" role="status">{{ countText }}</span>
            <button type="button" class="expand-all-button" :disabled="!groups.length" @click="toggleAll">
              {{ t(allExpanded ? 'bgmPlayer.ui.collapseAll' : 'bgmPlayer.ui.expandAll') }}
            </button>
          </div>
          <div class="library-controls">
            <div class="category-controls" role="group" :aria-label="t('clientUIAnimationEditor.ui.imageLibrary.categories.label')">
              <button v-for="group in groups" :key="group.key" type="button" class="category-header"
                :class="{ expanded: activeGroups.has(group.key) }" :aria-expanded="activeGroups.has(group.key)"
                aria-controls="custom-image-gallery" @click="toggleGroup(group.key)">
                <span class="category-arrow" :class="{ expanded: activeGroups.has(group.key) }" aria-hidden="true">▶</span>
                <span class="category-title" :title="group.label">{{ group.label }}</span>
                <span class="category-count">{{ group.assets.length }}</span>
              </button>
            </div>
            <DropdownSelect v-model="version" class="version-filter" :label="t('bgmPlayer.ui.versionFilter')"
              :options="versionOptions" :disabled="imageCatalogLoading || !imageAssets.length" />
          </div>
          <div v-if="imageCatalogLoadError" class="notice" role="status">
            {{ imageCatalogLoadError }} <button @click="loadImageCatalog(true, locale)">{{ t('clientUIAnimationEditor.ui.common.retry') }}</button>
          </div>
          <div id="custom-image-gallery" ref="gallery" class="gallery">
            <VVirtualList v-if="rows.length" ref="list" class="scroll-list" :items="rows" :item-size="rowHeight" :padding-top="10" item-resizable>
              <template #default="{ item }: { item: ImageRow }">
                <div class="group-row" :class="{ first: item.first, last: item.last }" :style="{ '--category-color': item.color }">
                  <div class="asset-group-frame">
                    <h3 v-if="item.first" class="asset-group-label">{{ item.label }}</h3>
                    <div class="tile-row" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, height: rowHeight + 'px' }">
                      <button v-for="asset in item.assets" :key="asset.id" class="tile" :data-image-id="asset.id"
                        :aria-label="t('clientUIAnimationEditor.ui.imageLibrary.selectImageLabel', { value: asset.id })"
                        :aria-pressed="asset.id === selected?.id" @click="selectImage(asset)">
                        <span class="thumb">
                          <img v-if="asset.src && !failedThumbs.has(asset.id)" :key="asset.src" v-visible-thumbnail :data-src="asset.src"
                            alt="" loading="lazy" decoding="async" draggable="false"
                            @load="thumbnailLoaded(asset.id, $event)" @error="failedThumbs.add(asset.id)" />
                          <span v-else>{{ t('customImageViewer.ui.unavailable') }}</span>
                        </span>
                        <span class="tile-id">{{ asset.id }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </template>
            </VVirtualList>
            <p v-else-if="groups.length" class="message" role="status">{{ t('bgmPlayer.ui.collapsedHint') }}</p>
            <p v-else-if="imageCatalogLoading || imageAssets.length || !imageCatalogLoadError" class="message" role="status">
              {{ t(imageCatalogLoading ? 'clientUIAnimationEditor.ui.images.loadingLibrary' : 'clientUIAnimationEditor.ui.images.noMatches') }}
            </p>
          </div>
        </div>
      </SectionLayout>
    </SplitterPanel>
    <SplitterPanel :size="compact ? 60 : 30" :min-size="20">
      <SectionLayout :title="t('customImageViewer.ui.preview')">
        <div v-if="selected" class="inspector">
          <div class="selection">
            <button class="copy-id" :title="t('soundEffectPlayer.ui.copyHint')" @click="Clipboard(String(selected.id))">
              ID {{ selected.id }}
            </button>
            <span :title="selectedCategories">{{ selectedCategories }}</span>
          </div>
          <ImageComparison :asset="selected" :thumbnail="selectedThumbnail" />
        </div>
        <p v-else class="message">{{ t('customImageViewer.ui.select') }}</p>
      </SectionLayout>
    </SplitterPanel>
  </Splitter>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, type ObjectDirective } from 'vue';
import Splitter from 'primevue/splitter';
import SplitterPanel from 'primevue/splitterpanel';
import { VVirtualList, type VVirtualListInst } from 'vueuc';
import SectionLayout from '@/components/Layout/SectionLayout.vue';
import DropdownSelect from '@/components/DropdownSelect.vue';
import { locale, t } from '@/i18n';
import { Clipboard } from '@/utils/clipboard';
import { clientImageCatalog, type UIImageAsset } from './imageAssets';
import ImageComparison from './ImageComparison.vue';

const { imageAssets, imageAssetById, imageCategories, imageCategoryLabel, loadImageCatalog, imageCatalogLoadError,
  imageCatalogLoading, useImageCatalogTranslations } = clientImageCatalog;
const loadTranslations = useImageCatalogTranslations();
const query = ref('');
const version = ref('');
const versionOptions = computed(() => [
  { value: '', label: t('bgmPlayer.ui.allVersions') },
  ...[...new Set(imageAssets.flatMap(asset => asset.giVersion ? [asset.giVersion] : []))]
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .map(value => ({ value, label: value })),
]);
const catalogGroups = computed(() => {
  const byCategory = new Map(imageCategories.value.map(key => [key, [] as UIImageAsset[]]));
  for (const asset of imageAssets) {
    for (const key of asset.categories.length ? asset.categories : ['uncategorized']) {
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key)!.push(asset);
    }
  }
  return Array.from(byCategory, ([key, assets]) => ({
    key, assets, label: key === 'uncategorized' ? t('bgmPlayer.ui.uncategorized') : imageCategoryLabel(key, locale.value),
  }));
});
const groups = computed(() => {
  const keyword = query.value.toLowerCase();
  return catalogGroups.value.map(group => {
    const categoryMatches = group.label.toLowerCase().includes(keyword);
    const assets = group.assets.filter(asset => (!version.value || asset.giVersion === version.value)
      && (categoryMatches || String(asset.id).includes(keyword)));
    return { ...group, assets };
  }).filter(group => group.assets.length);
});
const countText = computed(() => {
  const total = imageAssets.length;
  if (!query.value && !version.value) return t('customImageViewer.ui.totalCount', { count: total });
  const count = new Set(groups.value.flatMap(group => group.assets.map(asset => asset.id))).size;
  return t('customImageViewer.ui.filteredCount', { count, total });
});
const expandedGroups = reactive(new Set<string>());
const searchGroups = ref(new Set<string>());
const activeGroups = computed(() => query.value ? searchGroups.value : expandedGroups);
const allExpanded = computed(() => groups.value.length > 0 && groups.value.every(group => activeGroups.value.has(group.key)));
watch(groups, matches => {
  if (query.value) searchGroups.value = new Set(matches.map(group => group.key));
});
function toggleGroup(key: string) {
  if (activeGroups.value.has(key)) activeGroups.value.delete(key);
  else activeGroups.value.add(key);
}
function toggleAll() {
  const collapse = allExpanded.value;
  for (const group of groups.value) {
    if (collapse) activeGroups.value.delete(group.key);
    else activeGroups.value.add(group.key);
  }
}
const selectedId = ref<number>();
const selectedThumbnail = shallowRef<HTMLImageElement>();
const selected = computed(() => selectedId.value === undefined ? undefined : imageAssetById.get(selectedId.value));
function selectImage(asset: UIImageAsset) {
  selectedThumbnail.value = gallery.value?.querySelector<HTMLImageElement>(`[data-image-id="${asset.id}"] img`) ?? undefined;
  selectedId.value = asset.id;
}
function thumbnailLoaded(id: number, event: Event) {
  if (id === selectedId.value && !selectedThumbnail.value?.naturalWidth) {
    selectedThumbnail.value = event.currentTarget as HTMLImageElement;
  }
}
async function selectFirstResult(event: KeyboardEvent) {
  const first = groups.value[0];
  if (event.isComposing || !first) return;
  activeGroups.value.add(first.key);
  selectImage(first.assets[0]);
  await nextTick();
  list.value?.scrollTo({ position: 'top' });
}
const selectedCategories = computed(() => selected.value?.categories.map(key => imageCategoryLabel(key, locale.value)).join(' / '));
const failedThumbs = reactive(new Set<number>());
// The virtual list mounts buffer rows. Assign src only when the thumbnail
// intersects the visible gallery, so those rows do not start PNG downloads.
const thumbnailObserver = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
  for (const entry of entries) {
    const image = entry.target as HTMLImageElement;
    if (entry.isIntersecting && image.isConnected) {
      if (image.getAttribute('src') !== image.dataset.src) image.src = image.dataset.src!;
      thumbnailObserver?.unobserve(image);
    }
  }
});
const vVisibleThumbnail: ObjectDirective<HTMLImageElement> = {
  mounted(image) {
    if (thumbnailObserver) thumbnailObserver.observe(image);
    else image.src = image.dataset.src!;
  },
  beforeUnmount(image) { thumbnailObserver?.unobserve(image); },
};

// Use the sound library's category palette, keyed by the stable catalog ID.
const categoryColors = ['#5378c8', '#4c9a72', '#a66bb5', '#c46a62', '#a77c3d', '#4d95a8', '#6f72b8'];
interface ImageRow { key: string; assets: UIImageAsset[]; label: string; color?: string; first: boolean; last: boolean }
const columns = ref(6);
const rowHeight = 106;
const rows = computed(() => {
  const result: ImageRow[] = [];
  for (const group of groups.value) {
    if (!activeGroups.value.has(group.key)) continue;
    const color = categoryColors[(Number(group.key) - 1) % categoryColors.length];
    for (let i = 0; i < group.assets.length; i += columns.value) {
      result.push({ key: `${group.key}-${group.assets[i].id}`, label: group.label, color, first: i === 0,
        last: i + columns.value >= group.assets.length, assets: group.assets.slice(i, i + columns.value) });
    }
  }
  return result;
});
const list = ref<VVirtualListInst>();
const gallery = ref<HTMLElement>();
const narrowScreen = window.matchMedia('(max-width: 680px)');
const compact = ref(narrowScreen.matches);
const splitter = ref<InstanceType<typeof Splitter>>();
async function updateLayout() {
  compact.value = narrowScreen.matches;
  await nextTick();
  splitter.value?.resetState();
}
let resize: ResizeObserver;
watch([query, version], async () => { await nextTick(); list.value?.scrollTo({ position: 'top' }); });
onMounted(() => {
  narrowScreen.addEventListener('change', updateLayout);
  resize = new ResizeObserver(([entry]) => { columns.value = Math.max(1, Math.floor((entry.contentRect.width - 12) / 100)); });
  resize.observe(gallery.value!);
  void loadTranslations();
  void loadImageCatalog(false, locale.value);
});
onBeforeUnmount(() => { narrowScreen.removeEventListener('change', updateLayout); resize?.disconnect(); thumbnailObserver?.disconnect(); });
</script>

<style scoped src="../../assets/assetLibraryToolbar.css"></style>
<style scoped src="../../assets/assetLibraryGroup.css"></style>
<style scoped>
.image-viewer { height: 100%; width: 100%; border: 0; background: transparent; color: #2c3953; }
.image-viewer :deep(.p-splitterpanel) { min-width: 0; min-height: 0; }
.image-viewer :deep(.Section > .panel) { padding: 0; }
.image-viewer :deep(.p-splitter-gutter) { background: transparent; }
.library { min-height: 0; height: 100%; box-sizing: border-box; padding: .3rem; display: flex; flex-direction: column; container-type: inline-size; }
.library-controls { margin: 4px 8px 6px; }
button { font: inherit; color: inherit; cursor: pointer; }
.notice button, .copy-id { background: white; border: 1px solid #d4d8e6; border-radius: 6px; padding: 5px 9px; font-size: 13px; }
.copy-id:hover { border-color: #8075c9; }
.notice { padding: 6px 14px; color: #76501d; }
.gallery { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 0 8px; }
.group-row { --category-background: color-mix(in srgb, var(--category-color, #6a5acd) 5%, transparent); }
.group-row.last { padding-bottom: 16px; }
.group-row:not(.first) > .asset-group-frame { padding-top: 0; border-top: 0; border-top-left-radius: 0; border-top-right-radius: 0; }
.group-row:not(.last) > .asset-group-frame { padding-bottom: 0; border-bottom: 0; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.scroll-list { position: relative; z-index: 0; height: 100%; overflow-anchor: none; }
.tile-row { display: grid; box-sizing: border-box; gap: 7px; padding-bottom: 6px; }
.tile { min-width: 0; display: flex; flex-direction: column; align-items: stretch; border-radius: 7px; padding: 0; overflow: hidden; background: white; border: 2px solid #d8dcea; }
.tile:hover { border-color: #9790c6; }
.tile[aria-pressed="true"] { border-color: #6557c4; background: #ebe8ff; color: #392b87; }
.thumb { display: grid; place-items: center; flex: 1; min-height: 0; color: white; font-size: 11px;
  background: repeating-conic-gradient(#697686 0 25%, #717e8e 0 50%) 0 0 / 16px 16px; }
.thumb img { display: block; width: 100%; height: 100%; min-height: 0; box-sizing: border-box; padding: 6px; object-fit: contain; }
.tile-id { padding: 4px; font: 12px/15px ui-monospace, Consolas, monospace; }
.inspector { box-sizing: border-box; flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; }
.selection { display: flex; align-items: center; gap: 10px; text-align: left; }
.selection span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.copy-id { flex: none; font: 600 13px/18px ui-monospace, Consolas, monospace; }
.selection span, .message { color: #5b667d; font-size: 13px; }
.message { margin: auto; padding: 20px; text-align: center; }
button:focus-visible, input:focus-visible { outline: 2px solid #594bb1; outline-offset: -2px; }
@container (max-width: 640px) {
  .library-controls { flex-wrap: nowrap; margin-inline: 0; }
  .category-controls { display: flex; overflow-x: auto; }
  .category-header { flex: none; width: auto; }
  .version-filter { flex: none; }
  .search-bar { gap: 4px 8px; }
  .search-bar input { min-width: 100px; }
}
</style>
