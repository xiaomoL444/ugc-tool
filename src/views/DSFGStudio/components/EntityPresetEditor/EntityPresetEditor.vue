<script setup lang="ts">
import { nextTick, ref } from "vue";
import EditorKindSelect from "../EditorKindSelect.vue";
import { createEntityPreset } from "./entityPresets";
import { useEntityPresets } from "./useEntityPresets";

withDefaults(defineProps<{ editorKind?: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets" }>(), { editorKind: "EntityPresets" });
const emit = defineEmits<{ "update:editorKind": [value: "Dialogue" | "Quest" | "WalkTalk" | "EntityPresets"] }>();
const { presets, ready, error, status, retry, flush } = useEntityPresets();
const list = ref<HTMLElement>();
async function addPreset() {
  presets.value.push(createEntityPreset());
  await nextTick();
  list.value?.querySelector<HTMLElement>("article:last-child input")?.focus();
}
defineExpose({ prepareToLeave: flush });
</script>

<template>
  <div class="entity-editor">
    <EditorKindSelect :model-value="editorKind" @update:model-value="emit('update:editorKind', $event)" />
    <main>
      <header><div><h2>预设实体</h2><p>保存常用人物，在对话的「添加对话」中一键创建空白台词。</p></div><button type="button" :disabled="!ready" @click="addPreset">＋ 新建人物预设</button></header>
      <p class="status" role="status">{{ status }}</p>
      <p v-if="error" role="alert" class="error">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></p>
      <p class="hint">当前工作区共用。修改或删除预设不影响已经创建的对话。</p>
      <div ref="list" class="preset-list">
        <article v-for="(preset, index) in presets" :key="preset.id" :aria-label="`人物预设 ${index + 1}`">
          <span class="avatar">{{ preset.talker.trim().slice(0, 1) || '人' }}</span>
          <label>Talker · 人名<input v-model="preset.talker" :aria-label="`人物 ${index + 1} Talker`" placeholder="例如：A" /></label>
          <label>Subtitle · 副标题<input v-model="preset.subtitle" :aria-label="`人物 ${index + 1} Subtitle`" placeholder="可留空" /></label>
          <button type="button" class="delete" :aria-label="`删除人物预设 ${index + 1}`" @click="presets = presets.filter(item => item.id !== preset.id)">删除</button>
          <small v-if="!preset.talker.trim()" class="draft-hint">填入人名后，即可在对话中使用。</small>
        </article>
      </div>
      <div v-if="ready && !presets.length" class="empty">还没有人物预设。点击「新建人物预设」，填写人名即可，副标题可留空。</div>
    </main>
  </div>
</template>

<style scoped>
.entity-editor { display: flex; flex-direction: column; height: 100%; min-height: 0; color: #334158; background: #f5f7fb; }
main { padding: 24px; overflow: auto; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h2 { font-size: 20px; margin: 0 0 8px; }
p { font-size: 13px; line-height: 1.7; margin: 4px 0; }
.status, .hint { color: #7c899c; font-size: 12px; }
.preset-list { display: grid; gap: 12px; margin-top: 22px; max-width: 900px; }
article { display: grid; grid-template-columns: 32px minmax(100px, 1fr) minmax(100px, 1fr) auto; align-items: center; gap: 16px; padding: 18px; border: 1px solid #dbe4ef; border-radius: 10px; background: #fff; }
.avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: #537db0; background: #eaf1fb; }
label { display: grid; gap: 6px; color: #75839a; font-size: 12px; }
input { box-sizing: border-box; width: 100%; min-width: 0; padding: 9px; border: 1px solid #d4deeb; border-radius: 5px; font: inherit; color: #334158; background: #fafcff; }
input:focus { outline: 2px solid #b4d0f4; }
button { cursor: pointer; border: 1px solid #bed0e5; border-radius: 6px; padding: 8px 12px; color: #315f98; background: #edf4fd; font: inherit; font-size: 12px; }
button:disabled { opacity: .4; cursor: default; }
.delete { color: #a4676c; background: #fff; border-color: #eadcdf; }
.empty { padding: 40px 24px; margin-top: 20px; border: 1px dashed #cedbea; border-radius: 10px; color: #8491a3; font-size: 13px; }
.draft-hint { grid-column: 2 / -1; color: #9b8359; font-size: 11px; }
.error { color: #b95b60; }
@media (max-width: 760px) { main { padding: 14px; } article { grid-template-columns: 28px minmax(80px, 1fr) minmax(80px, 1fr); gap: 10px; padding: 12px; } .delete { grid-column: 2 / -1; justify-self: end; } }
</style>
