<template>
  <SectionLayout :title="t('effectPlayer.title')">
    <div class="browser">
      <div class="toolbar">
        <div class="toolbar-row">
          <label class="search-label" for="effect-search">{{ t('effectPlayer.search.label') }}</label>
          <input id="effect-search" v-model="search" type="search" autocomplete="off" :placeholder="t('effectPlayer.search.placeholder')" />
        </div>

        <div class="toolbar-row">
          <div class="tabs">
            <button
              v-for="tab in loopTabs"
              :key="tab.value"
              class="tab"
              :class="{ active: loopFilter === tab.value }"
              type="button"
              @click="loopFilter = tab.value"
            >
              {{ tab.label }}
            </button>
            <button
              v-for="tab in audioTabs"
              :key="tab.value"
              class="tab"
              :class="{ active: audioFilter === tab.value }"
              :aria-pressed="audioFilter === tab.value"
              :title="t('effectPlayer.audio.clearHint')"
              type="button"
              @click="audioFilter = audioFilter === tab.value ? 'all' : tab.value"
            >
              {{ tab.label }}
            </button>
            <label class="version-filter">
              {{ t('effectPlayer.version.label') }}
              <select v-model="versionFilter" :aria-label="t('effectPlayer.version.label')">
                <option value="all">{{ t('effectPlayer.version.all') }}</option>
                <option v-for="version in gameVersions" :key="version" :value="version">{{ version || t('effectPlayer.version.unspecified') }}</option>
              </select>
            </label>
          </div>
          <div class="stats">{{ statsText }}</div>
        </div>

        <EffectTagFilter v-model="selectedTagIds" :groups="tagGroups" :items="searchedEffects" />
      </div>

      <div class="grid-wrap">
        <div v-if="loading" class="status-panel">{{ t('effectPlayer.loading') }}</div>
        <div v-else-if="filteredEffects.length === 0" class="status-panel">{{ t('effectPlayer.empty') }}</div>
        <VVirtualList
          v-else
          ref="effectListRef"
          class="effect-list"
          :items="rows"
          :item-size="itemSize"
          key-field="id"
          ignore-item-resize
        >
          <template #default="{ item: row }: { item: EffectRow }">
            <div class="effect-row">
              <article
                v-for="effect in row.data"
                :key="effect.id"
                class="effect-card"
                data-effect-card
                :data-effect-id="effect.id"
                :aria-current="effect.id === selectedEffect?.id ? 'true' : undefined"
                @click="openModal(effect)"
              >
                <button class="open-preview" type="button" :aria-label="t('effectPlayer.preview', { name: effectName(effect), id: effect.id })" @click.stop="openModal(effect)">
                  <EffectMedia :item="effect" :title="effectName(effect)" :suspended="Boolean(selectedEffect)" />
                </button>
                <div class="effect-info">
                  <button class="effect-name card-copy" type="button" :title="t('effectPlayer.copyNamedEffect', { name: effectName(effect) })" @click.stop="Clipboard(effectName(effect))">
                    {{ effectName(effect) }}
                  </button>
                <button class="effect-id card-copy" type="button" :title="t('effectPlayer.copyId')" @click.stop="Clipboard(String(effect.id))">{{ t('effectPlayer.configId', { id: effect.id }) }}</button>
                <div class="effect-meta">
                  <span v-if="effect.duration >= 0">{{ formatDuration(effect) }}</span>
                  <span>{{ t(effect.isLoop ? 'effectPlayer.loop.shortLoop' : 'effectPlayer.loop.shortOnce') }}</span>
                </div>
                <div class="effect-description" @click.stop>
                  <AssetFeatureSummary v-if="featureParts(effect.id).length" :parts="featureParts(effect.id)" :locale="locale" />
                </div>
                <div class="card-tags">
                  <span
                    v-for="tagId in visibleTags(effect)"
                    :key="`${effect.id}-${tagId}`"
                    class="mini-tag"
                    @click.stop="toggleTag(tagId)"
                  >
                    {{ tagName(tagId) }}
                  </span>
                  <span v-if="hiddenTagCount(effect) > 0" class="mini-tag more">
                    +{{ hiddenTagCount(effect) }}
                  </span>
                </div>
              </div>
            </article>
            <div
              v-for="n in rowPlaceholders(row)"
              :key="`pad-${row.id}-${n}`"
              class="effect-card placeholder-card"
            />
            </div>
          </template>
        </VVirtualList>
      </div>
    </div>
  </SectionLayout>

  <Teleport to="body">
    <div v-if="selectedEffect" class="modal" @click.self="closeModal">
      <div class="modal-content">
        <button class="close-button" type="button" :aria-label="t('effectPlayer.close')" @click="closeModal">&times;</button>
        <div class="modal-body">
          <EffectMedia :key="`${selectedEffect.id}-${selectedEffectStartPaused}`" :item="selectedEffect" :title="effectName(selectedEffect)" variant="modal" :start-paused="selectedEffectStartPaused" />
          <div class="modal-info">
            <h2 class="modal-title">
              <button class="copy-name" type="button" :title="t('effectPlayer.copyName')" @click="Clipboard(effectName(selectedEffect))">{{ effectName(selectedEffect) }}</button>
            </h2>
            <button class="modal-id" type="button" :title="t('effectPlayer.copyId')" @click="Clipboard(String(selectedEffect.id))">{{ t('effectPlayer.configId', { id: selectedEffect.id }) }}</button>
            <p v-if="Number.isFinite(selectedEffect.duration)" class="modal-meta">
              {{ t('effectPlayer.duration.description', { duration: formatDuration(selectedEffect), type: t(selectedEffect.isLoop ? 'effectPlayer.loop.loop' : 'effectPlayer.loop.once') }) }}
            </p>
            <div class="modal-tags">
              <button
                v-for="tagId in selectedEffect.tagList"
                :key="`modal-${tagId}`"
                class="tag-chip"
                :class="{ active: selectedTagIds.includes(tagId) }"
                type="button"
                @click="toggleTag(tagId)"
              >
                {{ tagName(tagId) }}
              </button>
            </div>
            <div class="effect-feature-details">
              <AssetFeaturePanel v-if="selectedFeatureParts.length" :parts="selectedFeatureParts" :locale="locale" />
              <p v-else-if="featureStatus === 'ready'" class="feature-status">{{ t('effectPlayer.features.empty') }}</p>
              <p v-if="featureStatus !== 'ready'" class="feature-status" role="status">
                {{ t(`effectPlayer.features.${featureStatus === 'loading' ? 'loading' : featureStatus === 'stale' ? 'stale' : 'unavailable'}`) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import { Clipboard } from "@/utils/clipboard";
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { createCachedText } from "@/i18n/cachedText";
import { useI18n } from "vue-i18n";
import { loadOssTranslations } from "@/i18n";
import { toast } from "vue-sonner";
import { VVirtualList } from "vueuc";
import EffectMedia from "./EffectMedia.vue";
import EffectTagFilter from "./EffectTagFilter.vue";
import { buildEffectTagGroups, matchesEffectTagGroups } from "./tagFilters";
import { buildEffectSearchIndex } from "./searchIndex";
import { effectNameKey, effectTagKey } from "./resourceKeys";
import { createOss } from "@/utils/oss";
import { loadAssetFeatures, type AssetFeatureCollection } from "@/utils/assetFeatures";
import AssetFeatureSummary from "@/components/AssetFeatures/AssetFeatureSummary.vue";
import AssetFeaturePanel from "@/components/AssetFeatures/AssetFeaturePanel.vue";
import {
  EffectDataFile,
  EffectItem,
  EffectLoopFilter,
  EffectRow,
} from "./types/EffectData";

const composer = useI18n({ useScope: "global" });
const route = useRoute();
const { t, messages, locale } = composer;
const resourceText = createCachedText(composer);
const oss = createOss("EffectPlayer");
const CARD_TAG_LIMIT = 4;
const itemSize = 318;
const assetFeatures = shallowRef<AssetFeatureCollection | null>(null);
const featuresLoading = ref(true);
const featureStatus = computed(() => featuresLoading.value ? "loading" : assetFeatures.value?.status ?? "unavailable");
const featureParts = (id: string) => assetFeatures.value?.get(id, locale.value) ?? [];

const loopTabs = computed<{ value: EffectLoopFilter; label: string }[]>(() => [
  { value: "all", label: t("effectPlayer.loop.all") },
  { value: "once", label: t("effectPlayer.loop.once") },
  { value: "loop", label: t("effectPlayer.loop.loop") },
]);

const loading = ref(true);
const audioTabs = computed(() => [
  { value: "with", label: t("effectPlayer.audio.with") },
  { value: "without", label: t("effectPlayer.audio.without") },
] as const);
const audioFilter = ref<"all" | "with" | "without">("all");
const versionFilter = ref("all");
const search = ref("");
const loopFilter = ref<EffectLoopFilter>("all");
const selectedTagIds = ref<number[]>([]);
const selectedEffect = shallowRef<EffectItem | null>(null);
const selectedFeatureParts = computed(() => selectedEffect.value ? featureParts(selectedEffect.value.id) : []);
const selectedEffectStartPaused = ref(false);
const effectListRef = ref<InstanceType<typeof VVirtualList> | null>(null);
// Catalogs are replaced as a whole; avoid proxying thousands of immutable records.
const effectData = shallowRef<Record<string, EffectItem>>({});
const tagData = shallowRef<Record<string, string>>({});
const sourceTagData = shallowRef<Record<string, string>>({});
const tagCategories = shallowRef<Record<string, number[]>>({});
const effects = computed(() => Object.values(effectData.value));
const columns = ref(4);
const gameVersions = computed(() => [...new Set(effects.value.map((item) => item.giVersion?.trim() || ""))]
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));

const rawTagGroups = computed(() => buildEffectTagGroups(tagData.value, tagCategories.value));
const tagGroups = computed(() => rawTagGroups.value
  .map((group) => ({
    ...group,
    name: resourceText(group.id === "uncategorized" ? "effectPlayer.filter.uncategorized" : group.name),
    tags: group.tags.map((tag) => ({ ...tag, name: tagName(tag.id) })),
  })));

const searchIndex = computed(() => buildEffectSearchIndex(
  effects.value, tagData.value, Object.values(messages.value), sourceTagData.value, assetFeatures.value?.searchText,
));

const searchedEffects = computed(() => {
  const q = search.value.trim().toLowerCase();
  return effects.value.filter((item) => {
    if (loopFilter.value === "loop" && !item.isLoop) return false;
    if (loopFilter.value === "once" && item.isLoop) return false;
    if (audioFilter.value === "with" && !item.hasAudio) return false;
    if (audioFilter.value === "without" && item.hasAudio) return false;
    if (versionFilter.value !== "all" && (item.giVersion?.trim() || "") !== versionFilter.value) return false;
    if (!q) return true;
    return searchIndex.value.get(String(item.id))?.includes(q) ?? false;
  });
});

const filteredEffects = computed(() => selectedTagIds.value.length
  ? searchedEffects.value.filter((item) => matchesEffectTagGroups(item, selectedTagIds.value, rawTagGroups.value))
  : searchedEffects.value);

const rows = computed<EffectRow[]>(() => {
  const list = filteredEffects.value;
  const count = Math.max(1, columns.value);
  const result: EffectRow[] = [];
  for (let i = 0; i < list.length; i += count) {
    result.push({
      id: String(i / count),
      data: list.slice(i, i + count),
    });
  }
  return result;
});

const statsText = computed(() => {
  const total = Object.keys(effectData.value).length;
  const shown = filteredEffects.value.length;
  const label =
    (loopTabs.value.find((tab) => tab.value === loopFilter.value)?.label ?? t("effectPlayer.loop.all")) +
    (audioFilter.value === "all" ? "" : ` · ${audioTabs.value.find((tab) => tab.value === audioFilter.value)?.label}`) +
    (versionFilter.value === "all" ? "" : ` · ${versionFilter.value || t('effectPlayer.version.unspecified')}`);
  if (shown === total && !search.value.trim() && selectedTagIds.value.length === 0) {
    return t("effectPlayer.stats.total", { label, total });
  }
  return t("effectPlayer.stats.filtered", { label, shown, total });
});

watch([() => route.query.id, loading], async ([id, isLoading], _previous, onCleanup) => {
  if (isLoading || id === undefined) return;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  const item = typeof id === "string" && /^\d+$/.test(id)
    ? effects.value.find((effect) => String(effect.id) === id)
    : undefined;
  if (!item) {
    closeModal();
    toast.error(t("effectPlayer.deepLink.notFound"));
    return;
  }
  search.value = "";
  loopFilter.value = "all";
  audioFilter.value = "all";
  versionFilter.value = "all";
  selectedTagIds.value = [];
  await nextTick();
  if (cancelled || route.query.id !== id) return;
  const index = rows.value.findIndex((row) => row.data.some((effect) => effect.id === item.id));
  if (index >= 0) effectListRef.value?.scrollTo({ index, behavior: "auto", debounce: false });
  openModal(item, true);
}, { immediate: true, flush: "post" });

onMounted(async () => {
  updateColumns();
  window.addEventListener("resize", updateColumns);
  window.addEventListener("keydown", onKeydown);
  try {
    const data = await oss.json<EffectDataFile>("data.json");
    const rawEffects = data.effectData ?? {};
    effectData.value = Object.fromEntries(
      Object.entries(rawEffects).filter(([, item]) => String(item?.id ?? "").trim() !== ""),
    );
    tagData.value = data.TagData ?? {};
    sourceTagData.value = data.sourceTagData ?? {};
    tagCategories.value = data.category ?? {};
    void loadAssetFeatures("EffectPlayer", effects.value).then((features) => {
      assetFeatures.value = features;
    }).catch(() => { assetFeatures.value = null; }).finally(() => { featuresLoading.value = false; });
    // Resource translations are optional and do not block the data/media list.
    void loadOssTranslations("EffectPlayer", "effectPlayer").then((results) => {
      for (const result of results) {
        if (result.status === "failed") console.warn(`Effect translations could not be loaded (${result.locale})`, result.error);
      }
    });
  } catch (error) {
    toast.error(t("effectPlayer.loadFailed"));
    console.error(error);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", updateColumns);
  window.removeEventListener("keydown", onKeydown);
  closeModal();
});

function effectName(item: EffectItem) {
  return resourceText(effectNameKey(item));
}

function tagName(tagId: number) {
  return resourceText(effectTagKey(tagId, tagData.value[String(tagId)]));
}

function formatDuration(item: EffectItem) {
  if (item.duration < 0) return t("effectPlayer.loop.shortLoop");
  return t("effectPlayer.duration.seconds", { seconds: item.duration });
}

function visibleTags(item: EffectItem) {
  return (item.tagList ?? []).slice(0, CARD_TAG_LIMIT);
}

function hiddenTagCount(item: EffectItem) {
  return Math.max(0, (item.tagList?.length ?? 0) - CARD_TAG_LIMIT);
}

function rowPlaceholders(row: EffectRow) {
  return Math.max(0, columns.value - row.data.length);
}

function toggleTag(tagId: number) {
  const index = selectedTagIds.value.indexOf(tagId);
  if (index === -1) {
    selectedTagIds.value = [...selectedTagIds.value, tagId];
  } else {
    selectedTagIds.value = selectedTagIds.value.filter((id) => id !== tagId);
  }
}

function openModal(item: EffectItem, startPaused = false) {
  selectedEffectStartPaused.value = startPaused;
  selectedEffect.value = item;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  selectedEffect.value = null;
  document.body.style.overflow = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && selectedEffect.value) {
    closeModal();
  }
}

function updateColumns() {
  const width = window.innerWidth;
  const next =
    width < 640 ? 2 : width < 900 ? 3 : width < 1280 ? 4 : width < 1600 ? 5 : 6;
  if (columns.value !== next) {
    columns.value = next;
  }
}
</script>

<style scoped>
.version-filter { display: inline-flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #445; }
.version-filter select { font: inherit; color: inherit; padding: 8px 10px; border: 1px solid rgba(14, 162, 229, 0.3); border-radius: 8px; background: #fff; cursor: pointer; }
.version-filter select:focus-visible { outline: 2px solid #0ea2e5; outline-offset: 2px; }
.browser {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 8px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.55);
  border-radius: 10px;
}

.toolbar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-row input {
  flex: 1;
  min-width: min(240px, 100%);
}

.toolbar-row input {
  flex: 1;
  min-width: 0;
}

.search-label {
  text-align: left;
}

.tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tab {
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(106, 90, 205, 0.25);
  color: #334;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.95rem;
}

.tab:hover,
.tag-chip:hover {
  border-color: #6a5acd;
  box-shadow: 0 4px 12px rgba(106, 90, 205, 0.12);
}

.tab.active {
  background: linear-gradient(135deg, rgba(14, 162, 229, 0.35), rgba(106, 90, 205, 0.12));
  border-color: #0ea2e5;
  color: #1a3d66;
  font-weight: 600;
}

.stats {
  margin-left: auto;
  color: #667;
  font-size: 0.9rem;
  text-align: right;
}

.tag-chip {
  border: 1px solid rgba(106, 90, 205, 0.22);
  background: rgba(255, 255, 255, 0.75);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.8rem;
  color: #445;
}

.modal-tags,
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.card-tags {
  max-height: 42px;
  overflow: hidden;
}

.tag-chip.active {
  background: linear-gradient(135deg, rgba(14, 162, 229, 0.4), rgba(106, 90, 205, 0.18));
  border-color: #0ea2e5;
  color: #1a3d66;
}

.status-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #778;
  font-size: 1.1rem;
}

.grid-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
}

.effect-list {
  height: 100%;
  width: 100%;
  overflow-y: scroll;
}

.effect-row {
  display: flex;
  gap: 12px;
  height: 100%;
  padding: 0 4px 12px;
  box-sizing: border-box;
}

.effect-card {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.62);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.effect-card:hover {
  transform: translateY(-4px);
  border-color: #0ea2e5;
  box-shadow: 0 10px 24px rgba(14, 162, 229, 0.18);
}

.placeholder-card {
  visibility: hidden;
  pointer-events: none;
  box-shadow: none;
}

.effect-info {
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.open-preview { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: pointer; flex-shrink: 0; }
.card-copy { font-family: inherit; text-align: left; border: 0; padding: 0; background: none; cursor: copy; }
.card-copy:hover { text-decoration: underline; }
.card-copy:focus-visible, .open-preview:focus-visible { outline: 2px solid #0ea2e5; outline-offset: -2px; }

.effect-name {
  font-size: 1rem;
  color: #223;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.effect-id {
  font-size: 0.85rem;
  color: #0b6fa8;
  background: linear-gradient(90deg, rgba(14, 162, 229, 0.16), rgba(14, 162, 229, 0.05));
  border-left: 3px solid #0ea2e5;
  padding: 4px 8px;
  border-radius: 4px;
}

.effect-meta {
  display: flex;
  gap: 8px;
  font-size: 0.8rem;
  color: #667;
}

.effect-description { height: 20px; flex: 0 0 20px; color: #596b82; font-size: 11px; }
.effect-feature-details { margin-top: 14px; padding: 12px 14px; border-radius: 9px; background: #f4f8fe; text-align: left; }
.feature-status { margin: 6px 0 0; color: #6e7a8c; font-size: 12px; line-height: 1.5; }

.mini-tag {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(106, 90, 205, 0.12);
  color: #445;
  font-size: 0.72rem;
}

.mini-tag.more {
  background: rgba(0, 0, 0, 0.06);
}

.modal {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(33, 45, 66, 0.4);
}

.modal-content {
  position: relative;
  max-width: 96vw;
  max-height: 96vh;
  background: #fbfcff;
  border: 1px solid #cbdcf0;
  border-radius: 16px;
  overflow: auto;
  box-shadow: 0 18px 56px rgba(39, 58, 91, 0.22);
}

.close-button {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  color: #536d8f;
  box-shadow: 0 2px 8px rgba(39, 58, 91, 0.14);
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
  z-index: 1;
}

.modal-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

.modal-info {
  min-width: 0;
  width: min(680px, calc(94vw - 36px));
  text-align: center;
  color: #2f4058;
}

.modal-title {
  margin: 0 0 8px;
  font-size: 1.4rem;
  font-weight: 500;
}

.modal-id {
  font: inherit;
  color: inherit;
  border: 0;
  margin: 0;
  display: inline-block;
  cursor: pointer;
  background: #e9f4fd;
  color: #246d9b;
  border-left: 3px solid #81c6ed;
  padding: 8px 14px;
  border-radius: 6px;
}

.copy-name { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
.copy-name:hover { color: #187fc5; }
.copy-name:focus-visible, .modal-id:focus-visible { outline: 2px solid #73bfff; outline-offset: 4px; }

.modal-meta {
  margin: 12px 0;
  color: #687a92;
}

.modal-tags {
  justify-content: center;
}

.modal-tags .tag-chip {
  background: #f0f6fd;
  color: #536d8f;
  border-color: #d5e4f3;
}

.modal-tags .tag-chip.active {
  background: #dceeff;
  color: #226e9e;
  border-color: #9bc9eb;
}

@media (max-width: 600px) {
  .toolbar-row {
    flex-wrap: wrap;
    gap: 8px;
  }

  .search-label {
    width: 100%;
    text-align: left;
    font-size: 0.85rem;
  }

  .stats {
    margin-left: 0;
    width: 100%;
    text-align: left;
    font-size: 0.8rem;
  }

  .tab {
    padding: 6px 10px;
    font-size: 0.85rem;
  }
}
</style>
