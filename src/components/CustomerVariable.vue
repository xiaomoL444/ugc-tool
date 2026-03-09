<template>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">

    <div style="display: flex ; flex-direction: column;flex:1">
        <Title style="flex: 1;" :title="'自定义变量'"></Title>
        <div style="flex: 17;" class="container">
            <div v-for="(item, index) in modelValue" :key="item.id">
                <SelectButton :title="item.name" :id="item.basic_struct_id" :isActive="selected === index"
                    @select="selected = index; selectVariable(index)">
                    <HoverExpandButton>
                        <div style="display: flex; flex-direction: row; gap: 2rem;">
                            <button title="删除该元素" :class="['operate-button']"
                                style="--btn-bg: #FF000050; --btn-bg-hover: #FF0000CC;"
                                v-on:click="modelValue.splice(index, 1)">-</button>
                        </div>
                    </HoverExpandButton>
                </SelectButton>
            </div>
        </div>
        <FileOperation style="flex: 1;" @blue-click="triggerFileInput" @delete-all-click="clearCache"></FileOperation>
    </div>

    <!-- 隐藏的文件输入 -->
    <input type="file" ref="fileInput" @change="onFileChange" accept=".json" style="display: none" />
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import Title from './Layout/Title.vue'
import SelectButton from './Layout/SelectButton.vue'
import FileOperation from './ListOperation/FileOperation.vue';
import HoverExpandButton from './Layout/HoverExpandButton.vue';

const modelValue = defineModel();

const selected = ref(0);

const emit = defineEmits(['onSelect'])

const fileInput = ref(null)
function triggerFileInput() {
    fileInput.value.click()
    fileInput.value.value = null
}


// 文件选择事件
const onFileChange = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    try {
        const text = await file.text()
        const data = JSON.parse(text)

        // 输入是整数
        //设置结构体的ID
        data.basic_struct_id = uuidv4().slice(0, 8);
        data.name = file.name;

        // 更新列表，为列表添加值
        modelValue.value.push(data);

        console.log('已读取文件并缓存')
    } catch (err) {
        console.error('读取文件失败:', err)
        alert('JSON 文件格式错误')
    }
}
// 清除缓存
const clearCache = () => {
    modelValue.value = [];
    console.log('已清除缓存')
}

const selectVariable = (index) => {
    console.log("select " + index);
    emit('onSelect', index)
}
</script>
