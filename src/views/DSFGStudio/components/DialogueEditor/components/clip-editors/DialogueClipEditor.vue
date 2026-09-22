<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
import { normalizeDialogueInput, sanitizeDialogueInput, preventDialogueLineBreak } from "../../utils/dialogueTextInput";
import type { DialogueClip } from "../../types/DialogueNode";
import { getDialogueStyles } from "../../config/dialogueStyleRegistry";

const props = defineProps<{ clip: DialogueClip }>();
const content = computed({
  get: () => props.clip.content,
  set: (value: string) => { props.clip.content = normalizeDialogueInput(value); },
});
const dialogueStyles = inject<Ref<ReturnType<typeof getDialogueStyles>>>("dialogueStyleOptions", computed(() => getDialogueStyles()));
function moveParam(index: number, direction: number) {
  const target = index + direction;
  const params = props.clip.nodeGraphEvent;
  if (target < 0 || target >= params.length) return;
  [params[index], params[target]] = [params[target], params[index]];
}
</script>

<template>
  <div class="clip-fields">
    <label>
      对话样式
      <select v-model="clip.style">
        <option v-if="!dialogueStyles.some(item => item.id === clip.style)" :value="clip.style">{{ clip.style || '未设置' }}（当前值）</option>
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
    <label>台词内容<textarea v-model="content" rows="3" placeholder="换行请写 \n" @beforeinput="preventDialogueLineBreak" @input="sanitizeDialogueInput" /></label>
    <label>副标题<input v-model="clip.subtitle" /></label>
    <section class="dialogue-params" aria-label="对话入参">
      <div class="params-heading"><span>入参 <small>{{ clip.nodeGraphEvent.length }}/100</small></span><button class="add-param" type="button" :disabled="clip.nodeGraphEvent.length >= 100" @click="clip.nodeGraphEvent.push('0')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>添加入参</button></div>
      <div v-for="(_, index) in clip.nodeGraphEvent" :key="index" class="param-row">
        <span class="param-index" aria-hidden="true">{{ index + 1 }}</span>
        <input v-model="clip.nodeGraphEvent[index]" inputmode="numeric" :aria-label="`对话入参 ${index + 1}`" placeholder="整数值" />
        <div class="param-actions">
          <button class="icon-button" type="button" :disabled="index === 0" :aria-label="`上移参数 ${index + 1}`" title="上移" @click="moveParam(index, -1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg></button>
          <button class="icon-button" type="button" :disabled="index === clip.nodeGraphEvent.length - 1" :aria-label="`下移参数 ${index + 1}`" title="下移" @click="moveParam(index, 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6" /></svg></button>
          <button class="icon-button remove-param" type="button" :aria-label="`删除参数 ${index + 1}`" title="删除" @click="clip.nodeGraphEvent.splice(index, 1)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg></button>
        </div>
      </div>
      <small class="advance-hint">按列表顺序传入整数，最多 100 项；没有参数时保持空列表。</small>
    </section>
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
.dialogue-params { margin-top: 18px; color: var(--timeline-muted, #98a8bc); font-size: 11px; }
.params-heading, .param-row, .param-actions { display: flex; align-items: center; gap: 6px; }
.params-heading { justify-content: space-between; margin-bottom: 8px; }
.params-heading small { margin-left: 5px; color: var(--timeline-subtle, #738298); font-size: 10px; font-variant-numeric: tabular-nums; }
.param-row { margin-top: 6px; padding: 4px 5px; border: 1px solid var(--timeline-border, #3b485b); border-radius: 8px; background: var(--timeline-field, #141922); }
.param-index { width: 22px; flex-shrink: 0; text-align: center; color: var(--timeline-subtle, #738298); font-variant-numeric: tabular-nums; }
.param-row input { flex: 1; width: 0; min-width: 0; border: 0; background: transparent; padding: 5px 3px; }
.param-actions { gap: 2px; flex-shrink: 0; }
.dialogue-params button { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; border: 0; border-radius: 5px; color: var(--timeline-muted, #98a8bc); background: transparent; cursor: pointer; font: inherit; }
.dialogue-params button:hover:not(:disabled) { background: var(--timeline-soft, #303a49); color: var(--timeline-text, #edf4ff); }
.dialogue-params button:focus-visible, .param-row input:focus-visible { outline: 2px solid var(--timeline-accent, #628bc1); outline-offset: 1px; }
.dialogue-params button:disabled { opacity: .3; cursor: default; }
.dialogue-params .add-param { padding: 5px 7px; gap: 4px; color: var(--timeline-accent, #628bc1); }
.icon-button { width: 28px; height: 28px; padding: 5px; }
.dialogue-params .remove-param:hover:not(:disabled) { color: #dc5964; background: #dc596414; }
.dialogue-params svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
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
