<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TextPreviewLine } from "../utils/dialogueTextPreview";
import type { DialogueTextEdit, DialogueTextField } from "../utils/dialogueTextEditing";
import { getDialogueStyles } from "../config/dialogueStyleRegistry";
const props = defineProps<{ line: TextPreviewLine; index: number; canMoveUp: boolean; canMoveDown: boolean; movable: boolean; repeatSpeaker?: boolean }>();
const emit = defineEmits<{
  edit: [edit: DialogueTextEdit]; move: [direction: number]; insert: []; configure: []; addDialogue: []; remove: [];
}>();
const field = (name: DialogueTextField) => computed({
  get: () => props.line[name],
  set: (value: string) => emit("edit", { nodeId: props.line.nodeId, field: name, value }),
});
const speaker = field("speaker");
const subtitle = field("subtitle");
const content = field("content");
const style = field("style");
const dialogueStyles = getDialogueStyles();
const knownStyle = computed(() => dialogueStyles.some((item) => item.id === style.value));
const textarea = ref<HTMLTextAreaElement>();
function resize() {
  if (!textarea.value) return;
  textarea.value.style.height = "0px";
  textarea.value.style.height = `${textarea.value.scrollHeight + textarea.value.offsetHeight - textarea.value.clientHeight}px`;
}
let observer: ResizeObserver | undefined;
let measuredWidth = 0;
onMounted(() => {
  resize();
  observer = new ResizeObserver(() => {
    const width = textarea.value?.clientWidth ?? 0;
    if (width !== measuredWidth) { measuredWidth = width; resize(); }
  });
  if (textarea.value) observer.observe(textarea.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.line.content, () => nextTick(resize));
const hue = computed(() => [...props.line.speaker].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 210));
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); emit("insert"); }
  if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowUp" ? props.canMoveUp : props.canMoveDown) emit("move", event.key === "ArrowUp" ? -1 : 1);
  }
}
</script>

<template>
  <div class="script-line" :class="{ 'repeat-speaker': repeatSpeaker }" :style="{ '--speaker-hue': hue }" @keydown="keydown">
    <div class="line-gutter">
      <span class="line-number">{{ String(index + 1).padStart(2, '0') }}</span>
      <span v-if="movable" class="line-grip" title="拖动调整组内顺序" aria-label="拖动台词排序">⠿</span>
    </div>
    <div class="line-body">
      <template v-if="line.hasDialogue">
        <div class="line-identity">
          <span class="speaker-avatar" aria-hidden="true">{{ line.speaker.trim().slice(0, 1) || '旁' }}</span>
          <input v-model="speaker" class="speaker-input" aria-label="说话人" placeholder="旁白 / 说话人" />
          <input v-model="subtitle" class="subtitle-input" aria-label="副标题 Subtitle" title="副标题（Subtitle）" placeholder="副标题（可选）" />
          <select v-model="style" class="style-input" aria-label="对话样式" :title="`对话样式：${style}`">
            <option v-if="!knownStyle" :value="style">{{ style || '未设置' }}</option>
            <option v-for="item in dialogueStyles" :key="item.id" :value="item.id" :title="item.label">{{ item.id }}</option>
          </select>
        </div>
        <textarea ref="textarea" v-model="content" rows="1" aria-label="台词" placeholder="在这里写下对话…" @input="resize" />
      </template>
      <button v-else class="add-dialogue" type="button" @click="emit('addDialogue')">＋ 为此段添加台词</button>
      <div v-if="line.clipCount > 0" class="line-clip-summary">
        <button type="button" class="clip-count" :aria-label="`此句含 ${line.clipCount} 个演出 Clip，点击配置`" title="在节点图查看此句附带的 Clip" @click="emit('configure')">{{ line.clipCount }} 个 Clip ↗</button>
      </div>
      <div class="line-actions">
        <button type="button" :disabled="!canMoveUp" title="上移（Alt+↑）" aria-label="上移台词" @click="emit('move', -1)">↑</button>
        <button type="button" :disabled="!canMoveDown" title="下移（Alt+↓）" aria-label="下移台词" @click="emit('move', 1)">↓</button>
        <button type="button" title="插入台词（Ctrl+Enter）" aria-label="插入台词" @click="emit('insert')">＋</button>
        <button type="button" title="在节点图配置此句 Clip" @click="emit('configure')">Clip ↗</button>
        <button type="button" class="delete-line" aria-label="删除对话" :title="line.clipCount ? `删除此句及附带的 ${line.clipCount} 个 Clip（带选项卡时保留选项与其他 Clip）` : '删除此句对话，可立即撤销'" @click="emit('remove')">删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.script-line { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 10px; padding: 9px 12px 9px 6px; border-radius: 7px; }
.script-line:hover, .script-line:focus-within { background: #f7f9fc; }
.line-gutter { display: flex; flex-direction: column; align-items: center; padding-top: 5px; color: #a1aaba; font: 11px/1.5 monospace; }
.line-grip { font-size: 20px; cursor: grab; opacity: .35; user-select: none; touch-action: none; }
.script-line:hover .line-grip { opacity: 1; }
.line-body { position: relative; min-width: 0; padding-bottom: 4px; }
.line-identity { display: grid; grid-template-columns: 22px minmax(40px, .8fr) minmax(45px, 1fr) minmax(84px, 1.15fr); align-items: center; gap: 4px; margin-bottom: 3px; }
.repeat-speaker:not(:focus-within) .line-identity { display: none; }
.speaker-avatar { display: grid; place-items: center; flex-shrink: 0; width: 22px; height: 22px; border: 1px solid hsl(var(--speaker-hue) 46% 80%); background: hsl(var(--speaker-hue) 65% 94%); border-radius: 50%; color: hsl(var(--speaker-hue) 38% 44%); font-size: 11px; }
input, textarea, select { box-sizing: border-box; font: inherit; border: 1px solid transparent; border-radius: 4px; outline: none; background: transparent; }
input:hover, textarea:hover, select:hover { border-color: #e5eaf1; }
input:focus, textarea:focus, select:focus { border-color: #b7cce8; background: #fff; }
input::placeholder, textarea::placeholder { color: #a6afbd; }
.speaker-input { width: 100%; min-width: 0; color: hsl(var(--speaker-hue) 38% 40%); font-size: 12px; font-weight: 600; padding: 2px 3px; }
.subtitle-input { width: 100%; min-width: 0; font-size: 11px; color: #8c97a8; padding: 2px 3px; }
.style-input { width: 100%; min-width: 0; padding: 2px 0; color: #718097; font-size: 10px; cursor: pointer; }
.line-clip-summary { display: flex; justify-content: flex-end; margin-top: 2px; }
.clip-count { color: #527da8; background: #edf3fa; }
textarea { display: block; box-sizing: border-box; width: 100%; min-height: 32px; padding: 3px 7px; margin-left: -1px; border-left-color: hsl(var(--speaker-hue) 40% 88%); color: #334158; resize: none; overflow: hidden; font-size: 14px; line-height: 1.8; }
.line-actions { position: absolute; right: 0; top: -13px; display: flex; gap: 1px; opacity: 0; background: #f7f9fc; border-radius: 4px; }
.script-line:hover .line-actions, .script-line:focus-within .line-actions { opacity: 1; }
button { padding: 2px 5px; border: 0; border-radius: 4px; color: #75839a; background: transparent; font-family: inherit; font-size: 11px; line-height: 1.7; cursor: pointer; }
button:hover { color: #326baf; background: #e6eef9; }
button:disabled { opacity: .25; cursor: default; }
.delete-line { color: #a36a71; }
.delete-line:hover { color: #b84251; background: #fbe9ec; }
.add-dialogue { font-size: 12px; padding: 8px; }
</style>
