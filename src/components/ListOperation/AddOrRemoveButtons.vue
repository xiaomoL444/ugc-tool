<template>
    <HoverExpandButton>
        <div style="display: flex; flex-direction: row; gap: 1rem;">
            <button title="上移" :class="['operate-button']" style="--btn-bg: #00BFFF50; --btn-bg-hover: #00BFFFCC;"
                @click="moveUp(modelValue, index)" :disabled="index === 0">↑</button>
            <button title="下移" :class="['operate-button']" style="--btn-bg: #00BFFF50; --btn-bg-hover: #00BFFFCC;"
                @click="moveDown(modelValue, index)" :disabled="index === modelValue.length - 1">↓</button>
            <button title="删除该元素" :class="['operate-button']" style="--btn-bg: #FF000050; --btn-bg-hover: #FF0000CC;"
                v-on:click="modelValue.splice(index, 1)">-</button>
            <button title="从此新增" :class="['operate-button']" style="--btn-bg: #00FF0050; --btn-bg-hover: #00FF00CC;"
                v-on:click="modelValue.splice(index + 1, 0, defaultValue())">+</button>
        </div>
    </HoverExpandButton>
</template>
<script setup>
import HoverExpandButton from '../Layout/HoverExpandButton.vue';

const modelValue = defineModel()//传入一个列表

const props = defineProps({
    index: { type: Number, required: true },
    defaultValue: { type: Function, required: true }
});

function moveUp(items, index) {
    if (index <= 0) return // 越界不动
    const temp = items[index - 1]
    items[index - 1] = items[index]
    items[index] = temp
}

function moveDown(items, index) {
    if (index >= items.length - 1) return // 越界不动
    const temp = items[index + 1]
    items[index + 1] = items[index]
    items[index] = temp
}
</script>
