<template>
    <Splitter>
        <SplitterPanel :size="70">
            <SectionLayout :title="'歌曲列表'">
                <div class="song-list-layout">
                    <div class="search-bar">
                        <label for="bgm-search" class="search-label">搜索（名称或 id）：</label>
                        <input id="bgm-search" v-model="search" type="search" autocomplete="off"
                            placeholder="输入关键词，回车跳到第一项"
                            @keydown.enter="jumpToFirstSearchResult" />
                        <span class="search-count" role="status">{{ statsText }}</span>
                        <button class="expand-all-button" type="button" :disabled="filteredCategories.length === 0"
                            @click="toggleAllCategories">{{ allVisibleCategoriesExpanded ? "全部收起" : "全部展开" }}</button>
                    </div>
                    <div class="song-library">
                        <div v-if="filteredCategories.length" class="category-controls" aria-label="音乐分类">
                            <button v-for="group in filteredCategories" :key="group.category" class="category-header"
                                :class="{ expanded: isCategoryExpanded(group.category) }"
                                :aria-expanded="isCategoryExpanded(group.category)" :aria-controls="`bgm-category-${group.category}`"
                                type="button" @click="toggleCategory(group.category)">
                                <span class="category-arrow" :class="{ expanded: isCategoryExpanded(group.category) }" aria-hidden="true">▶</span>
                                <span class="category-title" :title="categoryName(group.category)">{{ categoryName(group.category) }}</span>
                                <span class="category-count">{{ group.songs.length }}</span>
                            </button>
                        </div>
                        <div ref="songListRef" class="song-list-scroll">
                            <div v-if="loading" class="status-panel" role="status">正在加载音乐...</div>
                            <div v-else-if="loadError" class="status-panel" role="alert">
                                <span>音乐数据加载失败</span>
                                <button class="expand-all-button" type="button" @click="loadData">重试</button>
                            </div>
                            <div v-else-if="filteredCategories.length === 0" class="status-panel">未找到匹配的音乐</div>
                            <div v-else-if="expandedGroups.length === 0" class="collapsed-hint">选择一个分类，或点击“全部展开”</div>
                            <div v-else class="song-groups">
                                <section v-for="group in expandedGroups" :id="`bgm-category-${group.category}`"
                                    :key="group.category" class="song-group" :class="`category-${group.category}`"
                                    :aria-label="categoryName(group.category)">
                                    <h3 class="song-group-label">{{ categoryName(group.category) }}</h3>
                                    <ListButton v-for="item in group.songs" :key="item.id"
                                        :is-selected="item.id == selectedItem?.id" v-on:update:selected="OnSelect(item)">
                                        <BgmInfoViewer :info="item"></BgmInfoViewer>
                                    </ListButton>
                                </section>
                            </div>
                        </div>
                    </div>
                </div>
            </SectionLayout>
        </SplitterPanel>
        <SplitterPanel :size="30">
            <SectionLayout :title="'歌曲元数据'">
                <div class="metadata-panel">
                    <BgmMetadata v-if="selectedItem?.name" title="歌曲名" :info="selectedItem?.name"></BgmMetadata>
                    <BgmMetadata v-if="selectedItem?.name" title="中文歌曲名" :info="chineseSongTitle(selectedItem.name)">
                    </BgmMetadata>
                    <BgmMetadata v-if="selectedItem?.id" title="id" :info="`${selectedItem?.id}`"></BgmMetadata>
                    <BgmMetadata v-if="selectedItem?.time" title="时长"
                        :info="`${selectedItem?.minute}分${selectedItem.second}秒`"></BgmMetadata>
                    <BgmMetadata v-if="selectedItem?.album" title="专辑" :info="selectedItem.album"></BgmMetadata>
                    <BgmMetadata v-if="selectedItem?.category != null" title="分类"
                        :info="categoryName(selectedItem.category)"></BgmMetadata>
                    <div v-if="selectedItem?.song_id" class="ne-link-row">
                        <div class="ne-link-label">
                            <svg class="ne-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"
                                aria-hidden="true">
                                <path fill="currentColor"
                                    d="M10.421 11.375c-.294 1.028.012 2.064.784 2.653 1.061.81 2.565.3 2.874-.995.08-.337.103-.722.027-1.056-.23-1.001-.52-1.988-.792-2.996-1.33.154-2.543 1.172-2.893 2.394zm5.548-.287c.273 1.012.285 2.017-.127 3-1.128 2.69-4.721 3.14-6.573.826-1.302-1.627-1.28-3.961.06-5.734.78-1.032 1.804-1.707 3.048-2.054l.379-.104c-.084-.415-.188-.816-.243-1.224-.176-1.317.512-2.503 1.744-3.04 1.226-.535 2.708-.216 3.53.76.406.479.395 1.08-.025 1.464-.412.377-.996.346-1.435-.09-.247-.246-.51-.44-.877-.436-.525.006-.987.418-.945.937.037.468.173.93.3 1.386.022.078.216.135.338.153 1.334.197 2.504.731 3.472 1.676 2.558 2.493 2.861 6.531.672 9.44-1.529 2.032-3.61 3.168-6.127 3.409-4.621.44-8.664-2.53-9.7-7.058C2.515 10.255 4.84 5.831 8.795 4.25c.586-.234 1.143-.031 1.371.498.232.537-.019 1.086-.61 1.35-2.368 1.06-3.817 2.855-4.215 5.424-.533 3.433 1.656 6.776 5 7.72 2.723.77 5.658-.166 7.308-2.33 1.586-2.08 1.4-5.099-.427-6.873a3.979 3.979 0 0 0-1.823-1.013c.198.716.389 1.388.57 2.062z" />
                            </svg>
                        </div>
                        <a class="ne-song-link" :href="neteaseSongUrl(selectedItem.song_id)" target="_blank"
                            rel="noopener noreferrer">打开歌曲页</a>
                    </div>
                    <!-- Spirits - KOKIA -->
                    <!-- Begin -->
                    <iframe v-if="selectedItem" frameborder="no" border="0" marginwidth="0" marginheight="0"
                        width="100%" height="86"
                        :src="`//music.163.com/outchain/player?type=2&id=${selectedItem?.song_id}&auto=1&height=66`"></iframe>
                    <!-- End -->
                </div>
            </SectionLayout>
        </SplitterPanel>
    </Splitter>
</template>

<style scoped>
.metadata-panel {
    justify-content: left;
    text-align: left;
    padding: 10px;
    font-family: 'StarRailFont', sans-serif;
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.ne-link-row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    font-size: 1.2rem;
}

.ne-link-label {
    flex-shrink: 0;
    height: 22px;
    width: 22px;
    color: #d33a31;
}

.ne-icon {
    display: block;
    width: 100%;
    height: 100%;
}

/* :visited 与默认同色，避免浏览器默认紫色已访问样式 */
.ne-song-link,
.ne-song-link:visited {
    color: inherit;
    text-decoration: underline;
}

.ne-song-link:hover {
    opacity: 0.8;
}

/* 筛选栏按内容高度展开，歌曲列表独立滚动。 */
.song-list-layout {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.search-bar {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
    flex: 0 0 auto;
}

.search-label {
    flex: 0 0 150px;
    white-space: nowrap;
}

.search-bar input {
    flex: 1;
    min-width: 0;
}

.song-library {
    flex: 1;
    min-height: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 8px 16px;
}

.search-count,
.category-count {
    color: rgba(0, 0, 0, 0.55);
    font-size: 0.85rem;
    white-space: nowrap;
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
    font-family: inherit;
}

.expand-all-button:hover:not(:disabled) {
    background: rgba(106, 90, 205, 0.18);
}

.expand-all-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.category-controls {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
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
    font-family: inherit;
}

.category-header.expanded {
    border-color: rgba(106, 90, 205, 0.55);
    background: rgba(106, 90, 205, 0.14);
}

.category-header:hover {
    background: rgba(106, 90, 205, 0.08);
}

.category-header:focus-visible,
.expand-all-button:focus-visible {
    outline: 2px solid #0ea2e5;
    outline-offset: 2px;
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

.status-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 20px;
    color: #778;
    font-size: 1.1rem;
}

.collapsed-hint {
    display: grid;
    flex: 1;
    place-items: center;
    color: rgba(0, 0, 0, 0.5);
}

.song-groups {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.song-group {
    --category-color: rgba(106, 90, 205, 0.5);
    --category-background: rgba(106, 90, 205, 0.04);
    box-sizing: border-box;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 5px 5px;
    border: 2px solid var(--category-color);
    border-radius: 10px;
    background: var(--category-background);
}

.song-group-label {
    position: absolute;
    z-index: 1;
    top: 0;
    left: 10px;
    margin: 0;
    padding: 0 6px;
    border-radius: 999px;
    background: #f1f1ff;
    color: var(--category-color);
    font-size: 0.82rem;
    font-weight: 600;
    transform: translateY(-50%);
}

.song-group.category-101 {
    --category-color: #5378c8;
    --category-background: rgba(83, 120, 200, 0.05);
}

.song-group.category-102 {
    --category-color: #4c9a72;
    --category-background: rgba(76, 154, 114, 0.05);
}

.song-group.category-103 {
    --category-color: #a66bb5;
    --category-background: rgba(166, 107, 181, 0.05);
}

.song-group.category-104 {
    --category-color: #c46a62;
    --category-background: rgba(196, 106, 98, 0.05);
}

.song-list-scroll {
    /* 将歌曲的滤镜和分组标题限制在滚动层，避免覆盖上方控件的点击区域。 */
    position: relative;
    z-index: 0;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 0 4px;
}
</style>

<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";

import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";

import { computed, nextTick, onMounted, ref, watch } from "vue";
import { BgmInfo } from "./types/bgmInfo";
import ListButton from "@/components/button/ListButton.vue";
import BgmInfoViewer from "./components/BgmInfoViewer.vue";
import BgmMetadata from "./components/BgmMetadata.vue";
import { createOss } from "@/utils/oss";
import { normalizeBgmData } from "./utils/bgmData";

function neteaseSongUrl(songId: number) {
    return `https://music.163.com/song?id=${songId}`;
}

/** `name` 按空格分割后的第 0 段（中文歌名等） */
function chineseSongTitle(name: string) {
    return name.split(" ")[0] ?? "";
}

const oss = createOss("BgmPlayer");

const dataJson = ref<BgmInfo[]>([]);
const categoryData = ref<Record<string, string>>({});
const loading = ref(true);
const loadError = ref(false);

async function loadData() {
    loading.value = true;
    loadError.value = false;
    try {
        const data = normalizeBgmData(await oss.json("data.json"));
        dataJson.value = data.musicData;
        categoryData.value = data.categoryData;
    } catch (error) {
        loadError.value = true;
        console.error("音乐数据加载失败", error);
    } finally {
        loading.value = false;
    }
}

onMounted(loadData);

const selectedItem = ref<BgmInfo>();
function OnSelect(item: BgmInfo) {
    selectedItem.value = item;
}

const search = ref("");
const expandedCategories = ref<number[]>([]);
const songListRef = ref<HTMLElement | null>(null);

function categoryName(categoryId: number) {
    return categoryData.value[String(categoryId)] || `分类 ${categoryId}`;
}

const filteredSongs = computed(() => {
    const q = search.value.trim().toLowerCase();
    return dataJson.value.filter((item) => {
        if (!q) return true;
        if (String(item.id).includes(q)) return true;
        if (String(item.song_id).includes(q)) return true;
        return [item.name, item.album, categoryName(item.category)]
            .some((value) => (value ?? "").toLowerCase().includes(q));
    });
});

const filteredCategories = computed(() => {
    const groups = new Map<number, BgmInfo[]>();
    for (const item of filteredSongs.value) {
        const songs = groups.get(item.category) ?? [];
        songs.push(item);
        groups.set(item.category, songs);
    }
    return [...groups.entries()]
        .sort(([left], [right]) => left - right)
        .map(([category, songs]) => ({ category, songs }));
});

function isCategoryExpanded(categoryId: number) {
    return expandedCategories.value.includes(categoryId);
}

const expandedGroups = computed(() =>
    filteredCategories.value.filter((group) => isCategoryExpanded(group.category)),
);

const allVisibleCategoriesExpanded = computed(() =>
    filteredCategories.value.length > 0 &&
    filteredCategories.value.every((group) => isCategoryExpanded(group.category)),
);

watch(filteredCategories, (groups) => {
    if (search.value.trim()) {
        expandedCategories.value = groups.map((group) => group.category);
    }
});

function toggleCategory(categoryId: number) {
    expandedCategories.value = isCategoryExpanded(categoryId)
        ? expandedCategories.value.filter((id) => id !== categoryId)
        : [...expandedCategories.value, categoryId];
}

function toggleAllCategories() {
    const ids = filteredCategories.value.map((group) => group.category);
    expandedCategories.value = allVisibleCategoriesExpanded.value
        ? expandedCategories.value.filter((id) => !ids.includes(id))
        : [...new Set([...expandedCategories.value, ...ids])];
}

async function jumpToFirstSearchResult() {
    const item = filteredCategories.value[0]?.songs[0];
    if (!item) return;
    if (!isCategoryExpanded(item.category)) {
        expandedCategories.value = [...expandedCategories.value, item.category];
    }
    OnSelect(item);
    await nextTick();
    songListRef.value?.scrollTo({ top: 0, behavior: "smooth" });
}

const statsText = computed(() => {
    if (loading.value) return "加载中...";
    if (loadError.value) return "加载失败";
    const total = dataJson.value.length;
    if (!search.value.trim()) return `共 ${total} 首`;
    return `${filteredSongs.value.length} / ${total} 首`;
});

</script>
