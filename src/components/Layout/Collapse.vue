<template>
    <div class="collapse">
        <!-- 标题栏 -->
        <div class="header" @click="isOpen = !isOpen">
            <span class="title">{{ title }} 点击展开</span>
            <span class="icon">{{ isOpen ? '▲' : '▼' }}</span>
        </div>

        <!-- 内容区 -->
        <transition name="fade">
            <div v-show="isOpen" class="content">
                <slot></slot>
            </div>
        </transition>
    </div>
</template>

<script setup>
import { ref, watch, defineProps } from 'vue'

const props = defineProps({
    title: {
        type: String,
        default: '折叠块'
    },
    defaultOpen: {
        type: Boolean,
        default: true
    }
})

const isOpen = ref(props.defaultOpen)

// 🔄 如果父组件动态改变 defaultOpen，则同步更新
watch(() => props.defaultOpen, val => {
    isOpen.value = val
})
</script>

<style scoped>
.collapse {
    border: 1px solid #00000025;
    border-radius: 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    margin: 0.5rem 0;
    transition: all 0.3s ease;
}

.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    padding: 0.75rem 1rem;
    color: #111;
    font-weight: 600;
    user-select: none;
}

.header:hover {
    background: rgba(255, 255, 255, 0.1);
}

.title {
    flex: 1;
    text-decoration: underline;
}

.icon {
    color: #bbb;
    font-size: 0.8rem;
}

/* 动画 */
.fade-enter-active,
.fade-leave-active {
    transition: all 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    max-height: 0;
    overflow: hidden;
}

.fade-enter-to,
.fade-leave-from {
    opacity: 1;
    max-height: 500px;
}

.content {
    padding-bottom: 1rem;
}
</style>
