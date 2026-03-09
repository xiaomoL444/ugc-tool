<template>
  <div style="display: flex ; flex-direction: column;flex:1">
    <Title style="flex: 1;" :title="'高级数据管理结构体'"></Title>

    <div style="flex: 17;" class="container">
      <div v-for="(item, index) in modelValue" :key="item.id">
        <SelectButton :title="item.name" :id="item.basic_struct_id" :isActive="selected === index"
          @select="selected = index">
          <HoverExpandButton>
            <button title="删除该元素" :class="['operate-button']" style="--btn-bg: #FF000050; --btn-bg-hover: #FF0000CC;"
              v-on:click="modelValue.splice(index, 1)">-</button>
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
import { ref, onMounted } from 'vue'
import Title from './Layout/Title.vue'
import SelectButton from './Layout/SelectButton.vue'
import FileOperation from './ListOperation/FileOperation.vue'
import Collapse from './Layout/Collapse.vue'
import HoverExpandButton from './Layout/HoverExpandButton.vue'

const selected = ref(-1)

const modelValue = defineModel()

// 本地缓存 key - 基础结构体
const STORAGE_KEY = 'BasicStruct'

const emit = defineEmits(['onChange'])

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

    //键入ID
    let inputId = prompt(`请输入「 ${data.name} 」的 ID:`, '')
    // 如果用户取消了 prompt，退出
    if (inputId == null || !(/^\d+$/.test(inputId)) || inputId.length != 10) {
      alert('请输入有效10位长度的整数ID！')
      return
    }
    if (modelValue.value.some(item => item.basic_struct_id == inputId)) {
      alert('已存在该id的结构体！请重新添加')
      return
    }

    // 输入是整数
    //设置结构体的ID
    data.basic_struct_id = inputId;

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
  console.log('已清除变量')
}
</script>
