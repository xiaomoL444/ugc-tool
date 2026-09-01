<template>
  <Splitter style="height: 100%; width: 100%">
    <SplitterPanel :size="70">
      <SectionLayout title="选择音效 ">
        <Splitter style="height: 100%; width: 100%" layout="vertical">
          <SplitterPanel :size="4">
            <div class="search-bar">
              <div class="search-label">搜索（名称或 id）：</div>
              <input v-model="search" type="search" autocomplete="off" placeholder="输入关键词，回车跳到第一项"
                @keydown.enter="jumpToFirstSearchResult" />
              <span class="search-count">{{ keys.length }} 项</span>
              <button type="button" class="expand-all-button" :disabled="filteredCategories.length === 0"
                @click="toggleAllCategories">
                {{ allVisibleCategoriesExpanded ? "全部收起" : "全部展开" }}
              </button>
            </div>
          </SplitterPanel>

          <SplitterPanel :size="94">
            <div class="sound-library">
              <div v-if="filteredCategories.length" class="category-controls">
                <button v-for="group in filteredCategories" :key="group.category" type="button" class="category-header"
                  :class="{ expanded: isCategoryExpanded(group.category) }" @click="toggleCategory(group.category)">
                  <span class="category-arrow" :class="{ expanded: isCategoryExpanded(group.category) }">▶</span>
                  <span class="category-title">{{ categoryName(group.category) }}</span>
                  <span class="category-count">{{ group.ids.length }}</span>
                </button>
              </div>

              <VVirtualList v-if="libraryRows.length" ref="libraryListRef" :items="libraryRows" :item-size="105"
                :padding-top="10" class="sound-virtual-list">
                <template #default="{ item }: { item: SoundRow }">
                  <div class="sound-row" :class="[
                    `category-${item.category}`,
                    { 'group-first': item.isFirst, 'group-last': item.isLast },
                  ]">
                    <span v-if="item.isFirst" class="sound-group-label">{{ categoryName(item.category) }}</span>
                    <ListButton v-for="id in item.data" :key="id" :is-selected="id == selectedId"
                      v-on:update:selected="SelectSound(id)">
                      <div class="item">
                        <div class="title">
                          <NEllipsis> {{ dataJson[id]?.name }} </NEllipsis>
                        </div>
                        <div class="subtitle">
                          id:{{ id }} / {{ dataJson[id]?.duration }}s
                        </div>
                      </div>
                    </ListButton>
                  </div>
                </template>
              </VVirtualList>
              <div v-else-if="filteredCategories.length" class="collapsed-hint">选择一个分类，或点击“全部展开”</div>
              <div v-if="filteredCategories.length === 0" class="empty-result">没有找到匹配的音效</div>
            </div>
          </SplitterPanel>
        </Splitter>
      </SectionLayout>
    </SplitterPanel>
    <SplitterPanel :size="30">
      <SectionLayout title="播放器">
        <div class="player">
          <span>音效名称：{{ dataJson[selectedId]?.name }}</span><span> 音效id：{{ selectedId }}</span>
          <ActionButton v-on:update:selected="togglePlay">{{
            playing ? "暂停" : "播放"
          }}</ActionButton>
          <ActionButton v-on:update:selected="prevTrack">上一首</ActionButton>
          <ActionButton v-on:update:selected="nextTrack">下一首</ActionButton>

          <!-- 时间进度 -->
          <div>
            <span v-if="!loading">{{ formatTime(currentTime) }}/{{ formatTime(duration) }}</span>
            <span v-else>{{ formatTime(currentTime) }}/加载中...</span>
            <input type="range" :max="duration" step="0.1" v-model.number="currentTime" @input="seek" />
          </div>

          <!-- 播放速度 -->
          <div>
            <label>速度: {{ speed }}x</label>
            <input type="range" min="0.5" max="2" step="0.1" v-model.number="speed" @input="changePlaybackRate" />
          </div>

          <!-- 音量 0~200% -->
          <div>
            <label>音量: {{ Math.round(volume * 100) }}%</label>
            <div v-if="volume > 1.0">
              (实际编辑器内音量不可大于100%，此处只为放大预览用)
            </div>
            <input type="range" min="0" max="1" step="0.01" v-model.number="volume" @input="changeVolume" />
          </div>

          <div style="
              text-align: center;
              align-items: center;
              display: flex;
              flex-direction: row;
            ">
            <!-- iOS风格开关 -->
            <label class="switch">
              <input type="checkbox" v-model="loopEnabled" @change="toggleLoop" />
              <span class="slider"></span>
            </label>
            <div>是否开启循环播放</div>
          </div>
          <div v-if="loopEnabled" style="margin-top: 10px; display: flex; flex-direction: row">
            <div>循环间隔时间(s)</div>
            <input type="number" v-model="interval" />
          </div>

          <!-- 音频元素 -->
          <audio ref="audioRef" @timeupdate="updateTime" @loadedmetadata="loadMetadata" :src="audioSource"
            @ended="ended"></audio>
        </div>
      </SectionLayout>
    </SplitterPanel>
  </Splitter>
</template>

<style scoped>
@import "./styles/iosCheckBoc.css";

.item {
  text-align: left;
  width: 100%;
  margin: 10px 6px;
}

.search-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  height: 100%;
}

.search-label {
  flex: 0 0 150px;
}

.search-bar input {
  flex: 1;
  min-width: 0;
}

.search-count,
.category-count {
  color: rgba(0, 0, 0, 0.55);
  font-size: 0.85rem;
}

.expand-all-button {
  flex: 0 0 auto;
  height: 28px;
  padding: 0 12px;
  border: 1px solid rgba(106, 90, 205, 0.35);
  border-radius: 6px;
  background: rgba(106, 90, 205, 0.1);
  color: #4d429b;
  cursor: pointer;
}

.expand-all-button:hover:not(:disabled) {
  background: rgba(106, 90, 205, 0.18);
}

.expand-all-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.sound-library {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  padding: 4px 8px 16px;
}

.sound-library :deep(.v-vl) {
  overflow-anchor: none;
}

.sound-virtual-list {
  flex: 1;
  min-height: 0;
}

.category-controls {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  flex: 0 0 auto;
}

.category-header {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  height: 38px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid rgba(106, 90, 205, 0.2);
  border-radius: 8px;
  background: rgba(106, 90, 205, 0.04);
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.category-header.expanded {
  border-color: rgba(106, 90, 205, 0.55);
  background: rgba(106, 90, 205, 0.14);
}

.category-header:hover {
  background: rgba(106, 90, 205, 0.08);
}

.category-arrow {
  margin-right: 8px;
  font-size: 0.7rem;
  transition: transform 0.18s ease;
}

.category-arrow.expanded {
  transform: rotate(90deg);
}

.category-title {
  min-width: 0;
  margin-right: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.sound-row {
  --category-color: rgba(106, 90, 205, 0.5);
  --category-background: rgba(106, 90, 205, 0.04);
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: row;
  gap: 5px;
  height: 105px;
  padding: 0 5px 5px;
  border-right: 2px solid var(--category-color);
  border-left: 2px solid var(--category-color);
  background: var(--category-background);
}

.sound-row.group-first {
  border-top: 2px solid var(--category-color);
  border-radius: 10px 10px 0 0;
}

.sound-row.group-last {
  border-bottom: 2px solid var(--category-color);
  border-radius: 0 0 10px 10px;
}

.sound-row.group-first.group-last {
  border-radius: 10px;
}

.sound-group-label {
  position: absolute;
  z-index: 1;
  top: 0;
  left: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: #f1f1ff;
  color: var(--category-color);
  font-size: 0.82rem;
  font-weight: 600;
  transform: translateY(-50%);
}

.sound-row.category-1 {
  --category-color: #5378c8;
  --category-background: rgba(83, 120, 200, 0.05);
}

.sound-row.category-2 {
  --category-color: #4c9a72;
  --category-background: rgba(76, 154, 114, 0.05);
}

.sound-row.category-3 {
  --category-color: #a66bb5;
  --category-background: rgba(166, 107, 181, 0.05);
}

.sound-row.category-4 {
  --category-color: #c46a62;
  --category-background: rgba(196, 106, 98, 0.05);
}

.sound-row.category-5 {
  --category-color: #a77c3d;
  --category-background: rgba(167, 124, 61, 0.05);
}

.sound-row.category-6 {
  --category-color: #4d95a8;
  --category-background: rgba(77, 149, 168, 0.05);
}

.sound-row.category-7 {
  --category-color: #6f72b8;
  --category-background: rgba(111, 114, 184, 0.05);
}

.empty-result {
  padding: 32px;
  text-align: center;
  color: rgba(0, 0, 0, 0.55);
}

.collapsed-hint {
  display: grid;
  flex: 1;
  place-items: center;
  color: rgba(0, 0, 0, 0.5);
}

.item .title {
  font-size: 1.2rem;
}

.item .subtitle {
  width: 10rem;
  word-wrap: break-word;
  /* 老方法 */
  overflow-wrap: break-word;
  /* 新方法 */

  border-radius: 10px;
  border: 1px solid #cdcdcd;

  padding: 10px;
  margin-top: 0.5rem;

  font-size: 0.8rem;

  display: flex;
  background-color: #f0f1f5cc;
}

input[type="range"] {
  width: 100%;
}

.player {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 400px;
  margin: 20px auto;
}
</style>

<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";

import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";

import { computed, nextTick, onMounted, ref, watch } from "vue";

import { SoundEffectData } from "./types/SoundEffectData";
import { VVirtualList, type VVirtualListInst } from "vueuc";
import ListButton from "@/components/button/ListButton.vue";
import { toast } from "vue-sonner";
import ActionButton from "@/components/button/ActionButton.vue";
import { NEllipsis } from "naive-ui";
import { createOss } from "@/utils/oss";

const oss = createOss("SoundEffectPlayer");

const selectedId = ref("未选择"); //选择的音效id

const search = ref("");

const audioSource = ref("");

const loading = ref(false);

const loopEnabled = ref(false);
const interval = ref(0);

const expandedCategories = ref<string[]>([]);
const libraryListRef = ref<VVirtualListInst | null>(null);
const itemsPerRow = 4;

interface SoundRow {
  key: string;
  type: "sounds";
  category: number;
  data: string[];
  isFirst: boolean;
  isLast: boolean;
}

function makeRows(category: number, ids: string[]): SoundRow[] {
  const rows: SoundRow[] = [];
  for (let index = 0; index < ids.length; index += itemsPerRow) {
    rows.push({
      key: `${category}-${index / itemsPerRow}`,
      type: "sounds",
      category,
      data: ids.slice(index, index + itemsPerRow),
      isFirst: index === 0,
      isLast: index + itemsPerRow >= ids.length,
    });
  }
  return rows;
}

const categoryNames: Record<number, string> = {
  1: "环境",
  2: "生物叫声",
  3: "角色动作",
  4: "战斗",
  5: "场景物件",
  6: "界面",
  7: "载具与物理",
};

function categoryName(category: number) {
  return categoryNames[category] ?? (category === 0 ? "未分类" : `分类 ${category}`);
}

const orderedCategories = computed(() => {
  const groups = new Map<number, string[]>();

  Object.keys(dataJson.value).forEach((id) => {
    const category = Number(dataJson.value[id]?.category ?? 0);
    const ids = groups.get(category) ?? [];
    ids.push(id);
    groups.set(category, ids);
  });

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([category, ids]) => ({
      category,
      ids: ids.sort((leftId, rightId) => {
        const left = dataJson.value[leftId];
        const right = dataJson.value[rightId];
        const orderDifference = Number(left?.order ?? Number.MAX_SAFE_INTEGER)
          - Number(right?.order ?? Number.MAX_SAFE_INTEGER);
        return orderDifference || leftId.localeCompare(rightId, undefined, { numeric: true });
      }),
    }));
});

const keys = computed(() =>
  filteredCategories.value.flatMap((group) => group.ids),
);

const filteredCategories = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  const groups = !query
    ? orderedCategories.value
    : orderedCategories.value
      .map((group) => ({
        ...group,
        ids: group.ids.filter((id) => {
          const item = dataJson.value[id];
          return item?.name?.toLocaleLowerCase().includes(query) || id.toLocaleLowerCase().includes(query);
        }),
      }))
      .filter((group) => group.ids.length > 0);

  return groups.map((group) => ({
    ...group,
    rows: makeRows(group.category, group.ids),
  }));
});

const allVisibleCategoriesExpanded = computed(() =>
  filteredCategories.value.length > 0
  && filteredCategories.value.every((group) => isCategoryExpanded(group.category)),
);

const libraryRows = computed<SoundRow[]>(() => {
  const result: SoundRow[] = [];
  filteredCategories.value.forEach((group) => {
    if (isCategoryExpanded(group.category)) result.push(...group.rows);
  });
  return result;
});

const dataJson = ref<SoundEffectData>({});

onMounted(async () => {
  dataJson.value = await oss.json("data.json");
});

watch([search, orderedCategories], () => {
  if (!search.value.trim()) return;
  expandedCategories.value = filteredCategories.value.map((group) => group.category.toString());
});

function isCategoryExpanded(category: number) {
  return expandedCategories.value.includes(category.toString());
}

function toggleCategory(category: number) {
  const name = category.toString();
  expandedCategories.value = isCategoryExpanded(category)
    ? expandedCategories.value.filter((item) => item !== name)
    : [...expandedCategories.value, name];
}

function toggleAllCategories() {
  const visibleNames = filteredCategories.value.map((group) => group.category.toString());
  if (allVisibleCategoriesExpanded.value) {
    expandedCategories.value = expandedCategories.value.filter((name) => !visibleNames.includes(name));
    return;
  }
  expandedCategories.value = [...new Set([...expandedCategories.value, ...visibleNames])];
}

async function scrollToSound(id: string) {
  const category = Number(dataJson.value[id]?.category ?? 0).toString();
  if (!expandedCategories.value.includes(category)) {
    expandedCategories.value = [...expandedCategories.value, category];
  }
  await nextTick();
  const index = libraryRows.value.findIndex((item) => item.type === "sounds" && item.data.includes(id));
  if (index >= 0) {
    libraryListRef.value?.scrollTo({ index, behavior: "smooth" });
  }
}

function jumpToFirstSearchResult() {
  const id = keys.value[0];
  if (id) SelectSound(id, true);
}

function SelectSound(id: string, shouldScroll = false) {
  console.log(`选择了${id}`);
  selectedId.value = id;
  audioSource.value = "";
  audioSource.value = oss.path("audio", `${id}.mp3`);
  loading.value = true;
  audioRef.value?.load();
  if (shouldScroll) void scrollToSound(id);
}

// const currentIndex = defineModel();
const audioRef = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const volume = ref(1);
const speed = ref(1);

const currentTrack = defineModel();
const currentTime = ref(0);
const duration = ref(0);

let timer: ReturnType<typeof setTimeout> | null = null;

function toggleLoop() {
  if (!audioRef.value) return;

  if (!loopEnabled.value) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
}

// 播放 / 暂停
function togglePlay() {
  if (playing.value) {
    stop();
  } else {
    start();
  }
}

function start() {
  if (!audioRef.value) return;
  audioRef.value.play().catch(() => {
    toast.warning(`播放失败`);
  });
  playing.value = true;
}
function stop() {
  if (!audioRef.value) return;
  audioRef.value.pause();
  playing.value = false;
}

// 上一首 / 下一首
function prevTrack() {
  const index = keys.value.indexOf(selectedId.value);
  if (!keys.value.length) return;
  const targetIndex = index < 0 ? keys.value.length - 1 : (index - 1 + keys.value.length) % keys.value.length;
  SelectSound(keys.value[targetIndex], true);
}

function nextTrack() {
  const index = keys.value.indexOf(selectedId.value);
  if (!keys.value.length) return;
  const targetIndex = index < 0 ? 0 : (index + 1) % keys.value.length;
  SelectSound(keys.value[targetIndex], true);
}

// 时间控制
function seek() {
  if (!audioRef.value) return;
  audioRef.value.currentTime = currentTime.value;
}

function updateTime() {
  if (!audioRef.value) return;
  currentTime.value = audioRef.value.currentTime;
}

function loadMetadata() {
  if (!audioRef.value) return;
  duration.value = audioRef.value.duration;
  loading.value = false;
  changePlaybackRate();
  start();
}

// 播放速度
function changePlaybackRate() {
  if (!audioRef.value) return;
  audioRef.value.playbackRate = speed.value;
}

// 音量 0~2，通过 GainNode
function changeVolume() {
  if (!audioRef.value) return;
  const v = Number(volume.value);
  if (isNaN(v) || !isFinite(v)) return;
  audioRef.value.volume = volume.value;
}

// 格式化时间 mm:ss
function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function ended() {
  if (!audioRef.value) return;
  audioRef.value.currentTime = 0;
  playing.value = false;
  if (!loopEnabled.value) return;

  timer = setTimeout(() => {
    start();
  }, interval.value * 1000);
}
</script>
