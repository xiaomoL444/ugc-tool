<script setup lang="ts">
import type { SelectClip } from "../../types/DialogueNode";
import { getSelectStyles } from "../../config/selectStyleRegistry";
import { createSelectOption } from "../../utils/dialogueProject";
import SelectOptionIcon from "../SelectOptionIcon.vue";

const props = defineProps<{ clip: SelectClip }>();
const selectStyles = getSelectStyles();

</script>

<template>
  <div class="select-fields">
    <label>
      选项样式
      <select v-model="clip.style">
        <option
          v-for="style in selectStyles"
          :key="style.id"
          :value="style.id"
        >
          {{ style.label }}（{{ style.id }}）
        </option>
      </select>
    </label>
    <small class="select-hint">
      黄色标记控制 ContinueDelayTime；Select 的右边界始终跟随 Timeline
      末尾。
    </small>

    <div class="options-heading">
      <strong>选项内容 / 图标</strong>
      <button type="button" @click="clip.options.push(createSelectOption())">
        ＋ 选项
      </button>
    </div>

    <div
      v-for="(option, index) in clip.options"
      :key="option.id"
      class="option-row"
    >
      <span>{{ index + 1 }}</span>
      <input v-model="option.content" placeholder="Content" />
      <SelectOptionIcon v-model="option.icon" :label="`选项 ${index + 1} 图标`" />
      <button
        type="button"
        aria-label="删除选项"
        @click="clip.options.splice(index, 1)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.select-fields label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #98a8bc;
  font-size: 11px;
}

.select-fields select,
.option-row input {
  box-sizing: border-box;
  width: 100%;
  padding: 7px;
  color: #edf4ff;
  background: #141922;
  border: 1px solid #3b485b;
  border-radius: 5px;
}

.select-hint {
  display: block;
  margin-top: 5px;
  color: #738298;
  font-size: 10px;
  line-height: 1.45;
}

.options-heading {
  display: flex;
  align-items: center;
}

.options-heading {
  justify-content: space-between;
  margin-top: 12px;
  color: #c6d3e4;
  font-size: 11px;
}

.options-heading button,
.option-row button {
  color: #dce6f4;
  background: #303a49;
  border: 1px solid #4a586c;
  border-radius: 4px;
  cursor: pointer;
}

.options-heading button {
  padding: 4px 7px;
}

.option-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 105px 26px;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}

.option-row span {
  color: #71839a;
  font-size: 10px;
  text-align: center;
}

.option-row button {
  height: 30px;
}
</style>
