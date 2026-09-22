<script setup lang="ts">
import { computed } from "vue";
import { createCustomTable, createCustomField, createCustomRecord, mergeCustomPresets, type CustomPresetTable } from "./customPresets";
import { PUBLIC_EVENT_PARAM_TYPES } from "./publicEventPresets";
const props = defineProps<{ presets: CustomPresetTable[]; systemPresets: readonly CustomPresetTable[]; ready: boolean; status: string; error: string }>();
const emit = defineEmits<{ retry: [] }>();
const customTables = computed(() => props.presets.filter(table => !props.systemPresets.some(base => base.id === table.extends)));
const mergedSystem = computed(() => mergeCustomPresets(props.systemPresets, props.presets).slice(0, props.systemPresets.length));
function extension(table: CustomPresetTable) { return props.presets.find(item => item.extends === table.id); }
function ensureExtension(table: CustomPresetTable) {
  let item = extension(table);
  if (!item) {
    props.presets.push({ ...createCustomTable(), name: table.name, extends: table.id });
    item = extension(table)!;
  }
  return item;
}
function isSystemField(table: CustomPresetTable, id: string) { return props.systemPresets.find(base => base.id === table.id)?.fields.some(field => field.id === id); }
function isSystemRow(table: CustomPresetTable, id: string) { return props.systemPresets.find(base => base.id === table.id)?.records.some(row => row.id === id); }
function setCell(table: CustomPresetTable, rowId: string, fieldId: string, event: Event) {
  if (isSystemRow(table, rowId) && isSystemField(table, fieldId)) return;
  const extra = ensureExtension(table);
  let row = extra.records.find(item => item.id === rowId);
  if (!row) {
    extra.records.push({ id: rowId, name: table.records.find(item => item.id === rowId)?.name ?? "", values: {} });
    row = extra.records.find(item => item.id === rowId)!;
  }
  row.values[fieldId] = (event.target as HTMLInputElement).value;
}
function renameRow(table: CustomPresetTable, rowId: string, event: Event) {
  const row = extension(table)?.records.find(item => item.id === rowId);
  if (row && !isSystemRow(table, rowId)) row.name = (event.target as HTMLInputElement).value;
}
function deleteRow(table: CustomPresetTable, rowId: string) {
  const extra = extension(table);
  if (extra && !isSystemRow(table, rowId)) extra.records = extra.records.filter(row => row.id !== rowId);
}
function deleteTable(table: CustomPresetTable) { props.presets.splice(props.presets.indexOf(table), 1); }
function removeField(table: CustomPresetTable, id: string) {
  table.fields = table.fields.filter(field => field.id !== id);
  for (const record of table.records) delete record.values[id];
}
</script>
<template>
  <section class="custom-section">
    <header><div><h3>自定义配置</h3><p>先定义字段，再添加记录。公共事件可引用任意一个字段作为参数来源。</p></div><button :disabled="!ready" @click="presets.push(createCustomTable())">＋ 新建配置类别</button></header>
    <p class="muted" role="status">{{ status }}</p>
    <p v-if="error" role="alert">{{ error }} <button @click="emit('retry')">重试</button></p>
    <h4>系统配置类别</h4>
    <p v-if="!systemPresets.length" class="muted">暂无系统配置。</p>
    <article v-for="table in mergedSystem" :key="table.id">
      <h4>{{ table.name }}</h4>
      <h4>系统字段 · 只读</h4>
      <div class="fields"><div v-for="field in table.fields.filter(item => isSystemField(table, item.id))" :key="field.id" class="field-row"><span>{{ field.name || '未命名字段' }}</span><span class="muted">{{ PUBLIC_EVENT_PARAM_TYPES.find(type => type.value === field.type)?.label }}</span></div></div>
      <div class="subhead"><h4>自定义字段</h4><button :disabled="!ready" @click="ensureExtension(table).fields.push(createCustomField())">＋ 添加自定义字段</button></div>
      <div class="fields"><div v-for="field in extension(table)?.fields.filter(item => !isSystemField(table, item.id)) || []" :key="field.id" class="field-row"><label>字段名称<input v-model="field.name" aria-label="自定义字段名称" /></label><label>数据类型<select v-model="field.type" aria-label="自定义字段类型"><option v-for="type in PUBLIC_EVENT_PARAM_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option></select></label><button class="delete" @click="removeField(ensureExtension(table), field.id)">删除字段</button></div></div>
      <div class="subhead"><h4>配置记录</h4><button :disabled="!ready || !table.fields.length" @click="ensureExtension(table).records.push(createCustomRecord())">＋ 添加自定义记录</button></div>
      <p class="muted">系统记录的名称和系统字段值只读；新增字段的值可以填写。自定义记录可编辑全部字段。</p>
      <div class="table-scroll"><table><thead><tr><th>记录名称</th><th v-for="field in table.fields" :key="field.id">{{ field.name || '未命名字段' }}<small>{{ isSystemField(table, field.id) ? '系统字段' : '自定义字段' }}</small></th><th>操作</th></tr></thead><tbody><tr v-for="row in table.records" :key="row.id"><td><template v-if="isSystemRow(table, row.id)">{{ row.name }}<small>系统记录</small></template><input v-else :value="row.name" aria-label="记录名称" @input="renameRow(table, row.id, $event)" /></td><td v-for="field in table.fields" :key="field.id"><span v-if="isSystemRow(table, row.id) && isSystemField(table, field.id)">{{ row.values[field.id] }}</span><input v-else :disabled="!ready" :value="row.values[field.id] || ''" :aria-label="field.name || '字段值'" :inputmode="field.type === 'String' ? 'text' : 'numeric'" @input="setCell(table, row.id, field.id, $event)" /></td><td><button v-if="!isSystemRow(table, row.id)" class="delete" @click="deleteRow(table, row.id)">删除</button></td></tr></tbody></table></div>
    </article>
    <h4>自定义配置类别</h4>
    <div v-if="ready && !customTables.length" class="empty">例如创建「角色配置」，添加 GUID、技能 ID、称号等字段，再录入每个角色的数据。</div>
    <article v-for="table in customTables" :key="table.id">
      <p v-if="table.extends" class="muted">原系统类别已移除，已保留此类别的自定义字段和记录。</p>
      <header><label class="table-name">配置类别名称<input v-model="table.name" placeholder="例如：角色配置" aria-label="配置类别名称" /></label><span class="muted">{{ table.fields.length }} 个字段 · {{ table.records.length }} 条记录</span><button class="delete" @click="deleteTable(table)">删除类别</button></header>
      <div class="subhead"><h4>字段定义</h4><button @click="table.fields.push(createCustomField())">＋ 添加字段</button></div>
      <div class="fields">
        <div v-for="field in table.fields" :key="field.id" class="field-row"><label>字段名称<input v-model="field.name" placeholder="例如：角色 GUID" aria-label="字段名称" /></label><label>数据类型<select v-model="field.type" aria-label="字段类型"><option v-for="type in PUBLIC_EVENT_PARAM_TYPES" :key="type.value" :value="type.value">{{ type.label }}</option></select></label><button class="delete" @click="removeField(table, field.id)">删除字段</button></div>
      </div>
      <div class="subhead"><h4>配置记录</h4><button :disabled="!table.fields.length" @click="table.records.push(createCustomRecord())">＋ 添加记录</button></div>
      <p v-if="!table.fields.length" class="muted">添加字段后即可录入记录。</p>
      <div v-else class="table-scroll"><table><thead><tr><th>记录名称</th><th v-for="field in table.fields" :key="field.id">{{ field.name || '未命名字段' }}<small>{{ PUBLIC_EVENT_PARAM_TYPES.find(type => type.value === field.type)?.label }}</small></th><th>操作</th></tr></thead><tbody><tr v-for="(row, rowIndex) in table.records" :key="row.id"><td><input v-model="row.name" aria-label="记录名称" placeholder="显示在下拉列表中的名称" /></td><td v-for="field in table.fields" :key="field.id"><input v-model="row.values[field.id]" :aria-label="field.name || '字段值'" :inputmode="field.type === 'String' ? 'text' : 'numeric'" placeholder="输入值" /></td><td><button class="delete" @click="table.records.splice(rowIndex, 1)">删除</button></td></tr></tbody></table></div>
    </article>
  </section>
</template>
<style scoped>
.custom-section { padding:24px; background:#fff; border:1px solid #dbe4ef; border-radius:12px; }
header,.subhead { display:flex; align-items:center; justify-content:space-between; gap:16px; flex-wrap:wrap; } h3,h4 { margin:0; } h4 { margin:18px 0 12px; } p { font-size:13px; line-height:1.7; } .muted,small { color:#7c899c; font-size:12px; } small { display:block; font-weight:normal; margin-top:4px; }
article { margin-top:16px; padding:20px; border:1px solid #dbe4ef; border-radius:10px; } article>header { border-bottom:1px solid #e8edf4; padding-bottom:16px; } .table-name { flex:1; min-width:180px; } label { display:grid; gap:6px; font-size:12px; color:#64748b; } .fields { display:grid; gap:10px; } .field-row { display:grid; grid-template-columns:minmax(150px,1fr) minmax(130px,200px) auto; gap:12px; align-items:end; }
input,select { box-sizing:border-box; width:100%; min-width:0; padding:9px 10px; border:1px solid #d4deeb; border-radius:6px; color:#334158; background:#fafcff; font:inherit; } input:focus,select:focus { outline:2px solid #b4d0f4; } button { cursor:pointer; white-space:nowrap; border:1px solid #bed0e5; border-radius:6px; padding:8px 12px; color:#315f98; background:#edf4fd; font-size:12px; } button:disabled { opacity:.4; cursor:default; } .delete { color:#a4676c; background:white; border-color:#eadcdf; }
.table-scroll { overflow:auto; } table { width:100%; border-collapse:collapse; text-align:left; font-size:13px; } th { color:#64748b; font-weight:500; background:#f5f8fc; } th,td { padding:10px; border-bottom:1px solid #e8edf4; min-width:160px; } th:last-child,td:last-child { min-width:60px; } .empty { padding:32px; border:1px dashed #cedbea; border-radius:10px; color:#8491a3; font-size:13px; }
@media(max-width:760px) { .custom-section,article { padding:14px; } .field-row { grid-template-columns:minmax(0,1fr) minmax(0,1fr); } .field-row button { grid-column:2; justify-self:end; } }
</style>

