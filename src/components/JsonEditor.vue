<template>
    <div style="display: flex ; flex-direction: column;">
        <Title style="flex: 1;" :title="'编辑区'"></Title>
        <div style="flex: 1;" class="button-container">
            <button class="btn blue" v-on:click="onDownload">下载数据</button>
        </div>
        <div style="flex: 17;" class="container">

            <div v-if="modelValue?.value" class="fieldComponent">
                <input class="input" type="text" v-model="modelValue.value.name" placeholder="字符串">
            </div>
            <component :is="getTypeComponentMap()[modelValue.param_type]" v-model="modelValue"
                :basicStructList="basicStructList" />
            <!-- <StructField v-model="modelValue" :basic-struct-list="basicStructList"></StructField> -->
        </div>
    </div>
</template>

<script setup>
import StructField from './JsonField/StructField.vue'
import Title from './Layout/Title.vue';

import { ref, watch } from 'vue'
import { getTypeComponentMap } from './utils/typeMap';

const emit = defineEmits(['onDownload'])

const props = defineProps({
    basicStructList: { type: Object, required: true },
})

const modelValue = defineModel() // Vue 3.4 之后的新写法

watch(modelValue, (newVal) => {
    if (modelValue.value.value && modelValue.value.value.name === '') {
        try {
            modelValue.value.value.name = '无标题';
        } catch {
            return;
        }

    }
})

const onDownload = () => {
    console.log("点击了下载");
    emit('onDownload')
}
</script>

<style scoped>
.button-container {
    /* display: flex; */
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
    width: 20%;
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
</style>
