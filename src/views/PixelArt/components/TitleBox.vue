<template>
    <div class="MainBox">
        <div class="title">
            {{ title }}
        </div>
    </div>

</template>

<script setup>
/* eslint-disable */
import { defineProps } from 'vue';

const props = defineProps({
    title: { type: String, required: true },
})

</script>

<style scoped>
.MainBox {
    box-shadow: inset 0 0 0 0.01rem #00000050;
    /* text-align: center; */
    display: flex;
    /* justify-content: center; */
    /* 水平居中 */
    align-items: center;
    height: 2.5rem;
    padding-left: 0.5rem;
}


.title {
    height: 2rem;
    color: black;
    display: flex;
    /* justify-content: center; */
    /* 水平居中 */
    align-items: center;
    /* 垂直居中 */

    font-weight: 700;
    /* 粗体 */
    font-size: 1.75rem;
    /* 放大一点好看 */
    background: linear-gradient(225deg, #6a5acd, #00bfff);
    /* 紫 → 蓝 */
    -webkit-background-clip: text;
    /* 背景裁剪到文字 */
    color: transparent;
    /* 隐藏文字颜色，让渐变显现 */
    -webkit-text-fill-color: transparent;
}
</style>