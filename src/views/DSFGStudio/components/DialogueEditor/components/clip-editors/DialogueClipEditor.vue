<script setup lang="ts">
import StudioSelectField from "../../../StudioSelectField.vue";
import { computed, inject, watchEffect, type Ref } from "vue";
import { normalizeDialogueInput, sanitizeDialogueInput, preventDialogueLineBreak } from "../../utils/dialogueTextInput";
import type { DialogueClip, DialogueAdvanceMode } from "../../types/DialogueNode";
import { getDialogueStyles } from "../../config/dialogueStyleRegistry";
import { applyStyleParameters, syncStyleParameters } from "../../utils/styleParameters";
import StyleParameterFields from "./StyleParameterFields.vue";

const props = defineProps<{ clip: DialogueClip; duration?: number }>();
const advanceMode = computed({
  get: () => props.clip.advanceMode,
  set: (value: DialogueAdvanceMode) => {
    if (value === "None" && props.clip.duration === undefined) {
      props.clip.duration = Math.max(0.1, props.duration ?? 2);
    }
    props.clip.advanceMode = value;
  },
});
const autoContinue = computed({
  get: () => props.clip.autoContinue,
  set: (value: number | string) => {
    props.clip.autoContinue = typeof value === "number" && Number.isFinite(value) ? value : -1;
  },
});
const content = computed({
  get: () => props.clip.content,
  set: (value: string) => { props.clip.content = normalizeDialogueInput(value); },
});
const dialogueStyles = inject<Ref<ReturnType<typeof getDialogueStyles>>>("dialogueStyleOptions", computed(() => getDialogueStyles()));
const stylesReady = inject<Ref<boolean>>("dialogueStylePresetsReady", computed(() => true));
watchEffect(() => { if (stylesReady.value) syncStyleParameters(props.clip, dialogueStyles.value); });
const selectedStyle = computed({
  get: () => props.clip.style,
  set: (value: string) => {
    props.clip.style = value;
    applySelectedStyle();
  },
});
const changedParameters = computed(() => {
  const style = dialogueStyles.value.find(item => item.id === props.clip.style);
  return stylesReady.value && style && JSON.stringify(style.parameters ?? []) !== JSON.stringify(props.clip.parameterPreset?.parameters ?? []);
});
function applySelectedStyle() {
  if (!stylesReady.value) return;
  const style = dialogueStyles.value.find(item => item.id === props.clip.style);
  if (style) applyStyleParameters(props.clip, style);
}
</script>

<template>
  <div class="clip-fields">
    <label>
      对话样式
      <StudioSelectField v-model="selectedStyle" :disabled="!stylesReady" aria-label="对话样式">
        <option v-if="!dialogueStyles.some(item => item.id === clip.style)" :value="clip.style">{{ clip.style || '未设置' }}（当前值）</option>
        <option
          v-for="style in dialogueStyles"
          :key="style.id"
          :value="style.id"
        >
          {{ style.label }}（{{ style.id }}）
        </option>
      </StudioSelectField>
    </label>
    <label>说话人<input v-model="clip.speaker" /></label>
    <label>台词内容<textarea v-model="content" rows="3" placeholder="换行请写 \n" @beforeinput="preventDialogueLineBreak" @input="sanitizeDialogueInput" /></label>
    <label>副标题<input v-model="clip.subtitle" /></label>
    <StyleParameterFields v-model="clip.nodeGraphEvent" :parameters="clip.parameterPreset?.parameters" label="对话参数" preset-label="对话类型" />
    <button v-if="changedParameters" class="apply-parameters" type="button" @click="applySelectedStyle">应用预设参数（恢复默认值）</button>
    <label>
      推进方式
      <StudioSelectField v-model="advanceMode">
        <option value="PlayerInput">玩家按下</option>
        <option value="None">不触发按下</option>
      </StudioSelectField>
    </label>
    <small class="advance-hint">
      黄色标记控制 ContinueDelayTime；不触发按下时导出为 -1，且不生成出口。
      玩家按下时右端跟随 Timeline 末尾；不触发按下时可调整持续时间，并在右侧继续添加对话。
    </small>
    <label>
      自动推进等待时间（秒）
      <input v-model.number="autoContinue" type="number" step="0.1" />
    </label>
    <small class="advance-hint">默认 -1，即使用全局自动推进时间，为 10s。</small>
  </div>
</template>

<style scoped>
.apply-parameters { margin-top: 8px; padding: 4px 7px; color: var(--timeline-accent, #628bc1); background: var(--timeline-soft, #303a49); border: 1px solid var(--timeline-border, #3b485b); border-radius: 5px; cursor: pointer; font-size: 10px; }
.clip-fields label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
  color: var(--timeline-muted, #98a8bc);
  font-size: 11px;
}
input, textarea, select {
  box-sizing: border-box;
  width: 100%;
  padding: 7px;
  color: var(--timeline-text, #edf4ff);
  background: var(--timeline-field, #141922);
  border: 1px solid var(--timeline-border, #3b485b);
  border-radius: 5px;
  resize: none;
}

.advance-hint {
  display: block;
  margin-top: 5px;
  color: var(--timeline-subtle, #738298);
  font-size: 10px;
  line-height: 1.45;
}
</style>
