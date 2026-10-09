<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { TextPreviewLine } from "../utils/dialogueTextPreview";
import type { DialogueTextEdit, DialogueTextField } from "../utils/dialogueTextEditing";
import { normalizeDialogueInput, sanitizeDialogueInput, preventDialogueLineBreak } from "../utils/dialogueTextInput";
import { dialogueStyleShowsTitle, getDialogueStyles } from "../config/dialogueStyleRegistry";
import DialogueStyleSelect from "./DialogueStyleSelect.vue";
const props = withDefaults(defineProps<{ line: TextPreviewLine; speakerAlias?: string; index: number; canMoveUp: boolean; canMoveDown: boolean; movable: boolean; canInsert?: boolean; repeatSpeaker?: boolean }>(), { canInsert: true });
const avatarLabel = computed(() => props.speakerAlias || props.line.speaker.trim().slice(0, 1) || "旁");
const emit = defineEmits<{
  edit: [edit: DialogueTextEdit]; move: [direction: number]; insert: []; configure: []; addDialogue: []; remove: []; pickSpeaker: [];
}>();
const field = (name: DialogueTextField) => computed({
  get: () => props.line[name],
  set: (value: string) => emit("edit", { nodeId: props.line.nodeId, clipId: props.line.clipId, field: name, value: name === "content" ? normalizeDialogueInput(value) : value }),
});
const speaker = field("speaker");
const subtitle = field("subtitle");
const content = field("content");
const style = field("style");
const dialogueStyles = inject<Ref<ReturnType<typeof getDialogueStyles>>>("dialogueStyleOptions", computed(() => getDialogueStyles()));
const showTitle = computed(() => dialogueStyleShowsTitle(style.value, dialogueStyles.value));
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
  if (event.key === "Enter" && (event.target as HTMLElement)?.tagName === "TEXTAREA") event.preventDefault();
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (props.canInsert) emit("insert"); }
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
      <div class="line-actions" role="group" aria-label="台词操作">
        <button type="button" :disabled="!canInsert" :title="canInsert ? '插入台词（Ctrl+Enter）' : '此节点含多段对话，请在 Timeline 中添加'" aria-label="插入台词" @click="emit('insert')">＋</button>
        <button type="button" title="在节点图配置此句 Clip" @click="emit('configure')">Clip ↗</button>
        <button type="button" class="delete-line" aria-label="删除对话" :title="(line.dialogueCount ?? 1) > 1 ? '删除当前 Dialogue Clip，保留其他台词与演出，可立即撤销' : line.clipCount ? `删除此句及附带的 ${line.clipCount} 个 Clip（带选项卡时保留选项与其他 Clip）` : '删除此句对话，可立即撤销'" @click="emit('remove')">删除</button>
      </div>
      <template v-if="line.hasDialogue">
        <div class="line-identity" :class="{ 'without-title': !showTitle }">
          <template v-if="showTitle">
          <button type="button" class="speaker-avatar" :class="{ 'has-alias': speakerAlias }" :title="`${avatarLabel} · 从预设实体选择说话人`" aria-label="从预设实体选择说话人" aria-haspopup="dialog" @click.stop="emit('pickSpeaker')">{{ avatarLabel }}</button>
          <input v-model="speaker" class="speaker-input" aria-label="说话人" placeholder="旁白 / 说话人" />
          <input v-model="subtitle" class="subtitle-input" aria-label="副标题 Subtitle" title="副标题（Subtitle）" placeholder="副标题（可选）" />
          </template>
          <DialogueStyleSelect v-model="style" :options="dialogueStyles" />
        </div>
        <textarea ref="textarea" v-model="content" rows="1" aria-label="台词" placeholder="输入对话，换行请写 \n" @beforeinput="preventDialogueLineBreak" @input="sanitizeDialogueInput($event); resize()" />
      </template>
      <button v-else class="add-dialogue" type="button" @click="emit('addDialogue')">＋ 为此段添加台词</button>
      <div v-if="line.clipCount > 0" class="line-clip-summary">
        <button type="button" class="clip-count" :aria-label="`此节点含 ${line.clipCount} 个演出 Clip，点击配置`" title="在节点图查看此节点的 Clip" @click="emit('configure')">{{ line.clipCount }} 个 Clip ↗</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.script-line { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 10px; padding: 9px 12px 9px 6px; border-radius: 7px; }
.script-line:hover, .script-line:focus-within { background: #f7f9fc; }
.line-gutter { display: flex; flex-direction: column; align-items: center; padding-top: 5px; color: #a1aaba; font-family: inherit; font-size: 11px; line-height: 1.5; }
.line-grip { font-size: 20px; cursor: grab; opacity: .35; user-select: none; touch-action: none; }
.script-line:hover .line-grip, .script-line:focus-within .line-grip { opacity: 1; }
.line-body { min-width: 0; padding-bottom: 4px; }
.line-identity { display: grid; grid-template-columns: auto minmax(40px, .8fr) minmax(45px, 1fr) minmax(84px, 1.15fr); align-items: center; gap: 4px; margin-bottom: 3px; }
.line-identity.without-title { grid-template-columns: minmax(0, 1fr); }
.without-title > :deep(.dialogue-style-select) { justify-self: end; width: min(240px, 100%); }
.repeat-speaker:not(:focus-within) .line-identity { display: none; }
.speaker-avatar { display: grid; place-items: center; flex-shrink: 0; width: 22px; height: 22px; padding: 0; border: 1px solid hsl(var(--speaker-hue) 46% 80%); background: hsl(var(--speaker-hue) 65% 94%); border-radius: 50%; color: hsl(var(--speaker-hue) 38% 44%); font-size: 11px; }
.speaker-avatar:focus-visible { outline: 2px solid #8b7be8; outline-offset: 2px; }
.speaker-avatar.has-alias { width: auto; min-width: 22px; max-width: 96px; height: auto; min-height: 22px; padding: 2px 6px; box-sizing: border-box; border-radius: 12px; line-height: 1.4; text-align: center; overflow-wrap: anywhere; }
input, textarea, select { box-sizing: border-box; font: inherit; border: 1px solid transparent; border-radius: 4px; outline: none; background: transparent; }
input:hover, textarea:hover, select:hover { border-color: #e5eaf1; }
input:focus, textarea:focus, select:focus { border-color: #b7cce8; background: #fff; }
input::placeholder, textarea::placeholder { color: #a6afbd; }
.speaker-input { width: 100%; min-width: 0; color: hsl(var(--speaker-hue) 38% 40%); font-size: 12px; font-weight: 600; padding: 2px 3px; }
.subtitle-input { width: 100%; min-width: 0; font-size: 11px; color: #8c97a8; padding: 2px 3px; }
.line-clip-summary { display: flex; justify-content: flex-end; margin-top: 2px; }
.clip-count { color: #527da8; background: #edf3fa; }
textarea { display: block; box-sizing: border-box; width: 100%; min-height: 32px; padding: 3px 7px; margin-left: -1px; border-left-color: hsl(var(--speaker-hue) 40% 88%); color: #334158; resize: none; overflow: hidden; font-size: 14px; line-height: 1.8; }
.line-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-bottom: 6px; }
button { padding: 2px 5px; border: 0; border-radius: 4px; color: #75839a; background: transparent; font-family: inherit; font-size: 11px; line-height: 1.7; cursor: pointer; }
button:hover { color: #326baf; background: #e6eef9; }
button:disabled { opacity: .25; cursor: default; }
.delete-line { color: #a36a71; }
.delete-line:hover { color: #b84251; background: #fbe9ec; }
.add-dialogue { font-size: 12px; padding: 8px; }
</style>
