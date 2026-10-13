<template>
  <section ref="panel" class="image-library" role="dialog" :aria-label="t('clientUIAnimationEditor.ui.imageLibrary.title')" tabindex="-1" @keydown.esc.stop.prevent="$emit('close')" @pointerdown.stop>
    <header><strong>{{ t('clientUIAnimationEditor.ui.imageLibrary.title') }}</strong><span>{{ t('clientUIAnimationEditor.ui.common.itemCount', { count: filteredAssets.length }) }}</span><button class="refresh-library" :disabled="imageCatalogLoading" @click="loadImageCatalog(true, locale)">{{ t('clientUIAnimationEditor.ui.actions.refresh') }}</button><button :aria-label="t('clientUIAnimationEditor.ui.images.closeLibrary')" @click="$emit('close')">×</button></header>
    <div class="library-search"><EditorIcon name="search" :size="18" /><input ref="searchInput" v-model="search" :aria-label="t('clientUIAnimationEditor.ui.images.searchResourceLabel')" :placeholder="t('clientUIAnimationEditor.ui.imageLibrary.searchPlaceholder')" /><button v-if="search" :aria-label="t('clientUIAnimationEditor.ui.imageLibrary.clearSearch')" @click="search = ''">×</button></div>
    <div v-if="imageCatalogError" class="library-status" role="status">{{ imageCatalogError }} <button @click="loadImageCatalog(true, locale)">{{ t('clientUIAnimationEditor.ui.common.retry') }}</button></div>
    <div v-if="selectionError" class="library-status" role="status">{{ selectionError }}</div>
    <div class="library-body">
      <nav :aria-label="t('clientUIAnimationEditor.ui.imageLibrary.categories.label')"><button :class="{ active: !category }" @click="category = ''">{{ t('clientUIAnimationEditor.ui.imageLibrary.allImages') }}</button><button v-for="key in imageCategories" :key="key" :class="{ active: category === key }" @click="category = key">{{ imageCategoryLabel(key, locale) }}</button></nav>
      <div class="library-results">
        <p v-if="imageCatalogLoading" role="status">{{ t('clientUIAnimationEditor.ui.images.loadingLibrary') }}</p>
        <div class="library-grid">
          <button class="asset-tile empty-asset" :class="{ selected: selectedId === null }" :aria-label="t('clientUIAnimationEditor.ui.images.none')" @click="clearSelection"><span class="thumbnail"></span><b>{{ t('clientUIAnimationEditor.ui.imageLibrary.noImage') }}</b><i v-if="selectedId === null">✓</i></button>
          <button v-for="asset in filteredAssets" :key="asset.id" class="asset-tile" :class="{ selected: selectedId === asset.id }" :aria-label="t('clientUIAnimationEditor.ui.imageLibrary.selectImageLabel', { value: asset.id })" :aria-pressed="selectedId === asset.id" :title="`${asset.categories.map(key => imageCategoryLabel(key, locale)).join(' / ')} · ${asset.id}`" @click="selectAsset(asset)">
            <span class="thumbnail"><img v-if="asset.src && !asset.missing" :src="asset.src" alt="" loading="lazy" @error="asset.missing = true" /></span><b>{{ asset.id }}</b><i v-if="selectedId === asset.id">✓</i>
          </button>
        </div>
        <p v-if="!imageCatalogLoading && !filteredAssets.length">{{ t('clientUIAnimationEditor.ui.images.noMatches') }}</p>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { t } from '../../i18n';
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import EditorIcon from "./EditorIcon.vue";
import { clientImageCatalog, type createImageCatalog, type UIImageAsset } from "./imageAssets";
const props = withDefaults(defineProps<{ selectedId: number | null; catalog?: ReturnType<typeof createImageCatalog>; loadMetadata?: boolean }>(), { loadMetadata: true });
const { imageAssets, imageAssetById, imageCategories, imageCategoryLabel, imageCatalogLoading, imageCatalogError, loadImageCatalog, useImageCatalogTranslations, loadSpriteMetadata } = props.catalog ?? clientImageCatalog;
const loadTranslations = useImageCatalogTranslations();
const emit = defineEmits<{ (event: "close"): void; (event: "select", id: number | null): void }>();
const { locale } = useI18n();
const search = ref("");
const category = ref(imageAssetById.get(props.selectedId ?? -1)?.categories[0] ?? "");
const panel = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
const selectionError = ref<string>('');
let selectionVersion = 0;
let previousFocus: HTMLElement | null = null;
const filteredAssets = computed(() => {
  const query = search.value.trim().toLowerCase();
  return imageAssets.filter(asset => (!category.value || asset.categories.includes(category.value)) && (!query || `${asset.id} ${asset.categories.map(key => imageCategoryLabel(key, locale.value)).join(' ')}`.toLowerCase().includes(query)));
});
async function selectAsset(asset: UIImageAsset) {
  const version = ++selectionVersion;
  selectionError.value = "";
  const metadata = props.loadMetadata ? await loadSpriteMetadata(asset) : undefined;
  if (version !== selectionVersion) return;
  if (props.loadMetadata && asset.borderPath && !metadata) selectionError.value = t('clientUIAnimationEditor.ui.imageLibrary.stretchMetadataUnavailable');
  emit("select", asset.id);
}
function clearSelection() { selectionVersion++; selectionError.value = ""; emit("select", null); }
onMounted(() => { previousFocus = document.activeElement as HTMLElement; searchInput.value?.focus(); void loadTranslations(); void loadImageCatalog(false, locale.value); });
onBeforeUnmount(() => { selectionVersion++; if (previousFocus?.isConnected) previousFocus.focus(); });
</script>
<style scoped>
.image-library { position: absolute; inset: auto 0 0; z-index: 100; display: flex; flex-direction: column; height: min(420px, 48%); min-height: 220px; background: #292d3b; border-top: 2px solid #606779; color: #d8dbe5; box-shadow: 0 -8px 28px #0003; font-size: 12px; outline: none; }
header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #20232d; }
header span { color: #9da7ba; font-size: 11px; } header button { font-size: 23px; }
header .refresh-library { margin-left: auto; font-size: 12px; } .refresh-library:disabled { opacity: .5; cursor: wait; }
button { border: 0; border-radius: 4px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid #89a7ff; outline-offset: -2px; }
.library-search { display: flex; align-items: center; gap: 8px; margin: 8px; padding: 4px 10px; border: 2px solid #858b98; border-radius: 20px; background: #20232d; }
.library-search input { width: 100%; height: 23px; background: transparent; border: 0; color: inherit; outline: none; font: inherit; }
.library-body { display: flex; flex: 1; min-height: 0; padding-bottom: 8px; }
nav { flex: 0 0 205px; overflow-y: auto; padding: 0 8px; border-right: 3px solid #424756; }
nav button { display: block; width: 100%; padding: 9px 14px; text-align: left; margin-bottom: 2px; }
nav button:hover { background: #343c50; } nav button.active { background: #3d569c; color: white; }
.library-results { flex: 1; min-width: 0; overflow-y: auto; padding: 4px 18px; }
.library-grid { display: grid; grid-template-columns: repeat(auto-fill, 80px); gap: 7px; align-content: start; }
.asset-tile { position: relative; height: 82px; border: 2px solid #373c4a; background: #252935; padding: 3px; overflow: hidden; }
.asset-tile:hover { border-color: #7c91c4; } .asset-tile.selected { border-color: #a5ca52; }
.thumbnail { display: block; height: 53px; } .thumbnail img { width: 100%; height: 100%; object-fit: contain; }
.asset-tile b { font-size: 11px; } .asset-tile i { position: absolute; top: 0; right: 0; background: #b9ec59; color: #536528; font-style: normal; padding: 0 3px; }
.library-status { padding: 4px 12px; color: #e8c491; } .library-status button { text-decoration: underline; }
@media (max-width: 900px) { nav { flex-basis: 150px; } }
</style>
