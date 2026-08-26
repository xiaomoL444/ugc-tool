<template>
  <SectionLayout title="特效预览">
    <div class="browser">
      <div class="toolbar">
        <div class="toolbar-row">
          <div class="search-label">搜索（可搜索 id、名称、tag）：</div>
          <input v-model="search" type="search" autocomplete="off" placeholder="例如 10001001 / 冰元素受击 / 受击" />
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
          </div>
          <div class="stats">{{ statsText }}</div>
        </div>

        <div class="tag-filter">
          <div class="tag-filter-head">
            <span>按 Tag 筛选{{ selectedTagIds.length ? `（已选 ${selectedTagIds.length}）` : "" }}</span>
            <button v-if="selectedTagIds.length" class="clear-tags" type="button" @click="selectedTagIds = []">
              清除 Tag
            </button>
          </div>
          <div class="tag-chip-wrap">
            <button
              v-for="tag in tagOptions"
              :key="tag.id"
              class="tag-chip"
              :class="{ active: selectedTagIds.includes(tag.id) }"
              type="button"
              @click="toggleTag(tag.id)"
            >
              {{ tag.name }}
            </button>
          </div>
        </div>
      </div>

      <div class="grid-wrap">
        <div v-if="loading" class="status-panel">正在加载特效...</div>
        <div v-else-if="filteredEffects.length === 0" class="status-panel">未找到匹配的特效</div>
        <VVirtualList
          v-else
          class="effect-list"
          :items="rows"
          :item-size="itemSize"
          key-field="id"
          ignore-item-resize
        >
          <template #default="{ item: row }: { item: EffectRow }">
            <div class="effect-row">
              <button
                v-for="effect in row.data"
                :key="effect.id"
                class="effect-card"
                type="button"
                @click="openModal(effect)"
              >
                <EffectMedia :item="effect" />
                <div class="effect-info">
                  <div class="effect-name" :title="effectName(effect)">
                    {{ effectName(effect) }}
                  </div>
                <div class="effect-id">配置ID: {{ effect.id }}</div>
                <div class="effect-meta">
                  <span v-if="effect.duration >= 0">{{ effect.duration }}s</span>
                  <span>{{ effect.isLoop ? "循环" : "限时" }}</span>
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
            </button>
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
        <button class="close-button" type="button" aria-label="关闭" @click="closeModal">&times;</button>
        <div class="modal-body">
          <EffectMedia :item="selectedEffect" variant="modal" />
          <div class="modal-info">
            <h2 class="modal-title">{{ effectName(selectedEffect) }}</h2>
            <p class="modal-id" @click="Clipboard(selectedEffect.id)">配置ID: {{ selectedEffect.id }}</p>
            <p class="modal-meta">
              时长：{{ formatDuration(selectedEffect) }}　{{ selectedEffect.isLoop ? "循环特效" : "限时特效" }}
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
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import { Clipboard } from "@/utils/clipboard";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { toast } from "vue-sonner";
import { VVirtualList } from "vueuc";
import EffectMedia from "./EffectMedia.vue";
import { createOss } from "@/utils/oss";
import {
  EffectDataFile,
  EffectItem,
  EffectLoopFilter,
  EffectRow,
} from "./types/EffectData";

const oss = createOss("EffectPlayer");
const CARD_TAG_LIMIT = 4;
const itemSize = 292;

const loopTabs: { value: EffectLoopFilter; label: string }[] = [
  { value: "all", label: "全部特效" },
  { value: "once", label: "限时特效" },
  { value: "loop", label: "循环特效" },
];

const loading = ref(true);
const search = ref("");
const loopFilter = ref<EffectLoopFilter>("all");
const selectedTagIds = ref<number[]>([]);
const selectedEffect = ref<EffectItem | null>(null);
const effectData = ref<Record<string, EffectItem>>({});
const tagData = ref<Record<string, string>>({});
const columns = ref(4);

const tagOptions = computed(() =>
  Object.entries(tagData.value)
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.id - b.id),
);

const filteredEffects = computed(() => {
  const q = search.value.trim().toLowerCase();
  const tags = selectedTagIds.value;
  return Object.values(effectData.value).filter((item) => {
    if (loopFilter.value === "loop" && !item.isLoop) return false;
    if (loopFilter.value === "once" && item.isLoop) return false;
    if (tags.length && !tags.every((tagId) => item.tagList?.includes(tagId))) {
      return false;
    }
    if (!q) return true;
    if (String(item.id).toLowerCase().includes(q)) return true;
    if (effectName(item).toLowerCase().includes(q)) return true;
    return (item.tagList ?? []).some((tagId) =>
      tagName(tagId).toLowerCase().includes(q),
    );
  });
});

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
    loopTabs.find((tab) => tab.value === loopFilter.value)?.label ?? "特效";
  if (shown === total && !search.value.trim() && selectedTagIds.value.length === 0) {
    return `${label} 共 ${total} 个`;
  }
  return `${label} 显示 ${shown} / ${total} 个`;
});

onMounted(async () => {
  updateColumns();
  window.addEventListener("resize", updateColumns);
  window.addEventListener("keydown", onKeydown);
  try {
    const data = await oss.json<EffectDataFile>("data.json");
    const rawEffects = data.effectData ?? {};
    effectData.value = Object.fromEntries(
      Object.entries(rawEffects).filter(([, item]) => Boolean(item.icon?.trim())),
    );
    tagData.value = data.TagData ?? {};
  } catch (error) {
    toast.error("特效数据加载失败");
    console.error(error);
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", updateColumns);
  window.removeEventListener("keydown", onKeydown);
});

function effectName(item: EffectItem) {
  return item.title || item.name || "未命名特效";
}

function tagName(tagId: number) {
  return tagData.value[String(tagId)] || `Tag ${tagId}`;
}

function formatDuration(item: EffectItem) {
  if (item.duration < 0) return "循环";
  return `${item.duration}s`;
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

function openModal(item: EffectItem) {
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
}

.search-label {
  flex-shrink: 0;
  white-space: nowrap;
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
.tag-chip:hover,
.clear-tags:hover {
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
}

.tag-filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 0.9rem;
  color: #556;
}

.clear-tags,
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

.tag-chip-wrap,
.modal-tags,
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag-chip-wrap {
  max-height: 76px;
  overflow-y: auto;
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
  background: rgba(8, 10, 16, 0.86);
}

.modal-content {
  position: relative;
  max-width: 96vw;
  max-height: 96vh;
  background: #111218;
  border: 2px solid #0ea2e5;
  border-radius: 16px;
  overflow: auto;
  box-shadow: 0 0 40px rgba(14, 162, 229, 0.28);
}

.close-button {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #9fe7ff;
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
  min-width: 280px;
  text-align: center;
  color: #d7eef8;
}

.modal-title {
  margin: 0 0 8px;
  font-size: 1.4rem;
  font-weight: 500;
}

.modal-id {
  margin: 0;
  display: inline-block;
  cursor: pointer;
  background: linear-gradient(90deg, rgba(14, 162, 229, 0.24), rgba(14, 162, 229, 0.08));
  border-left: 4px solid #0ea2e5;
  padding: 8px 14px;
  border-radius: 6px;
}

.modal-meta {
  margin: 12px 0;
  color: #9bb;
}

.modal-tags {
  justify-content: center;
}

.modal-tags .tag-chip {
  background: rgba(255, 255, 255, 0.08);
  color: #d7eef8;
  border-color: rgba(14, 162, 229, 0.4);
}

.modal-tags .tag-chip.active {
  background: rgba(14, 162, 229, 0.35);
  color: #fff;
}
</style>
