<template>
  <section ref="panel" class="editor-history-panel" role="dialog" aria-label="操作记录" tabindex="-1" @pointerdown.stop @click.stop @keydown.stop="handleKeydown">
    <header class="history-heading">
      <h3>操作记录</h3>
      <button type="button" class="history-close" aria-label="关闭操作记录" title="关闭" @click="emit('close')">×</button>
    </header>
    <div class="history-actions">
      <button type="button" :disabled="busy || !canUndo" @click="emit('undo')">↶ 撤销 <kbd>Ctrl Z</kbd></button>
      <button type="button" :disabled="busy || !canRedo" @click="emit('redo')">↷ 重做 <kbd>Ctrl Y</kbd></button>
    </div>
    <p class="history-hint">当前文件最近 100 步；刷新或切换文件后清空。一次拖动记一步。</p>
    <ol v-if="entries.length" class="history-list" aria-label="编辑行为列表" reversed>
      <li v-for="item in visibleEntries" :key="item.entry.id" :class="{ 'is-undone': item.position > index, 'is-current': item.position === index }" :aria-current="item.position === index ? 'step' : undefined">
        <span class="history-number" aria-hidden="true">{{ item.position + 1 }}</span>
        <span class="history-label" :title="item.entry.label">{{ item.entry.label }}</span>
        <span class="history-status">{{ item.position === index ? '当前步骤' : item.position > index ? '已撤销' : '已执行' }}</span>
      </li>
    </ol>
    <p v-else class="history-empty">暂无操作记录<br /><span>修改控件或 Clip 后，可在这里撤销和重做。</span></p>
    <p v-if="entries.length && index < 0" class="history-initial">已回到本次记录的初始状态</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps<{
  entries: Array<{ id: string; label: string }>;
  /** 当前已执行行为的索引；-1 表示全部撤销。列表不包含初始快照。 */
  index: number;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
}>();
const emit = defineEmits<{
  (event: "undo"): void;
  (event: "redo"): void;
  (event: "close"): void;
}>();
const panel = ref<HTMLElement | null>(null);
const visibleEntries = computed(() => props.entries.map((entry, position) => ({ entry, position })).reverse());
let previousFocus: HTMLElement | null = null;

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  panel.value?.focus({ preventScroll: true });
});
onBeforeUnmount(() => {
  // 若用户已点击别处，则不要将焦点抢回工具栏。
  if (panel.value?.contains(document.activeElement) && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
});
</script>

<style scoped>
.editor-history-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 120;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 32px));
  max-height: min(500px, calc(100vh - 120px));
  padding: 13px;
  border: 1px solid #465269;
  border-radius: 8px;
  background: #272f3e;
  box-shadow: 0 12px 36px #0007;
  color: #e5eaf3;
  font-family: "StarRailFont", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  color-scheme: dark;
  outline: none;
}
.history-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.history-heading h3 { margin: 0; font-size: 14px; font-weight: 600; }
.editor-history-panel button { box-sizing: border-box; border: 1px solid #48546a; border-radius: 4px; background: #323e52; color: inherit; font-family: inherit; font-size: 12px; line-height: 1.5; cursor: pointer; }
.editor-history-panel button:hover:not(:disabled) { border-color: #8ca8ef; background: #405171; }
.editor-history-panel button:focus-visible { outline: 2px solid #9eb8fa; outline-offset: 2px; }
.editor-history-panel button:disabled { opacity: 0.4; cursor: not-allowed; }
.editor-history-panel .history-close { flex: 0 0 26px; width: 26px; height: 26px; padding: 0; border: 0; background: transparent; font-size: 22px; }
.history-actions { display: flex; gap: 8px; margin-top: 12px; }
.history-actions button { flex: 1; padding: 7px 8px; }
.history-actions kbd { margin-left: 7px; color: #a7b5cd; font-family: inherit; font-size: 10px; }
.history-hint { margin: 10px 0; color: #a9b6ca; font-size: 11px; }
.history-list { min-height: 0; margin: 0; padding: 0; overflow-y: auto; list-style: none; }
.history-list li { display: flex; align-items: center; gap: 8px; padding: 9px 7px; border-top: 1px solid #414b5d; border-left: 2px solid transparent; }
.history-list .is-current { border-left-color: #89a9ff; background: #3b4d6a; }
.history-list .is-undone { color: #98a3b5; }
.history-list .is-undone .history-label { text-decoration: line-through; text-decoration-color: #798496; }
.history-number { flex: 0 0 22px; color: #8d9bb2; text-align: right; font-variant-numeric: tabular-nums; }
.history-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-status { flex: 0 0 auto; color: #a8b5cd; font-size: 10px; }
.is-current .history-status { color: #b6cdff; }
.history-empty { margin: 25px 0; color: #c9d2e1; text-align: center; }
.history-empty span { display: inline-block; margin-top: 7px; color: #96a4b9; font-size: 11px; }
.history-initial { margin: 10px 0 0; color: #b6cdff; font-size: 11px; }
</style>
