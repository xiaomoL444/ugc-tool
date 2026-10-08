<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EntityPreset } from "../../EntityPresetEditor/entityPresets";
import { studioEditorActiveKey } from "../../studioSessionHistory";

const props = defineProps<{ presets: EntityPreset[]; speaker: string; error: string }>();
const emit = defineEmits<{ select: [talker: string]; close: []; retry: [] }>();
const dialog = ref<HTMLDialogElement>();
const editorActive = inject(studioEditorActiveKey, () => true);
const search = ref("");
const namedPresets = computed(() => props.presets.filter(preset => preset.talker.trim()));
const results = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return namedPresets.value.filter(preset => [preset.name, preset.talker].some(value => value.toLocaleLowerCase().includes(query)));
});
onMounted(() => { if (editorActive()) dialog.value?.showModal(); });
watch(editorActive, active => {
  if (!active) { dialog.value?.close(); emit("close"); }
}, { flush: "sync" });
onBeforeUnmount(() => dialog.value?.close());
function select(preset: EntityPreset) {
  emit("select", preset.talker);
  dialog.value?.close();
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="speaker-picker dsfg-typography" aria-labelledby="speaker-picker-title" @close="emit('close')" @click.self="dialog?.close()" @pointerdown.stop @keydown.stop>
      <div class="picker-content">
        <header><h2 id="speaker-picker-title">选择说话人</h2><button type="button" class="close-button" aria-label="关闭说话人选择" @click="dialog?.close()">×</button></header>
        <input v-model="search" class="search-input" type="search" aria-label="搜索预设实体" placeholder="搜索实体代号或人名…" autofocus />
        <p v-if="error" class="picker-error" role="alert">{{ error }} <button type="button" @click="emit('retry')">重试</button></p>
        <div class="preset-list" role="group" aria-label="预设实体">
          <button v-for="preset in results" :key="preset.id" type="button" class="preset-choice" :class="{ selected: preset.talker === speaker }" :aria-pressed="preset.talker === speaker" @click="select(preset)">
            <span class="preset-info"><strong>{{ preset.name.trim() || preset.talker }}</strong><small>{{ preset.talker }}</small></span>
            <span v-if="preset.talker === speaker" class="selected-mark" aria-label="当前说话人">✓</span>
          </button>
          <p v-if="!results.length" class="empty-message">{{ namedPresets.length ? '没有匹配的实体，试试其他代号或人名。' : '暂无已填写人名的预设实体，可在「预设」中添加。' }}</p>
        </div>
        <p class="picker-hint">选择后填入人名，副标题保持不变。</p>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.speaker-picker { width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); padding: 0; border: 1px solid #ddd8f2; border-radius: 16px; background: #fff; color: #394560; box-shadow: 0 20px 65px #29234b30; }
.speaker-picker::backdrop { background: #29234455; }
.picker-content { padding: 20px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
h2 { margin: 0; font-size: 17px; }
button, input { font: inherit; }
button { cursor: pointer; }
.close-button { width: 30px; height: 30px; border: 0; border-radius: 8px; background: #f4f2fb; color: #6b6288; font-size: 22px; }
.search-input { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid #ded9f0; border-radius: 9px; background: #faf9ff; color: inherit; font-size: 13px; }
button:focus-visible, input:focus-visible { outline: 2px solid #8b7be8; outline-offset: 2px; }
.preset-list { display: grid; gap: 6px; max-height: min(360px, 50dvh); overflow-y: auto; margin-top: 12px; padding: 3px; }
.preset-choice { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 10px 12px; border: 1px solid transparent; border-radius: 9px; background: #fafaff; color: inherit; text-align: left; }
.preset-choice:hover { background: #f1edff; border-color: #ddd5ff; }
.preset-choice.selected { background: #eee8ff; color: #6b50be; }
.preset-info { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.preset-info strong { font-size: 13px; }
.preset-info small { color: #81849a; font-size: 12px; }
.selected-mark { flex-shrink: 0; }
.empty-message, .picker-hint { color: #8c8ca2; font-size: 12px; line-height: 1.7; }
.empty-message { padding: 15px 4px; text-align: center; }
.picker-hint { margin: 12px 0 0; }
.picker-error { color: #b24a65; font-size: 12px; }
.picker-error button { border: 0; background: transparent; color: #7563bf; }
</style>
