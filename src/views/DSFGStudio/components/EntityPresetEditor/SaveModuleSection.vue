<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import StudioSelectField from "../StudioSelectField.vue";
import { useSaveModules } from "./useSaveModules";
import {
  SAVE_INTEGER_COUNT, SAVE_BIT_COUNT, createSaveModule, createSaveModuleField,
  formatSaveIntegerBinary, getSaveFieldBinary, getSaveFieldBitLength, getSaveFieldCapacity,
  readSaveFieldValue, validateSaveModules, type SaveModule, type SaveModuleField,
} from "./saveModules";
import { importSaveModuleGia, type SaveModuleGiaCandidate } from "./saveModuleGia";

const { customPresets, availablePresets, systemPresets, ready, error, status, retry, flush } = useSaveModules();
const saveStatus = computed(() => status.value.includes("系统") ? "位段说明自动保存到当前工作区" : status.value);
const fileInput = ref<HTMLInputElement>();
const importing = ref(false), importError = ref(""), previewError = ref(""), fileName = ref("");
const candidates = ref<SaveModuleGiaCandidate[]>([]), selectedCandidate = ref("");
const sourceCandidate = computed(() => candidates.value.find(item => item.id === selectedCandidate.value));
const previewValues = ref(Array<number>(SAVE_INTEGER_COUNT).fill(0));
const previewIndex = ref(0), nonzeroOnly = ref(false);
const integerRowsElement = ref<HTMLElement>(), binaryRowsElement = ref<HTMLElement>();
const previewModified = computed(() => previewValues.value.some((value, index) => value !== (sourceCandidate.value?.values[index] ?? 0)));
const nonzeroCount = computed(() => previewValues.value.filter(value => value !== 0).length);
const binaryRows = computed(() => previewValues.value.map((value, index) => ({ value, index, binary: formatSaveIntegerBinary(value) })));
const rows = computed(() => binaryRows.value.filter(row => !nonzeroOnly.value || row.value !== 0 || row.index === previewIndex.value));
const bitColumns = Array.from({ length: 32 }, (_, position) => position);
const systemIds = computed(() => new Set(systemPresets.value.map(module => module.id)));
const entries = computed(() => availablePresets.value.flatMap(module => module.fields.map(field => ({
  key: `${module.id}/${field.id}`, module, field, editable: !systemIds.value.has(module.id),
}))));
function validLocation(field: SaveModuleField) { try { getSaveFieldBitLength(field); return true; } catch { return false; } }
function endBit(field: SaveModuleField) { return field.startBit + field.length - 1; }
function coversInteger(field: SaveModuleField, index: number) { return validLocation(field) && field.startBit < (index + 1) * 32 && endBit(field) >= index * 32; }
const orphanEntries = computed(() => entries.value.filter(entry => !validLocation(entry.field)));
const savedIssues = computed(() => validateSaveModules(availablePresets.value));
const editingKey = ref("");
const editingEntry = computed(() => entries.value.find(entry => entry.key === editingKey.value));
const draft = ref<SaveModuleField>(createSaveModuleField());
const draftTouched = ref(false), selectionAnchor = ref<number | null>(null);
let dragAnchor: number | null = null, dragMoved = false, suppressClick = false;
const draftCapacity = computed(() => { try { return getSaveFieldCapacity(draft.value); } catch { return null; } });
const draftBinary = computed(() => { try { return getSaveFieldBinary(previewValues.value, draft.value); } catch { return ""; } });
const draftValue = computed(() => { try { return readSaveFieldValue(previewValues.value, draft.value); } catch { return null; } });
const draftIssues = computed(() => {
  const moduleId = editingEntry.value?.module.id ?? `draft:${draft.value.id}`;
  const modules = availablePresets.value.map(module => ({ ...module, fields: module.fields.filter(field => `${module.id}/${field.id}` !== editingKey.value) }));
  let target = modules.find(module => module.id === moduleId);
  if (!target) { target = { id: moduleId, name: "", fields: [] }; modules.push(target); }
  target.fields.push(draft.value);
  return validateSaveModules(modules).filter(issue => issue.moduleId === moduleId && issue.fieldId === draft.value.id);
});
const canSave = computed(() => ready.value && draft.value.name.trim() && !draftIssues.value.length && (!editingEntry.value || editingEntry.value.editable));
const causeMessage = (cause: unknown) => cause instanceof Error ? cause.message : "无法读取存档，请检查文件内容。";
const unsignedText = (value: string) => /^\d+$/.test(value);
function compactNumber(value: string) { return value.length > 35 ? `${value.slice(0, 18)}…${value.slice(-10)}` : value; }
function firstFreeBit(start: number) {
  for (let offset = 0; offset < SAVE_BIT_COUNT; offset++) {
    const bit = (start + offset) % SAVE_BIT_COUNT;
    if (!entries.value.some(entry => validLocation(entry.field) && bit >= entry.field.startBit && bit <= endBit(entry.field))) return bit;
  }
  return start;
}
function newSegment() {
  editingKey.value = "";
  draft.value = createSaveModuleField();
  draft.value.startBit = firstFreeBit(previewIndex.value * 32);
  selectionAnchor.value = null; draftTouched.value = false; previewError.value = "";
}
function chooseInteger(index: number) {
  previewIndex.value = index;
  // Browsing another integer never changes the pending global span or its anchor.
  void nextTick(() => {
    const list = integerRowsElement.value;
    const row = list?.querySelector<HTMLElement>(`[data-integer-index="${index}"]`);
    if (list && row && Number.isFinite(row.offsetTop)) list.scrollTop = Math.max(0, row.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
    const canvas = binaryRowsElement.value;
    const binaryRow = canvas?.querySelector<HTMLElement>(`[data-binary-integer="${index}"]`);
    if (canvas && binaryRow && Number.isFinite(binaryRow.offsetTop)) canvas.scrollTop = binaryRow.offsetTop;
  });
}
watch(ready, value => { if (value && !editingKey.value) newSegment(); });
function selectEntry(key: string) {
  const entry = entries.value.find(item => item.key === key);
  if (!entry) return;
  editingKey.value = key; draft.value = { ...entry.field }; selectionAnchor.value = null;
  if (validLocation(entry.field)) chooseInteger(Math.floor(entry.field.startBit / 32));
}
// Other rows can change without replacing the saved contents of the selected row.
watch(() => editingEntry.value ? JSON.stringify(editingEntry.value.field) : "", snapshot => {
  if (snapshot) draft.value = JSON.parse(snapshot) as SaveModuleField;
  else if (editingKey.value) newSegment();
}, { flush: "sync" });
function repairSegment(key: string) {
  selectEntry(key);
  draft.value.startBit = previewIndex.value * 32;
  draft.value.length = Math.min(Number.isInteger(draft.value.length) && draft.value.length > 0 ? draft.value.length : 1, SAVE_BIT_COUNT - draft.value.startBit);
  delete draft.value.legacyLocation;
  draftTouched.value = true;
}
function setSpan(start: number, length: number) {
  const oldCapacity = draftCapacity.value;
  draft.value.startBit = start; draft.value.length = length; draftTouched.value = true;
  const capacity = draftCapacity.value;
  if (capacity !== null) {
    delete draft.value.legacyLocation;
    if (draft.value.max === oldCapacity || (unsignedText(draft.value.max) && BigInt(draft.value.max) > BigInt(capacity))) draft.value.max = capacity;
    if (unsignedText(draft.value.min) && unsignedText(draft.value.max) && BigInt(draft.value.min) > BigInt(draft.value.max)) draft.value.min = "0";
  }
}
function chooseBit(bit: number, event: MouseEvent) {
  if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
  suppressClick = false;
  if (editingEntry.value && !editingEntry.value.editable) return;
  if (selectionAnchor.value === null) { selectionAnchor.value = bit; setSpan(bit, 1); }
  else { setSpan(Math.min(selectionAnchor.value, bit), Math.abs(selectionAnchor.value - bit) + 1); selectionAnchor.value = null; }
}
function startDrag(bit: number, event: PointerEvent) {
  if (event.button !== 0 || (editingEntry.value && !editingEntry.value.editable)) return;
  suppressClick = false; dragAnchor = bit; dragMoved = false;
}
function extendDrag(bit: number) {
  if (dragAnchor === null || dragAnchor === bit) return;
  dragMoved = true; selectionAnchor.value = null;
  setSpan(Math.min(dragAnchor, bit), Math.abs(dragAnchor - bit) + 1);
}
function finishDrag() { if (dragAnchor !== null) { suppressClick = dragMoved; dragAnchor = null; dragMoved = false; } }
function cancelDrag() { dragAnchor = null; dragMoved = false; suppressClick = false; }
onMounted(() => { if (typeof window !== "undefined") { window.addEventListener("pointerup", finishDrag); window.addEventListener("pointercancel", cancelDrag); window.addEventListener("blur", cancelDrag); } });
onBeforeUnmount(() => { if (typeof window !== "undefined") { window.removeEventListener("pointerup", finishDrag); window.removeEventListener("pointercancel", cancelDrag); window.removeEventListener("blur", cancelDrag); } });
function selectedBit(bit: number) { return bit >= draft.value.startBit && bit <= endBit(draft.value); }
function definedBit(bit: number) { return entries.value.some(entry => validLocation(entry.field) && bit >= entry.field.startBit && bit <= endBit(entry.field)); }
function bitTitle(bit: number) { return [`全局位 ${bit} · 整数 [${Math.floor(bit / 32)}] 的第 ${bit % 32} 位（从左数）`, ...entries.value.filter(entry => validLocation(entry.field) && bit >= entry.field.startBit && bit <= endBit(entry.field)).map(entry => entry.field.name)].join(" · "); }
function integerInput(event: Event) { const text = (event.target as HTMLInputElement).value; return text.trim() && Number.isSafeInteger(Number(text)) ? Number(text) : null; }
function updateDecimal(event: Event, commit = false) {
  const value = integerInput(event);
  if (value !== null && value >= -2147483648 && value <= 2147483647) { previewValues.value[previewIndex.value] = value; previewError.value = ""; }
  else if (commit) { previewError.value = "请输入 −2147483648 ～ 2147483647 范围内的十进制整数。"; (event.target as HTMLInputElement).value = String(previewValues.value[previewIndex.value]); }
}
function updatePosition(key: "startBit" | "length", event: Event, commit = false) {
  const value = integerInput(event);
  if (value !== null) { setSpan(key === "startBit" ? value : draft.value.startBit, key === "length" ? value : draft.value.length); selectionAnchor.value = null; }
  else if (commit) (event.target as HTMLInputElement).value = String(draft.value[key]);
}
function updateRange(key: "min" | "max", event: Event, commit = false) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (unsignedText(value)) { draft.value[key] = value; draftTouched.value = true; }
  else if (commit) (event.target as HTMLInputElement).value = draft.value[key];
}
function saveSegment() {
  if (!canSave.value) return;
  let module: SaveModule;
  if (editingEntry.value) { module = editingEntry.value.module; module.fields = module.fields.map(field => field.id === draft.value.id ? { ...draft.value } : field); }
  else {
    module = customPresets.value[0];
    if (!module) { module = createSaveModule(); customPresets.value = [module]; module = customPresets.value[0]; }
    module.fields.push({ ...draft.value });
  }
  editingKey.value = `${module.id}/${draft.value.id}`; selectionAnchor.value = null;
}
function deleteSegment(key: string) { const entry = entries.value.find(item => item.key === key); if (!entry?.editable) return; entry.module.fields = entry.module.fields.filter(field => field.id !== entry.field.id); if (editingKey.value === key) newSegment(); }
function entryBinary(field: SaveModuleField) { try { return getSaveFieldBinary(previewValues.value, field); } catch { return "位区间无效"; } }
function entryValue(field: SaveModuleField) { try { return readSaveFieldValue(previewValues.value, field); } catch { return null; } }
function entryLocation(field: SaveModuleField) {
  if (!validLocation(field)) return "范围无效";
  return `整数 [${Math.floor(field.startBit / 32)}] 第 ${field.startBit % 32} 位 → 整数 [${Math.floor(endBit(field) / 32)}] 第 ${endBit(field) % 32} 位`;
}
function entryIssues(module: SaveModule, field: SaveModuleField) { return savedIssues.value.filter(issue => issue.moduleId === module.id && issue.fieldId === field.id); }
function outOfRange(field: SaveModuleField) { const value = entryValue(field); return value !== null && unsignedText(field.min) && unsignedText(field.max) && (BigInt(value) < BigInt(field.min) || BigInt(value) > BigInt(field.max)); }
function restorePreview() { previewValues.value = sourceCandidate.value ? [...sourceCandidate.value.values] : Array<number>(SAVE_INTEGER_COUNT).fill(0); previewError.value = ""; }
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file || importing.value) return;
  importing.value = true; importError.value = "";
  try {
    const result = await importSaveModuleGia(new Uint8Array(await file.arrayBuffer()));
    candidates.value = result.candidates; selectedCandidate.value = result.candidates[0].id; fileName.value = file.name;
    restorePreview(); chooseInteger(Math.max(0, previewValues.value.findIndex(value => value !== 0)));
    if (!draftTouched.value && !editingEntry.value) newSegment();
  } catch (cause) { importError.value = causeMessage(cause); }
  finally { importing.value = false; input.value = ""; }
}
defineExpose({ flush });
</script>

<template>
  <section class="save-module-section" data-preset-category="saveModules" aria-label="存档模块">
    <header class="source-toolbar"><p role="status">{{ saveStatus }}</p><div class="actions"><input ref="fileInput" type="file" accept=".gia" aria-label="导入存档 GIA 文件" class="file-input" @change="importFile" /><button type="button" class="primary" :disabled="importing" @click="fileInput?.click()">{{ importing ? '读取中…' : '导入存档 GIA' }}</button><button type="button" :disabled="!previewModified" @click="restorePreview">{{ sourceCandidate ? '恢复导入值' : '整数归零' }}</button></div></header>
    <p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="retry().catch(() => undefined)">重试</button></p>
    <p v-if="importError" class="error" role="alert">{{ importError }} 原有整数值已保留。</p>
    <div v-if="candidates.length" class="source-select"><label>存档实例<StudioSelectField v-model="selectedCandidate" aria-label="选择存档实例" @update:model-value="restorePreview"><option v-for="candidate in candidates" :key="candidate.id" :value="candidate.id">{{ candidate.name }}</option></StudioSelectField></label><span class="hint">{{ fileName }} · 100 个整数</span></div>
    <p class="join-hint">[0] → [1] → … → [99]，每项补齐 32 位，共 {{ SAVE_BIT_COUNT }} 位。从左到右编号 0–3199，位段可跨整数。</p>
    <div class="binary-workbench">
      <aside class="integer-list" aria-label="100 个存档整数">
        <header><h3>整数列表 <small>{{ SAVE_INTEGER_COUNT }}</small></h3><label class="nonzero-toggle"><input v-model="nonzeroOnly" type="checkbox" aria-label="只看非零整数" />只看非零</label></header>
        <div ref="integerRowsElement" class="integer-rows"><button v-for="row in rows" :key="row.index" type="button" class="integer-row" :class="{ active: previewIndex === row.index, nonzero: row.value !== 0 }" :aria-label="`整数 ${row.index}，十进制 ${row.value}`" :aria-pressed="previewIndex === row.index" :data-integer-index="row.index" @click="chooseInteger(row.index)"><span class="integer-index">[{{ row.index }}]</span><span class="integer-decimal">{{ row.value }}<small v-if="entries.some(entry => coversInteger(entry.field, row.index))">已定义位段</small></span><code>{{ row.binary }}</code></button></div>
        <p class="list-footnote">下标 0–99 · {{ nonzeroCount }} 项非零</p>
      </aside>
      <div class="integer-workbench">
        <section class="binary-card" aria-labelledby="binary-integer-title">
          <header><h3 id="binary-integer-title">拼接后的二进制串</h3><label class="decimal-input">整数 [{{ previewIndex }}] 十进制<input :value="previewValues[previewIndex]" type="number" step="1" min="-2147483648" max="2147483647" aria-label="十进制整数" @input="updateDecimal($event)" @change="updateDecimal($event, true)" /></label></header>
          <div ref="binaryRowsElement" class="binary-rows" role="region" aria-label="3200 位连续二进制串">
            <div v-for="row in binaryRows" :key="row.index" class="binary-integer-row" :class="{ active: previewIndex === row.index }" :data-binary-integer="row.index">
              <div class="binary-row-label"><button type="button" :aria-label="`查看整数 ${row.index}`" @click="chooseInteger(row.index)">整数 [{{ row.index }}] = {{ row.value }}</button><span>全局位 {{ row.index * 32 }}–{{ row.index * 32 + 31 }}</span></div>
              <div class="bit-string" :aria-label="`整数 ${row.index} 的 32 位二进制`"><button v-for="position in bitColumns" :key="position" type="button" class="bit" :class="{ selected: selectedBit(row.index * 32 + position), defined: definedBit(row.index * 32 + position), 'byte-end': position % 8 === 7 }" :aria-label="`位 ${row.index * 32 + position}`" :aria-pressed="selectedBit(row.index * 32 + position)" :title="bitTitle(row.index * 32 + position)" :data-bit="row.index * 32 + position" :data-selected="selectedBit(row.index * 32 + position)" :disabled="!ready || (!!editingEntry && !editingEntry.editable)" @click="chooseBit(row.index * 32 + position, $event)" @pointerdown="startDrag(row.index * 32 + position, $event)" @pointerenter="extendDrag(row.index * 32 + position)"><span class="bit-index" aria-hidden="true">{{ row.index * 32 + position }}</span><span>{{ row.binary[position] }}</span></button></div>
            </div>
          </div>
          <p class="hint selection-hint">{{ selectionAnchor !== null ? `已选全局位 ${selectionAnchor}，再点另一个端点，可跨整数。` : '点选两个端点或拖选一段，换行处也连续。滚动可查看全部 100 项。' }}</p>
          <p v-if="previewError" class="error" role="alert">{{ previewError }}</p>
          <section class="segment-editor" aria-labelledby="segment-editor-title">
            <header><h3 id="segment-editor-title">{{ editingEntry ? '编辑位段说明' : '为选中的位段添加说明' }}</h3><button type="button" :disabled="!ready" @click="newSegment">新建位段</button></header>
            <div class="span-inputs"><label>全局起始位<input :value="draft.startBit" type="number" min="0" :max="SAVE_BIT_COUNT - 1" step="1" aria-label="起始位" :disabled="!ready || (!!editingEntry && !editingEntry.editable)" @input="updatePosition('startBit', $event)" @change="updatePosition('startBit', $event, true)" /></label><label>长度（位）<input :value="draft.length" type="number" min="1" :max="SAVE_BIT_COUNT" step="1" aria-label="位段长度" :disabled="!ready || (!!editingEntry && !editingEntry.editable)" @input="updatePosition('length', $event)" @change="updatePosition('length', $event, true)" /></label><div class="span-location">全局 {{ draft.startBit }}–{{ endBit(draft) }}<small v-if="validLocation(draft)">跨 {{ Math.floor(endBit(draft) / 32) - Math.floor(draft.startBit / 32) + 1 }} 个整数</small><small v-else>范围需在 0–3199 内</small></div></div>
            <p class="hint">{{ entryLocation(draft) }}（每项从左数，0 起始）</p>
            <div class="selected-span"><span>选中位段</span><code role="status" aria-label="选中位段二进制">{{ draftBinary || '—' }}</code><span class="selected-value">= {{ draftValue ?? '—' }}</span></div>
            <label class="description-input">说明字符串<input v-model="draft.name" type="text" aria-label="位段说明" :disabled="!ready || (!!editingEntry && !editingEntry.editable)" placeholder="例如：跨整数保存的任务进度" @input="draftTouched = true" /></label>
            <details class="range-settings"><summary :title="draftCapacity ?? ''">数值范围{{ draftCapacity !== null ? ` · 可存 0–${compactNumber(draftCapacity)}` : '' }}</summary><div class="range-inputs"><label>最小值<input :value="draft.min" type="text" inputmode="numeric" aria-label="位段最小值" :disabled="!ready || (!!editingEntry && !editingEntry.editable)" @input="updateRange('min', $event)" @change="updateRange('min', $event, true)" /></label><label>最大值<input :value="draft.max" type="text" inputmode="numeric" aria-label="位段最大值" :disabled="!ready || (!!editingEntry && !editingEntry.editable)" @input="updateRange('max', $event)" @change="updateRange('max', $event, true)" /></label></div></details>
            <ul v-if="draftIssues.length" class="error field-errors" role="alert"><li v-for="issue in draftIssues" :key="issue.message">{{ issue.message }}</li></ul>
            <footer><button type="button" class="primary" :disabled="!canSave" @click="saveSegment">保存位段</button></footer>
          </section>
        </section>
        <section class="saved-spans" aria-labelledby="saved-spans-title">
          <header><h3 id="saved-spans-title">已保存的位段说明</h3><span class="hint">{{ entries.length }} 段 · 共用整条二进制串</span></header>
          <p v-if="!entries.length" class="hint">选择起始位和长度，为这一段填写说明字符串。</p>
          <div v-for="entry in entries.filter(item => validLocation(item.field))" :key="entry.key" class="saved-span" :class="{ active: editingKey === entry.key }" :data-field-id="entry.field.id"><button type="button" class="saved-span-content" :aria-label="`查看位段 ${entry.field.name || '未命名位段'}`" @click="selectEntry(entry.key)"><strong>{{ entry.field.name || '未命名位段' }}</strong><span class="hint">全局 {{ entry.field.startBit }}–{{ endBit(entry.field) }} · {{ entry.field.length }} 位 · {{ entryLocation(entry.field) }}</span><span class="span-value"><code>{{ entryBinary(entry.field) }}</code><span>= {{ entryValue(entry.field) ?? '—' }}</span></span></button><button v-if="entry.editable" type="button" class="delete" :disabled="!ready" :aria-label="`删除位段 ${entry.field.name || '未命名位段'}`" @click="deleteSegment(entry.key)">删除</button><p v-if="outOfRange(entry.field)" class="error">值 {{ entryValue(entry.field) }} 超出范围 {{ entry.field.min }}–{{ entry.field.max }}</p><p v-for="issue in entryIssues(entry.module, entry.field)" :key="issue.message" class="error">{{ issue.message }}</p></div>
        </section>
        <section v-if="orphanEntries.length" class="saved-spans" aria-label="范围无效的位段"><p class="error" role="alert">这些旧位段的范围无效，可以从当前整数开始修正，或删除。</p><div v-for="entry in orphanEntries" :key="entry.key" class="saved-span" :data-field-id="entry.field.id"><div><strong>{{ entry.field.name || '未命名位段' }}</strong><p class="error">起始位 {{ entry.field.startBit }} · 长度 {{ entry.field.length }}</p><p v-if="entry.field.legacyLocation" class="hint">旧定义：整数 {{ entry.field.legacyLocation.integerIndex }}，bit {{ entry.field.legacyLocation.startBit }}–{{ entry.field.legacyLocation.endBit }}</p><button type="button" :disabled="!ready || !entry.editable" :aria-label="`修正位段 ${entry.field.name || '未命名位段'}`" @click="repairSegment(entry.key)">从整数 [{{ previewIndex }}] 开始修正</button></div><button v-if="entry.editable" type="button" class="delete" :disabled="!ready" :aria-label="`删除位段 ${entry.field.name || '未命名位段'}`" @click="deleteSegment(entry.key)">删除</button></div></section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.save-module-section { color: #405477; min-width: 0; padding: 4px 8px 22px; container: save-module / inline-size; }
header, .actions { display: flex; align-items: center; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; }
.source-toolbar { margin-bottom: 14px; } h3 { margin: 0; font-size: 14px; font-weight: 600; } p { margin: 5px 0; font-size: 12px; line-height: 1.7; } .hint, small { color: #8290ad; font-size: 11px; font-weight: 400; } .error { color: #aa4055; }
button { min-height: 32px; padding: 6px 11px; border: 1px solid #d6dbf5; border-radius: 6px; background: #ffffffc9; color: #6554c9; font: inherit; font-size: 12px; cursor: pointer; }
button.primary { border-color: #078cff; background: linear-gradient(110deg, #1683ff, #00a7f2); color: #fff; } button:disabled { opacity: .5; cursor: default; } button.delete { color: #a4676c; border-color: #eadcdf; background: #fff; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid #5aaeff; outline-offset: 2px; }
label { display: grid; gap: 6px; min-width: 0; color: #64748b; font-size: 12px; } input { box-sizing: border-box; width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid #d6dbf5; border-radius: 6px; background: #f8faff; color: #405477; font: inherit; font-size: 13px; } .file-input { display: none; }
.source-select { display: flex; gap: 14px; flex-wrap: wrap; align-items: end; margin-bottom: 12px; } .source-select label { flex: 1 1 280px; max-width: 600px; } .source-select > span { flex: 1 1 200px; padding-bottom: 8px; overflow-wrap: anywhere; } .join-hint { margin-bottom: 14px; color: #64748b; }
.binary-workbench { display: grid; grid-template-columns: 260px minmax(0, 1fr); align-items: start; gap: 16px; min-width: 0; }
.integer-list, .binary-card, .saved-spans { min-width: 0; padding: 16px; border: 1px solid #d6dbf5; border-radius: 9px; background: #ffffffeb; }
.integer-list { position: sticky; top: 0; padding: 12px 0 0; overflow: hidden; } .integer-list > header { padding: 0 12px 10px; } .integer-list h3 small { margin-left: 6px; } .nonzero-toggle { display: flex; gap: 5px; align-items: center; font-size: 11px; } .nonzero-toggle input { width: 13px; height: 13px; accent-color: #1683ff; }
.integer-rows { position: relative; max-height: 470px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #cdd6e5 transparent; } .integer-row { display: grid; grid-template-columns: 35px minmax(0, 1fr); gap: 4px; width: 100%; text-align: left; padding: 10px 12px; border: 0; border-bottom: 1px solid #edf0f8; border-radius: 0; color: #64748b; background: transparent; } .integer-row.active { background: #eaf3ff; box-shadow: inset 3px 0 #1683ff; } .integer-row.nonzero .integer-decimal { color: #245aa2; } .integer-index { color: #94a0b1; font-size: 11px; } .integer-decimal { display: flex; justify-content: space-between; gap: 6px; color: #405477; font-size: 12px; } .integer-decimal small { font-size: 10px; } .integer-row > code { grid-column: 1 / -1; font-size: 10px; letter-spacing: .4px; color: #8290ad; } .list-footnote { padding: 8px 12px; margin: 0; border-top: 1px solid #e3e7f7; color: #8290ad; font-size: 11px; }
.integer-workbench { display: grid; gap: 14px; min-width: 0; } .binary-card { border-top: 3px solid #36c4df; } .decimal-input { display: flex; align-items: center; gap: 8px; width: 280px; white-space: nowrap; }
.binary-rows { position: relative; max-height: 220px; overflow: auto; margin-top: 14px; border: 1px solid #e3e7f7; border-radius: 6px; scrollbar-width: thin; } .binary-integer-row { min-width: 576px; padding: 8px; border-bottom: 1px solid #e3e7f7; } .binary-integer-row:last-child { border-bottom: 0; } .binary-integer-row.active { background: #f3f8ff; } .binary-row-label { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 5px; color: #8290ad; font-size: 10px; } .binary-row-label button { min-height: 20px; padding: 0; background: transparent; border: 0; color: #526987; font-size: 11px; }
.bit-string { display: grid; grid-template-columns: repeat(32, minmax(18px, 1fr)); user-select: none; touch-action: pan-y; gap: 1px; } button.bit { display: grid; gap: 3px; justify-items: center; min-height: 43px; padding: 3px 0 5px; border-radius: 3px; border-color: transparent; color: #526987; background: #f1f4fb; font-family: ui-monospace, Consolas, monospace; font-size: 15px; } button.bit .bit-index { color: #94a0b1; font-size: 8px; letter-spacing: -.4px; } button.bit.defined { box-shadow: inset 0 -3px #70c2b0; } button.bit.selected { border-color: #b3d4ff; color: #1864b8; background: #dcecff; } button.bit.byte-end:not(:last-child) { margin-right: 3px; } .selection-hint { margin-top: 8px; }
.segment-editor { padding-top: 12px; margin-top: 12px; border-top: 1px solid #e3e7f7; } .span-inputs { display: grid; grid-template-columns: minmax(70px, 1fr) minmax(90px, 1fr) minmax(90px, 1fr); gap: 12px; margin: 12px 0 10px; } .span-location { display: grid; align-content: end; gap: 5px; padding-bottom: 6px; color: #315f98; font-size: 12px; } .selected-span { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 8px 12px; border-radius: 6px; background: #edf4fd; font-size: 12px; max-height: 140px; overflow: auto; } .selected-span code { overflow-wrap: anywhere; word-break: break-all; font-size: 14px; color: #1864b8; } .selected-value { overflow-wrap: anywhere; } .description-input { margin: 12px 0 10px; } .range-settings { color: #8290ad; font-size: 11px; } summary { cursor: pointer; overflow-wrap: anywhere; } .range-inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 10px 0; } .field-errors { font-size: 12px; padding-left: 18px; line-height: 1.7; } footer { display: flex; justify-content: end; gap: 10px; margin-top: 12px; }
.saved-spans > header { margin-bottom: 12px; } .saved-span { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 6px 12px; border: 1px solid #e0e7f2; border-radius: 7px; padding: 10px; margin-top: 8px; } .saved-span.active { border-color: #a6caf5; background: #f3f8ff; } .saved-span-content { display: grid; gap: 6px; text-align: left; border: 0; padding: 0; background: transparent; color: #405477; } .saved-span-content strong { overflow-wrap: anywhere; font-size: 13px; font-weight: 500; } .span-value { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; overflow-wrap: anywhere; font-size: 12px; max-height: 110px; overflow: auto; } .span-value code { word-break: break-all; } .saved-span > p { grid-column: 1 / -1; }
@media (max-width: 1120px) { .binary-workbench { grid-template-columns: 230px minmax(0, 1fr); } .integer-row > code { letter-spacing: 0; } }
@media (max-width: 950px) { .binary-workbench { grid-template-columns: minmax(0, 1fr); } .integer-list { position: static; } .integer-rows { max-height: 190px; } }
@container save-module (max-width: 900px) { .binary-workbench { grid-template-columns: minmax(0, 1fr); } .integer-list { position: static; } .integer-rows { max-height: 140px; } }
@media (max-width: 760px) { .save-module-section { padding: 0 0 14px; } .binary-card, .saved-spans { padding: 14px; } .span-inputs { grid-template-columns: repeat(2, minmax(0, 1fr)); } .span-location { grid-column: 1 / -1; } .decimal-input { width: 260px; } }
</style>
