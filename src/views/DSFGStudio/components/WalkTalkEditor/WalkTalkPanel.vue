<script setup lang="ts">
import { toast } from "vue-sonner";
import { addWalkTalkEntry, moveWalkTalkEntry, removeWalkTalkEntry, WALK_TALK_LIMIT, type WalkTalkProject } from "./walkTalkProject";
import { WALK_TALK_STYLE_OPTIONS } from "./walkTalkStyles";

const props = defineProps<{ project: WalkTalkProject }>();
function add(afterId?: string) {
  try { addWalkTalkEntry(props.project, afterId); }
  catch (error) { toast.warning(error instanceof Error ? error.message : String(error)); }
}
function remove(id: string, index: number) {
  if (confirm(`删除第 ${index + 1} 条台词？其余台词将按当前顺序保留。`)) removeWalkTalkEntry(props.project, id);
}
</script>

<template>
  <section class="walk-talk-panel" aria-label="边走边说顺序列表">
    <header class="list-toolbar">
      <div><strong>顺序台词</strong><small>{{ project.entries.length }}/{{ WALK_TALK_LIMIT }} 条 · 按从上到下的顺序导出</small></div>
      <button type="button" class="primary" :disabled="project.entries.length >= WALK_TALK_LIMIT" @click="add()">＋ 添加台词</button>
    </header>
    <div class="dialogue-list">
      <article v-for="(entry, index) in project.entries" :key="entry.id" class="dialogue-card" :aria-label="`第 ${index + 1} 条台词`">
        <header class="card-header">
          <span class="order">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="card-title">{{ entry.talker || '未填写说话人' }}<small v-if="entry.subtitle"> · {{ entry.subtitle }}</small></span>
          <button type="button" :disabled="index === 0" :aria-label="`上移第 ${index + 1} 条台词`" @click="moveWalkTalkEntry(project, entry.id, -1)">↑</button>
          <button type="button" :disabled="index === project.entries.length - 1" :aria-label="`下移第 ${index + 1} 条台词`" @click="moveWalkTalkEntry(project, entry.id, 1)">↓</button>
          <button type="button" :disabled="project.entries.length >= WALK_TALK_LIMIT" :aria-label="`在第 ${index + 1} 条之后插入台词`" @click="add(entry.id)">＋ 插入</button>
          <button type="button" class="danger" :aria-label="`删除第 ${index + 1} 条台词`" @click="remove(entry.id, index)">删除</button>
        </header>
        <div class="card-body">
          <div class="speaker-fields">
            <label>说话人 <code>talker</code><input v-model="entry.talker" :aria-label="`第 ${index + 1} 条说话人`" placeholder="说话人" /></label>
            <label>副标题 <code>subtitle</code><input v-model="entry.subtitle" :aria-label="`第 ${index + 1} 条副标题`" placeholder="可留空" /></label>
            <label>样式 <code>style</code><select v-model="entry.style" :aria-label="`第 ${index + 1} 条样式`">
              <option v-if="!WALK_TALK_STYLE_OPTIONS.some(option => option.value === entry.style)" :value="entry.style" disabled>{{ entry.style ? `${entry.style}（旧值）` : '未设置（旧值）' }}</option>
              <option v-for="option in WALK_TALK_STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select></label>
          </div>
          <div class="content-fields">
            <label>台词内容 <code>content</code><textarea v-model="entry.content" :aria-label="`第 ${index + 1} 条内容`" rows="5" placeholder="填写台词内容…" /></label>
            <div class="timing-fields">
              <label>推进延迟（秒） <code>continueDelay</code><input v-model="entry.continueDelay" inputmode="decimal" :aria-label="`第 ${index + 1} 条推进延迟`" /></label>
              <label>自动推进时间（秒） <code>autoContinue</code><input v-model="entry.autoContinue" inputmode="decimal" :aria-label="`第 ${index + 1} 条自动推进时间`" /></label>
            </div>
          </div>
        </div>
        <details class="params"><summary>整数参数 <code>prams · Int32List</code></summary><label>按顺序填写，使用逗号、空格或换行分隔，最多 100 项。<textarea v-model="entry.prams" :aria-label="`第 ${index + 1} 条整数参数`" rows="2" placeholder="例如：0, 1, 100" /></label></details>
      </article>
      <div v-if="!project.entries.length" class="list-empty"><h3>从第一句台词开始</h3><p>这是顺序列表，不使用节点、连线或 Timeline。</p><button class="primary" type="button" @click="add()">＋ 添加第一句台词</button></div>
    </div>
  </section>
</template>

<style scoped>
.walk-talk-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; background: #f5f8fc; color: #34445b; font-size: 13px; }
button, input, textarea, select { font: inherit; }
button { padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 5px; background: #fff; color: #415877; cursor: pointer; }
button:hover:not(:disabled) { border-color: #76a1d1; background: #eff6ff; }
button:disabled { opacity: .45; cursor: default; }
button.primary { color: white; background: #2877c7; border-color: #2877c7; }
button.danger { color: #b45353; }
.list-toolbar { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px 18px; background: white; border-bottom: 1px solid #dbe3ed; }
.list-toolbar > div { display: flex; flex-direction: column; gap: 5px; }
.list-toolbar strong { font-size: 15px; }
.list-toolbar small { color: #8393a7; font-size: 11px; }
.dialogue-list { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
.dialogue-card { border: 1px solid #d7e1ee; background: white; border-radius: 9px; margin-bottom: 14px; overflow: hidden; }
.card-header { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; padding: 10px 13px; background: #edf3fb; border-bottom: 1px solid #dce5f1; }
.order { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 26px; border-radius: 5px; background: #d9e9fb; color: #346ba5; font-weight: 600; }
.card-title { flex: 1; min-width: 90px; overflow-wrap: anywhere; }
.card-title small { color: #8292a7; }
.card-body { display: grid; grid-template-columns: minmax(140px, 24%) minmax(0, 1fr); gap: 18px; padding: 14px; }
label { display: block; color: #61748c; font-size: 12px; }
code { color: #91a0b3; font-family: inherit; font-size: 10px; }
input, textarea, select { box-sizing: border-box; width: 100%; min-width: 0; margin-top: 6px; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 5px; color: #334155; background: #fff; line-height: 1.5; }
textarea { resize: vertical; }
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }
.speaker-fields { display: flex; flex-direction: column; gap: 11px; }
.content-fields > label textarea { min-height: 138px; }
.timing-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 8px; }
.params { margin: 0 14px 14px; padding: 10px; border-radius: 5px; background: #f8fafc; }
.params summary { cursor: pointer; color: #63788f; font-size: 12px; }
.params label { margin-top: 10px; font-size: 11px; }
.list-empty { text-align: center; margin: 60px auto; color: #8090a5; }
.list-empty h3 { color: #536a84; font-size: 17px; }
.list-empty p { margin-bottom: 22px; line-height: 1.7; }
@media (max-width: 850px) { .card-body { grid-template-columns: 1fr; } .speaker-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .speaker-fields label:last-child { grid-column: 1 / -1; } }
</style>
