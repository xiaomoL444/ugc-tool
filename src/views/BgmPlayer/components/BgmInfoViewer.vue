<template>
    <div class="container">
        <img :src="oss.path('album_pic', `${info.album_id}.jpg`)" class="album">
        <div class="main-row">

            <div class="col title-col">
                <NEllipsis>
                    <div class="title">{{ info.name }}</div>
                </NEllipsis>
                <div class="meta-row">
                    <div class="bgm-id">{{ info.id }}</div>
                    <div class="bgm-time">{{ info.minute }}:{{ info.second }}</div>
                </div>
            </div>
            <div class="col album-col">
                <NEllipsis>{{ info.album }}</NEllipsis>
            </div>
        </div>
    </div>


</template>

<style scoped>
.container {
    height: 100%;
    width: 100%;
    min-width: 0;
    justify-content: left;
    text-align: left;
    display: flex;
    flex-direction: row;
    font-family: StarRailFont;
}

.album {
    height: 50px;
    width: 50px;
    flex-shrink: 0;
    border-radius: 10px;
}

/* flex 子项默认 min-width:auto，长文本会撑开容器导致 NEllipsis 无法截断 */
.main-row {
    display: flex;
    flex-direction: row;
    flex: 1;
    min-width: 0;
}

.col {
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.title-col {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 5px 5px;
}

.meta-row {
    display: flex;
    flex-direction: row;
    gap: 10px;
}

.album-col {
    display: flex;
    align-items: center;
    /* 垂直居中 */
}

.title {
    font-size: 1.1rem;
}

.bgm-id {
    /* font-size: 1rem; */
}
</style>

<script setup lang="ts">
import { NEllipsis } from 'naive-ui';
import { BgmInfo } from '../types/bgmInfo';
import { createOss } from "@/utils/oss";

const oss = createOss("BgmPlayer");

defineProps<{
    info: BgmInfo
}>()
</script>