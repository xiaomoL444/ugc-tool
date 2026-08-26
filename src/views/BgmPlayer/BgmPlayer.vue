<template>
    <Splitter>
        <SplitterPanel :size="70">
            <SectionLayout :title="'歌曲列表'">
                <div class="song-list-layout">
                    <div class="song-list-header">
                        <div class="song-list-search">
                            <span class="song-list-search-label">搜索（可搜索 id）：</span>
                            <input v-model="search" type="search" autocomplete="off" />
                        </div>
                    </div>
                    <div class="song-list-scroll">
                        <div style="display: flex;flex-direction: column; gap: 4px;">
                            <ListButton v-for="item in filteredSongs" :key="item.id"
                                :is-selected="item.id == selectedItem?.id" v-on:update:selected="OnSelect(item)">
                                <BgmInfoViewer :info="item"></BgmInfoViewer>
                            </ListButton>
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

/* 歌曲列表：顶栏固定高度，下方列表区域滚轮滚动 */
.song-list-layout {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.song-list-header {
    flex-shrink: 0;
    height: 50px;
    box-sizing: border-box;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: rgba(255, 255, 255, 0.55);
    border-radius: 10px;
    z-index: 999;
}

.song-list-header-title {
    height: 20px;
    line-height: 20px;
    font-size: 1.1rem;
    font-weight: 600;
    font-family: StarRailFont, sans-serif;
}

.song-list-search {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    min-height: 0;
}

.song-list-search-label {
    flex-shrink: 0;
    font-size: 0.95rem;
    white-space: nowrap;
}

.song-list-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 0;
}
</style>

<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";

import Splitter from "primevue/splitter";
import SplitterPanel from "primevue/splitterpanel";

import { computed, onMounted, ref } from "vue";
import { BgmInfo } from "./types/bgmInfo";
import ListButton from "@/components/button/ListButton.vue";
import BgmInfoViewer from "./components/BgmInfoViewer.vue";
import BgmMetadata from "./components/BgmMetadata.vue";
import { createOss } from "@/utils/oss";

function neteaseSongUrl(songId: number) {
    return `https://music.163.com/song?id=${songId}`;
}

/** `name` 按空格分割后的第 0 段（中文歌名等） */
function chineseSongTitle(name: string) {
    return name.split(" ")[0] ?? "";
}

const oss = createOss("BgmPlayer");

const dataJson = ref<BgmInfo[]>();
onMounted(async () => {
    dataJson.value = await oss.json("data.json");
});

const selectedItem = ref<BgmInfo>();
function OnSelect(item: BgmInfo) {
    selectedItem.value = item;
}

const search = ref("");

const filteredSongs = computed(() => {
    const list = dataJson.value ?? [];
    const q = search.value.trim();
    if (!q) return list;
    const lower = q.toLowerCase();
    return list.filter((item) => {
        if (String(item.id).includes(q)) return true;
        if (String(item.song_id).includes(q)) return true;
        return (item.name ?? "").toLowerCase().includes(lower);
    });
});

</script>
