<template>
    <div class="button-container">

        <!-- 红色删除按钮 -->
        <button class="btn red" @click="handleDeleteAllClick">删除全部</button>
        <!-- 居中蓝色按钮 -->
        <button class="btn blue" v-on:click="handleBlueClick">导入数据</button>

    </div>
</template>

<script setup>

import { defineEmits } from 'vue'

// 定义子组件会发出的事件
const emit = defineEmits(['blue-click', 'delete-all-click'])

// 子组件内部按钮触发
function handleBlueClick() {
    emit('blue-click') // 通知父组件
}

function handleDeleteAllClick() {
    if (confirm('确定要删除全部吗？')) {
        emit('delete-all-click')
    }

}

</script>

<style scoped>
.button-container {
    display: flex;
    justify-content: center;
    /* 水平居中 */
    align-items: center;
    /* 垂直居中 */
    gap: 2rem;
    /* 两个按钮间距 */
    /* margin-top: 2rem; */
    margin: 1rem 1rem;
}

/* 通用按钮样式 */
.btn {
    padding: 0.6rem 1.2rem;
    font-size: 1.2rem;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: background 0.2s ease;
    display: flex;
    white-space: nowrap; /* 不换行 */
}

/* 蓝色按钮 */
.btn.blue {
    background-color: #3b82f6;
    /* 蓝色 */
    color: white;
    text-align: center;
    align-items: center;
    justify-content: center;
    flex: 1;
}

.btn.blue:hover {
    background-color: #2563eb;
    /* 深蓝 */
}

/* 红色按钮 */
.btn.red {
    background-color: #ef4444;
    /* 红色 */
    color: white;
}

.btn.red:hover {
    background-color: #b91c1c;
    /* 深红 */
}
</style>
