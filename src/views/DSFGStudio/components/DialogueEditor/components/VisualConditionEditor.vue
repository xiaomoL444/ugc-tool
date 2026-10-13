<script setup lang="ts">
import { computed, ref } from "vue";
import { NModal } from "naive-ui";
import { createConditionGroup, type VisualCondition } from "../types/VisualCondition";
import { parseVisualCondition, serializeVisualCondition } from "../utils/visualCondition";
import ConditionTreeEditor from "./ConditionTreeEditor.vue";
const props = defineProps<{ modelValue: string; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const show = ref(false);
const mode = ref<"visual" | "source">("visual");
const draft = ref<VisualCondition>(createConditionGroup());
const source = ref("");
const original = ref("");
const notice = ref("");
const generated = computed(() => {
  try { return { text: serializeVisualCondition(draft.value), error: "" }; }
  catch (error) { return { text: "", error: error instanceof Error ? error.message : "条件配置不完整。" }; }
});
function open() {
  source.value = original.value = props.modelValue;
  const parsed = parseVisualCondition(source.value);
  draft.value = parsed ?? createConditionGroup();
  mode.value = !source.value.trim() || parsed ? "visual" : "source";
  notice.value = mode.value === "source" ? "这条表达式包含可视化编辑暂不支持的语法，原文已保留，可继续编辑原文。" : "";
  show.value = true;
}
function changeMode(next: "visual" | "source") {
  if (mode.value === next) return;
  if (next === "source") {
    if (generated.value.error) { notice.value = generated.value.error; return; }
    source.value = generated.value.text;
  } else {
    const parsed = parseVisualCondition(source.value);
    if (source.value.trim() && !parsed) { notice.value = "当前原文无法转换。可以继续编辑原文，或点击“重新搭建条件”替换草稿。"; return; }
    draft.value = parsed ?? createConditionGroup();
  }
  notice.value = ""; mode.value = next;
}
function rebuild() { draft.value = createConditionGroup(); mode.value = "visual"; notice.value = "正在重新搭建，点击保存后才会替换原条件；取消可保留原文。"; }
function save() {
  if (props.modelValue !== original.value) { notice.value = "原条件已在其他位置更新，请关闭后重新打开，避免覆盖。"; return; }
  if (mode.value === "visual" && generated.value.error) return;
  emit("update:modelValue", mode.value === "visual" ? generated.value.text : source.value);
  show.value = false;
}
</script>
<template>
  <div class="condition-summary"><span>{{ modelValue || '尚未设置条件' }}</span><button type="button" :aria-label="`编辑${label}条件`" @click.stop="open">编辑条件</button></div>
  <NModal v-model:show="show" preset="card" class="condition-editor-modal dsfg-typography" :title="`${label} · 条件编辑`"
    :style="{ width: 'min(900px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 48px)', borderRadius: '14px' }"
    :header-style="{ flexShrink: '0', padding: '18px 20px', fontSize: '16px', fontWeight: '600', color: '#33476b' }"
    :content-style="{ minHeight: '0', overflowY: 'auto', padding: '0 20px 18px' }"
    :footer-style="{ flexShrink: '0', padding: '14px 20px', borderTop: '1px solid #d8deec' }" :mask-closable="false">
    <div class="visual-condition-editor" @keydown.stop @keyup.stop @pointerdown.stop>
      <div class="mode-tabs" role="group" aria-label="条件编辑模式">
        <button type="button" :aria-pressed="mode === 'visual'" @click="changeMode('visual')">可视化条件</button>
        <button type="button" :aria-pressed="mode === 'source'" @click="changeMode('source')">表达式原文</button>
      </div>
      <details class="condition-help">
        <summary>条件与变量填写说明</summary>
        <p class="hint">左值与右值都可选择变量或固定值。“且”要求全部满足，“或”要求任一满足；括号组内先组合，再与外层组合。</p>
        <p class="hint">玩家与角色指当前客户端自身。变量路径支持“背包.金币”“奖励.1.数量”，列表从 1 开始。</p>
      </details>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <template v-if="mode === 'visual'">
        <ConditionTreeEditor v-model="draft" />
        <p v-if="generated.error" class="error" role="alert">{{ generated.error }}</p>
        <details v-else class="expression-preview"><summary>生成的表达式</summary><pre>{{ generated.text }}</pre></details>
      </template>
      <template v-else>
        <label class="source-field">表达式原文<textarea v-model="source" aria-label="条件表达式原文" rows="6" spellcheck="false" /></label>
        <p class="hint">原文按输入保存，不在网页中执行；复杂运算、逻辑非和动态变量路径可在这里保留。</p>
        <button type="button" @click="rebuild">重新搭建条件</button>
      </template>
    </div>
    <template #footer>
      <footer class="condition-editor-actions" @keydown.stop @keyup.stop @pointerdown.stop><button type="button" @click="show = false">取消</button><button class="save" type="button" :disabled="mode === 'visual' && !!generated.error" @click="save">保存条件</button></footer>
    </template>
  </NModal>
</template>
<style scoped>
.condition-summary { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0; }
.condition-summary span { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 12px; line-height: 1.7; }
button { cursor: pointer; border: 1px solid #d4c7e2; border-radius: 6px; padding: 7px 10px; color: #71528e; background: #f8f4fc; font: inherit; font-size: 12px; }
.condition-summary button { flex-shrink: 0; }
.visual-condition-editor { color: #34435b; font-size: 12px; text-align: left; }
.mode-tabs { display: flex; gap: 8px; } .mode-tabs button[aria-pressed="true"] { color: #fff; background: #8260a5; }
.condition-help { margin: 14px 0; color: #52627b; line-height: 1.7; }
.condition-help summary, .expression-preview summary { cursor: pointer; }
.hint { color: #52627b; line-height: 1.7; } .notice { padding: 10px; background: #fff6e5; color: #896533; border-radius: 6px; }
.error { color: #b04d65; } .source-field { display: grid; gap: 8px; }
textarea { box-sizing: border-box; width: 100%; padding: 12px; border: 1px solid #d6dce8; border-radius: 7px; font: inherit; resize: vertical; color: #34435b; background: #fff; }
.expression-preview { margin-top: 16px; color: #52627b; } pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px; background: #f4f6fa; }
.condition-editor-actions { display: flex; justify-content: flex-end; gap: 10px; } .save { background: #8260a5; color: white; } button:disabled { opacity: .45; cursor: default; }
button:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid #7562b9; outline-offset: 2px; }
</style>
