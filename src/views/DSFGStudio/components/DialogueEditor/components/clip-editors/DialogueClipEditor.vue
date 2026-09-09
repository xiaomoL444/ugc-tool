<script setup lang="ts">
import type { DialogueClip } from "../../types/DialogueNode";
import { getDialogueStyles } from "../../config/dialogueStyleRegistry";

defineProps<{ clip: DialogueClip }>();
const dialogueStyles = getDialogueStyles();
</script>

<template>
  <div class="clip-fields">
    <label>
      对话样式
      <select v-model="clip.style">
        <option
          v-for="style in dialogueStyles"
          :key="style.id"
          :value="style.id"
        >
          {{ style.label }}（{{ style.id }}）
        </option>
      </select>
    </label>
    <label>说话人<input v-model="clip.speaker" /></label>
    <label>台词内容<textarea v-model="clip.content" rows="3" /></label>
    <label>副标题<input v-model="clip.subtitle" /></label>
    <label>
      推进方式
      <select v-model="clip.advanceMode">
        <option value="PlayerInput">玩家按下</option>
        <option value="None">不触发按下</option>
      </select>
    </label>
    <small class="advance-hint">
      黄色标记控制 ContinueDelayTime；不触发按下时导出为 -1，且不生成出口。
      Dialogue 的右边界始终跟随 Timeline 末尾。
    </small>
  </div>
</template>

<style scoped>
.clip-fields label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  color: #98a8bc;
  font-size: 11px;
}
input, textarea, select {
  box-sizing: border-box;
  width: 100%;
  padding: 7px;
  color: #edf4ff;
  background: #141922;
  border: 1px solid #3b485b;
  border-radius: 5px;
  resize: none;
}

.advance-hint {
  display: block;
  margin-top: 5px;
  color: #738298;
  font-size: 10px;
  line-height: 1.45;
}
</style>
