<template>
    <div class="hover-button" @mouseenter="open = true" @mouseleave="open = false">
        <!-- 按钮主体 -->
        <div class="button">
            <slot name="button">操作</slot>
        </div>

        <!-- 展开的内容 -->
        <transition name="fade">
            <div v-show="open" class="content">
                <slot>这里是展开的内容</slot>
            </div>
        </transition>
    </div>
</template>

<script setup>
import { ref } from 'vue'

const open = ref(false)
</script>

<style scoped>
.hover-button {
    display: inline-block;
    position: relative;
    cursor: pointer;
    height: 1rem;
}

/* 按钮样式 */
.button {
    white-space: nowrap;
    /* 禁止文本或 inline 元素换行 */
    padding: 0.5rem 1rem;
    background-color: #4facfe;
    color: white;
    border-radius: 0.5rem;
    transition: background-color 0.3s;
}

.button:hover {
    background-color: #3a9adf;
}

/* 展开内容，紧贴按钮左侧 */
.content {
    position: absolute;
    top: 0;
    /* 与按钮顶部对齐 */
    right: 100%;
    /* 紧贴按钮左边 */
    margin-right: 0.25rem;
    /* 小间距 */
    background-color: #fff;
    color: #333;
    padding: 0.5rem 1rem;
    border-radius: 0.5rem;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    white-space: nowrap;
    z-index: 100;
}

/* 动画：从右向左展开 */
.fade-enter-active,
.fade-leave-active {
    transition: all 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: translateX(5px);
    /* 从右向左移动 */
}

.fade-enter-to,
.fade-leave-from {
    opacity: 1;
    transform: translateX(0);
}
</style>
