<template>
    <div class="MainBox">
        <button class="SelectButton" :class="{ active: isActive }" @click="$emit('select');" style="display: flex;">
            <div class="contain" style="flex: 2;">
                <div class="title">标题：{{ title }}</div>
                <div class="id">id:{{ id }}</div>

            </div>
            <slot></slot>
        </button>
    </div>

</template>
<script setup>

const props = defineProps({
    title: { type: String, required: true },
    id: { type: String, required: true },
    isActive: { type: Boolean, required: true }, // 父组件传入当前是否被选中
})
defineEmits(['select']) // 通知父组件我被点击了
</script>

<style scoped>
.MainBox {
    text-align: left;
    display: flex;
    justify-content: left;
    /* 水平居中 */
    align-items: left;
    height: auto;
    width: 100%;
    /* padding-left: 0.5vw; */
    /* margin-top: 1vw; */
}

.SelectButton {
    border: 1px solid rgba(255, 255, 255, 0.5);
    background: rgba(255, 255, 255, 0.1);
    color: black;
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.25s ease;
    flex: auto;
    /* width: max-content; */
    padding: 1rem;
    box-shadow: inset 0 0 0 0.1rem #6a5acd;
    /* 蓝紫色内边框 */
    box-sizing: border-box;
    text-align: left;

    word-break: break-word;
    /* 英文单词也能换行 */
    white-space: pre-wrap;
    /* 保留换行符并允许自动换行 */
    overflow-wrap: break-word;
    /* 补充换行策略 */

}

.SelectButton:hover {
    background: rgba(255, 255, 255, 0.25);
}

.SelectButton.active {
    background: #06B8FB25;
    /* color: black; */
    font-weight: bold;
    border-color: transparent;
    /* box-shadow: 0 0 8px rgba(255, 255, 255, 0.6); */
}

.contain {
    display: flex;
    flex-direction: column;
    gap: 0.5rem
}

.title {
    font-size: 1.05rem;
}

.id {
    font-size: 0.9rem;
}
</style>