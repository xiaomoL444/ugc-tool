<script setup lang="ts">
import StudioSelectField from "../../../StudioSelectField.vue";
import type { SelectClip } from "../../types/DialogueNode";
import { getSelectStyles } from "../../config/selectStyleRegistry";
import { createSelectOption } from "../../utils/dialogueProject";
import SelectOptionIcon from "../SelectOptionIcon.vue";

const props = defineProps<{ clip: SelectClip }>();
const selectStyles = getSelectStyles();
function moveParam(index: number, direction: number) {
  const target = index + direction;
  const params = props.clip.params;
  if (target < 0 || target >= params.length) return;
  [params[index], params[target]] = [params[target], params[index]];
}
</script>

<template>
  <div class="select-fields">
    <label>
      选项样式
      <StudioSelectField v-model="clip.style">
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
    <section class="select-params" aria-label="选项卡入参">
      <div class="params-heading"><span>入参 <small>{{ clip.params.length }}/100</small></span><button class="add-param" type="button" :disabled="clip.params.length >= 100" @click="clip.params.push('0')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>添加入参</button></div>
      <div v-for="(_, index) in clip.params" :key="index" class="param-row">
        <span class="param-index" aria-hidden="true">{{ index + 1 }}</span>
        <input v-model="clip.params[index]" inputmode="numeric" :aria-label="`选项卡入参 ${index + 1}`" placeholder="整数值" />
        <div class="param-actions">
          <button class="icon-button" type="button" :disabled="index === 0" :aria-label="`上移参数 ${index + 1}`" title="上移" @click="moveParam(index, -1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg></button>
          <button class="icon-button" type="button" :disabled="index === clip.params.length - 1" :aria-label="`下移参数 ${index + 1}`" title="下移" @click="moveParam(index, 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6" /></svg></button>
          <button class="icon-button remove-param" type="button" :aria-label="`删除参数 ${index + 1}`" title="删除" @click="clip.params.splice(index, 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg></button>
        </div>
      </div>
      <small class="select-hint">按列表顺序传入整数，最多 100 项；没有参数时保持空列表。</small>
    </section>
  </div>
</template>

<style scoped>
.select-params { margin-top: 18px; color: var(--timeline-muted, #98a8bc); font-size: 11px; }
.params-heading, .param-row, .param-actions { display: flex; align-items: center; gap: 6px; }
.params-heading { justify-content: space-between; margin-bottom: 8px; }
.params-heading small { margin-left: 5px; color: var(--timeline-subtle, #738298); font-size: 10px; font-variant-numeric: tabular-nums; }
.param-row { margin-top: 6px; padding: 4px 5px; border: 1px solid var(--timeline-border, #3b485b); border-radius: 8px; background: var(--timeline-field, #141922); }
.param-index { width: 22px; flex-shrink: 0; text-align: center; color: var(--timeline-subtle, #738298); font-variant-numeric: tabular-nums; }
.param-row input { flex: 1; width: 0; min-width: 0; border: 0; border-radius: 5px; background: transparent; padding: 5px 3px; color: var(--timeline-text, #edf4ff); font: inherit; }
.param-actions { gap: 2px; flex-shrink: 0; }
.select-params button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; border: 0; border-radius: 5px; color: var(--timeline-muted, #98a8bc); background: transparent; cursor: pointer; font: inherit; }
.select-params button:hover:not(:disabled) { background: var(--timeline-soft, #303a49); color: var(--timeline-text, #edf4ff); }
.select-params button:focus-visible, .param-row input:focus-visible { outline: 2px solid var(--timeline-accent, #628bc1); outline-offset: 1px; }
.select-params button:disabled { opacity: .3; cursor: default; }
.select-params .add-param { padding: 5px 7px; gap: 4px; color: var(--timeline-accent, #628bc1); }
.icon-button { width: 28px; height: 28px; padding: 5px; }
.select-params .remove-param:hover:not(:disabled) { color: #dc5964; background: #dc596414; }
.select-params svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
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
