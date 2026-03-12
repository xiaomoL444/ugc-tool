<template>
    <div class="ElementBox">
        <div style="  
        display: flex;                  /* 开启 Flex 布局 */
  justify-content: space-between; /* 左右两端对齐 */
  align-items: center;            /* 垂直居中 */">
            <div class="ElementBoxTitle">{{ title }}</div>
            <button class="btn" v-on:click="onClick">复制</button>
        </div>
        <div class="ElementContent">{{ content }}</div>
    </div>
</template>

<script setup>
import { defineProps } from 'vue';
import { toast } from 'vue-sonner';

const props = defineProps({
    title: String,
    content: String  // 声明父组件传递的 prop
})

function onClick() {
    console.log(props.content);

    navigator.clipboard.writeText(props.content)
        .then(() => {
            toast.success('复制成功')
        })
        .catch(err => {
            toast.error('复制失败' + err)
        })
}
</script>

<style scoped>
.btn {
    margin-right: 2rem;
    color: white;
    background-color: #4FACFE;
    padding: 8px 17px;

    font-size: large;

    border: 0;
    border-radius: 10px;
    transition:
        background-color 0.3s ease,
        transform 0.2s ease-out,
        color 0.3s ease;
}

.btn:hover {
    background-color: #337ecc;
    /* 更深一点的颜色 */

}
</style>