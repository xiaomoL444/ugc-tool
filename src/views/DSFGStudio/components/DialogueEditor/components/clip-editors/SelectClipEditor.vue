<script setup lang="ts">
import StudioSelectField from "../../../StudioSelectField.vue";
import { computed, inject, watchEffect, type Ref } from "vue";
import type { SelectClip } from "../../types/DialogueNode";
import { getSelectStyles } from "../../config/selectStyleRegistry";
import { createSelectOption } from "../../utils/dialogueProject";
import SelectOptionIcon from "../SelectOptionIcon.vue";
import { applyStyleParameters, syncStyleParameters } from "../../utils/styleParameters";
import StyleParameterFields from "./StyleParameterFields.vue";

const props = defineProps<{ clip: SelectClip }>();
const selectStyles = inject<Ref<ReturnType<typeof getSelectStyles>>>("selectStyleOptions", computed(() => getSelectStyles()));
const stylesReady = inject<Ref<boolean>>("selectStylePresetsReady", computed(() => true));
watchEffect(() => { if (stylesReady.value) syncStyleParameters(props.clip, selectStyles.value); });
const selectedStyle = computed({
  get: () => props.clip.style,
  set: (value: string) => {
    props.clip.style = value;
    applySelectedStyle();
  },
});
const changedParameters = computed(() => {
  const style = selectStyles.value.find(item => item.id === props.clip.style);
  return stylesReady.value && style && JSON.stringify(style.parameters ?? []) !== JSON.stringify(props.clip.parameterPreset?.parameters ?? []);
});
function applySelectedStyle() {
  if (!stylesReady.value) return;
  const style = selectStyles.value.find(item => item.id === props.clip.style);
  if (style) applyStyleParameters(props.clip, style);
}
</script>

<template>
  <div class="select-fields">
    <label>
      选项样式
      <StudioSelectField v-model="selectedStyle" :disabled="!stylesReady" aria-label="选项样式">
        <option v-if="!selectStyles.some(item => item.id === clip.style)" :value="clip.style">{{ clip.style || '未设置' }}（当前值）</option>
        <option
          v-for="style in selectStyles"
          :key="style.id"
          :value="style.id"
        >
          {{ style.label }}（{{ style.id }}）
        </option>
      </StudioSelectField>
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
    <StyleParameterFields v-model="clip.params" :parameters="clip.parameterPreset?.parameters" label="选项卡参数" preset-label="选项卡类型" />
    <button v-if="changedParameters" class="apply-parameters" type="button" @click="applySelectedStyle">应用预设参数（恢复默认值）</button>
  </div>
</template>

<style scoped>
.apply-parameters { margin-top: 8px; padding: 4px 7px; color: var(--timeline-accent, #628bc1); background: var(--timeline-soft, #303a49); border: 1px solid var(--timeline-border, #3b485b); border-radius: 5px; cursor: pointer; font-size: 10px; }
.select-fields label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--timeline-muted, #98a8bc);
  font-size: 11px;
}

.select-fields select,
.option-row input {
  box-sizing: border-box;
  width: 100%;
  padding: 7px;
  color: var(--timeline-text, #edf4ff);
  background: var(--timeline-field, #141922);
  border: 1px solid var(--timeline-border, #3b485b);
  border-radius: 5px;
}

.select-hint {
  display: block;
  margin-top: 5px;
  color: var(--timeline-subtle, #738298);
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
  color: var(--timeline-text, #c6d3e4);
  font-size: 11px;
}

.options-heading button,
.option-row button {
  color: var(--timeline-text, #dce6f4);
  background: var(--timeline-soft, #303a49);
  border: 1px solid var(--timeline-border, #4a586c);
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
  color: var(--timeline-subtle, #71839a);
  font-size: 10px;
  text-align: center;
}

.option-row button {
  height: 30px;
}
</style>
