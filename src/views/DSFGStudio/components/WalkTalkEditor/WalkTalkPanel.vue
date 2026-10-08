<script setup lang="ts">
import StudioSelectField from "../StudioSelectField.vue";
import { ref } from "vue";
import { toast } from "vue-sonner";
import { addWalkTalkEntry, removeWalkTalkEntry, WALK_TALK_LIMIT, type WalkTalkProject } from "./walkTalkProject";
import { useStylePresets } from "../EntityPresetEditor/stylePresets";
import AutoGrowTextarea from "./AutoGrowTextarea.vue";
import { useWalkTalkReorder } from "./useWalkTalkReorder";
const { options: WALK_TALK_STYLE_OPTIONS, error: styleError, retry: retryStyles } = useStylePresets("walkTalkStyles");
const props = defineProps<{ project: WalkTalkProject }>();
const list = ref<HTMLElement>();
const expanded = ref(new Set<string>());
const { draggingId, beforeId, validDrop, ghost, announcement, start, keyboardMove } = useWalkTalkReorder(() => props.project, list);
function toggleDetails(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
}
function add(afterId?: string) {
  try { addWalkTalkEntry(props.project, afterId); }
  catch (error) { toast.warning(error instanceof Error ? error.message : String(error)); }
}
function remove(id: string, index: number) {
  if (confirm(`删除第 ${index + 1} 条台词？其余台词将按当前顺序保留。`)) {
    removeWalkTalkEntry(props.project, id);
    expanded.value.delete(id);
  }
}
</script>

<template>
  <section class="walk-talk-panel" aria-label="边走边说顺序列表">
    <header class="list-toolbar">
      <div><strong>顺序台词</strong><small>{{ project.entries.length }}/{{ WALK_TALK_LIMIT }} 条 · 拖动左侧把手调整顺序</small></div>
      <button type="button" class="primary" :disabled="project.entries.length >= WALK_TALK_LIMIT" @click="add()">＋ 添加台词</button>
    </header>
    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
    <div ref="list" class="dialogue-list" :class="{ 'is-dragging': draggingId }">
      <p v-if="styleError" role="alert">{{ styleError }} <button type="button" @click="retryStyles().catch(() => undefined)">重试类型预设</button></p>
      <article v-for="(entry, index) in project.entries" :key="entry.id" class="dialogue-card"
        :data-entry-id="entry.id"
        :class="{ 'drag-source': draggingId === entry.id, 'drop-before': draggingId && validDrop && beforeId === entry.id }"
        :aria-label="`第 ${index + 1} 条台词`">
        <div class="dialogue-row">
          <button type="button" class="drag-handle" :aria-label="`拖动第 ${index + 1} 条台词调整顺序，也可按 Alt 加上下方向键`"
            title="拖动调整顺序 · Alt + ↑ / ↓" @pointerdown="start($event, entry.id)" @keydown="keyboardMove($event, entry.id)">
            <span class="order">{{ String(index + 1).padStart(2, '0') }}</span>
            <svg viewBox="0 0 16 20" width="14" height="18" aria-hidden="true"><circle v-for="n in 6" :key="n" :cx="n % 2 ? 5 : 11" :cy="4 + Math.floor((n - 1) / 2) * 6" r="1.5" fill="currentColor" /></svg>
          </button>
          <label class="talker-field">说话人<input v-model="entry.talker" :aria-label="`第 ${index + 1} 条说话人`" placeholder="说话人" /></label>
          <label class="subtitle-field">副标题<input v-model="entry.subtitle" :aria-label="`第 ${index + 1} 条副标题`" placeholder="可留空" /></label>
          <label class="content-field">台词内容<AutoGrowTextarea v-model="entry.content" :aria-label="`第 ${index + 1} 条内容`" placeholder="填写台词内容…" /></label>
          <label class="style-field">样式<StudioSelectField v-model="entry.style" :title="entry.style" :aria-label="`第 ${index + 1} 条样式`">
            <option v-if="!WALK_TALK_STYLE_OPTIONS.some(option => option.value === entry.style)" :value="entry.style" disabled>{{ entry.style ? `${entry.style}（旧值）` : '未设置（旧值）' }}</option>
            <option v-for="option in WALK_TALK_STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </StudioSelectField></label>
          <label class="delay-field">推进延迟<span class="delay-input"><input v-model="entry.continueDelay" inputmode="decimal" :aria-label="`第 ${index + 1} 条推进延迟`" /><span>秒</span></span></label>
          <div class="card-actions" role="group" :aria-label="`第 ${index + 1} 条台词操作`">
            <button type="button" class="details-button" :class="{ 'has-details': entry.params }"
              :aria-expanded="expanded.has(entry.id)" :aria-controls="`walk-talk-details-${entry.id}`" :aria-label="`第 ${index + 1} 条整数参数`"
              title="整数参数" @click="toggleDetails(entry.id)">更多</button>
            <button type="button" :disabled="project.entries.length >= WALK_TALK_LIMIT" :aria-label="`在第 ${index + 1} 条之后插入台词`" title="在下方插入台词" @click="add(entry.id)">＋</button>
            <button type="button" class="danger" :aria-label="`删除第 ${index + 1} 条台词`" title="删除台词" @click="remove(entry.id, index)">
              <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6m4-6v6" /></svg>
            </button>
          </div>
        </div>
        <div v-show="expanded.has(entry.id)" :id="`walk-talk-details-${entry.id}`" class="extra-fields">
          <label>整数参数 <small>逗号、空格或换行分隔，最多 100 项</small><AutoGrowTextarea v-model="entry.params" :aria-label="`第 ${index + 1} 条整数参数`" placeholder="例如：0, 1, 100" /></label>
        </div>
      </article>
      <div v-if="draggingId && validDrop && beforeId === null" class="drop-end" aria-hidden="true" />
      <div v-if="!project.entries.length" class="list-empty"><h3>从第一句台词开始</h3><p>添加说话人和内容，按顺序编排这段对话。</p><button class="primary" type="button" @click="add()">＋ 添加第一句台词</button></div>
    </div>
    <Teleport to="body">
      <div v-if="draggingId" class="walk-talk-drag-ghost" :style="{ left: ghost.left + 'px', top: ghost.top + 'px', width: ghost.width + 'px' }" aria-hidden="true">
        <span>⠿</span><strong>{{ ghost.talker }}</strong><span class="ghost-content">{{ ghost.content }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.walk-talk-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; background: transparent; color: #34445b; font-size: 13px; text-align: left; container-type: inline-size; }
button, input, textarea, select { font: inherit; }
button { padding: 6px 9px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #415877; cursor: pointer; }
button:hover:not(:disabled) { border-color: #76a1d1; background: #eff6ff; }
button:disabled { opacity: .45; cursor: default; }
button.primary { color: white; background: #2877c7; border-color: #2877c7; }
button.danger { color: #b45353; }
.list-toolbar { display: flex; flex-shrink: 0; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 16px; background: white; border-bottom: 1px solid #dbe3ed; }
.list-toolbar > div { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; }
.list-toolbar strong { font-size: 15px; }
.list-toolbar small { color: #8393a7; font-size: 11px; }
.dialogue-list { flex: 1; min-height: 0; overflow: auto; padding: 16px 2px; scrollbar-gutter: stable; }
.dialogue-card { position: relative; border: 1px solid #dce3f2; background: #ffffffeb; border-radius: 9px; margin-bottom: 10px; transition: border-color .15s, box-shadow .15s; }
.dialogue-card:hover { border-color: #b6c9e6; }
.dialogue-card:focus-within { border-color: #8bb5ec; box-shadow: 0 0 0 2px #6ca8ef12; }
.dialogue-row { display: grid; grid-template-columns: 28px minmax(90px, 130px) minmax(80px, 120px) minmax(160px, 1fr) 130px 80px auto; align-items: start; gap: 14px; padding: 12px; }
label { display: block; min-width: 0; color: #8492aa; font-size: 11px; text-align: left; line-height: 1.5; }
input, :deep(textarea), select { box-sizing: border-box; width: 100%; min-width: 0; margin-top: 5px; padding: 6px 8px; border: 1px solid #e0e7f2; border-radius: 5px; color: #334155; background: #f9fbfe; line-height: 22px; font-size: 13px; }
input { height: 36px; }
select { height: 36px; }
.content-field :deep(textarea) { font-size: 14px; background: #fff; }
input:focus-visible, :deep(textarea:focus-visible), select:focus-visible, button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }
.drag-handle { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 0; border: 0; color: #9daec5; background: transparent; cursor: grab; touch-action: none; user-select: none; }
.drag-handle:active { cursor: grabbing; }
.order { font-size: 11px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 17px; }
.delay-input { display: flex; align-items: center; gap: 5px; }
.delay-input input { width: 58px; }
.delay-input > span { margin-top: 5px; }
.card-actions { display: flex; align-items: center; gap: 3px; padding-top: 22px; }
.card-actions button { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 34px; padding: 5px; border-color: transparent; background: transparent; font-size: 12px; white-space: nowrap; }
.details-button.has-details { color: #337ece; }
.details-button.has-details::after { content: ""; width: 4px; height: 4px; margin-left: 3px; background: #5593d6; border-radius: 50%; }
.extra-fields { display: grid; grid-template-columns: minmax(0, 1fr); margin: 0 12px 12px 54px; padding-top: 12px; border-top: 1px dashed #e0e7f2; }
.extra-fields small { margin-left: 8px; color: #9ba8ba; font-size: 10px; }
.drag-source { opacity: .35; }
.is-dragging { cursor: grabbing; }
.drop-before::before, .drop-end { content: ""; position: absolute; height: 3px; background: #659bf0; border-radius: 3px; box-shadow: 0 0 0 2px #dceaff; }
.drop-before::before { left: 0; right: 0; top: -7px; }
.drop-end { position: relative; margin-top: -5px; }
.walk-talk-drag-ghost { position: fixed; z-index: 10000; display: flex; align-items: center; gap: 18px; box-sizing: border-box; padding: 18px 22px; border: 1px solid #8bb5ec; border-radius: 10px; background: #ffffffed; color: #465c80; box-shadow: 0 14px 32px #314e8330; transform: rotate(-.4deg); pointer-events: none; font-size: 13px; text-align: left; }
.walk-talk-drag-ghost strong { flex: 0 0 auto; max-width: 25%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ghost-content { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.list-empty { text-align: center; margin: 60px auto; color: #8090a5; }
.list-empty h3 { color: #536a84; font-size: 17px; }
.list-empty p { margin-bottom: 22px; line-height: 1.7; }
@container (max-width: 940px) {
  .dialogue-row { grid-template-columns: 24px 100px 100px minmax(0, 1fr) auto; gap: 10px 12px; }
  .drag-handle { grid-row: 1 / 3; }
  .talker-field { grid-column: 2; }
  .subtitle-field { grid-column: 3; }
  .content-field { grid-column: 4 / 6; }
  .style-field { grid-column: 2; }
  .delay-field { grid-column: 3; }
  .delay-input { width: 80px; }
  .card-actions { grid-column: 4 / 6; justify-content: flex-end; }
}
@container (max-width: 540px) {
  .dialogue-row { grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .talker-field { grid-column: 2; }
  .subtitle-field { grid-column: 3; }
  .content-field { grid-column: 2 / 4; }
  .drag-handle { grid-row: 1 / 5; }
  .style-field { grid-column: 2; }
  .delay-field { grid-column: 3; }
  .card-actions { grid-column: 2 / 4; justify-content: flex-end; padding-top: 0; }
  .extra-fields { grid-template-columns: minmax(0, 1fr); margin-left: 44px; }
}
@media (prefers-reduced-motion: reduce) { .dialogue-card { transition: none; } }
</style>
