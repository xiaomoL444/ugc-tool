<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { createWorkspaceStructIds, STRUCT_ID_GROUPS, WORKSPACE_STRUCT_ID_FIELDS, validateWorkspaceStructIds,
  type WorkspaceStructIds, type WorkspaceStructIdState, type StructIdCandidate } from "./workspaceStructIds";

const props = defineProps<{ workspace: string; state: WorkspaceStructIdState; loadError: string;
  saveSettings: (ids: WorkspaceStructIds) => Promise<void> }>();
const emit = defineEmits<{ close: []; retry: [] }>();
const draft = ref({ ...props.state.ids });
const candidates = ref<Record<string, StructIdCandidate[]>>({ ...props.state.candidates });
const busy = ref(false), error = ref(""), importMessage = ref("");
const fileInput = ref<HTMLInputElement>(), dialog = ref<HTMLElement>();
const previousFocus = document.activeElement as HTMLElement | null;
const errors = computed(() => validateWorkspaceStructIds(draft.value));
const fieldsFor = (group: string) => WORKSPACE_STRUCT_ID_FIELDS.filter(field => field.group === group);
const labelFor = (key: string) => { const field = WORKSPACE_STRUCT_ID_FIELDS.find(item => item.key === key)!; return `${field.group} · ${field.label}`; };
function close() { if (!busy.value) emit("close"); }
function reset() { draft.value = createWorkspaceStructIds(); candidates.value = {}; importMessage.value = ""; error.value = ""; }
async function readGil(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true; error.value = ""; importMessage.value = "";
  try {
    if (!/\.gil$/i.test(file.name)) throw new Error("请选择 .gil 存档文件。");
    if (file.size > 100 * 1024 * 1024) throw new Error("GIL 文件超过 100 MB，请选择较小的存档。");
    const { importGilStructIds } = await import("./gilStructIds");
    const result = importGilStructIds(await file.arrayBuffer(), draft.value);
    if (!result.matched.length && !result.ambiguous.length) throw new Error("未找到匹配的 DSFG 结构体，现有 ID 已保留。");
    draft.value = result.ids;
    for (const key of result.matched) delete candidates.value[key];
    Object.assign(candidates.value, result.candidates);
    importMessage.value = `「${file.name}」已识别 ${result.matched.length} / ${WORKSPACE_STRUCT_ID_FIELDS.length} 项。`
      + (result.ambiguous.length ? `以下项有多个同名结构体，请选择：${result.ambiguous.map(labelFor).join("、")}。` : "")
      + (result.missing.length ? `未识别项保留原值：${result.missing.map(labelFor).join("、")}。` : "")
      + "点击保存后应用到当前工作区。";
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
async function save() {
  if (busy.value || props.loadError || errors.value.length) return;
  busy.value = true; error.value = "";
  try { await props.saveSettings(draft.value); emit("close"); }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); close(); }
  if (event.key !== "Tab") return;
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="file"]), select:not(:disabled), [tabindex="0"]') ?? [])];
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onMounted(() => { void nextTick(() => dialog.value?.focus()); });
onBeforeUnmount(() => previousFocus?.focus());
</script>

<template>
  <Teleport to="body">
    <div class="workspace-ids-backdrop dsfg-typography" @click.self="close" @keydown="keydown">
      <form ref="dialog" class="workspace-ids" role="dialog" aria-modal="true" aria-labelledby="workspace-ids-title" tabindex="-1" :aria-busy="busy" @submit.prevent="save">
        <header><div><span>{{ workspace }}</span><h2 id="workspace-ids-title">设置结构体 ID</h2></div><button type="button" :disabled="busy" aria-label="关闭结构体 ID 设置" @click="close">×</button></header>
        <p class="intro">此工作区的演出对话、边走边说、任务和场景统一使用以下 ID。保存后对所有文件生效。</p>
        <div v-if="loadError" class="error" role="alert">{{ loadError }} <button type="button" @click="emit('retry')">重新读取</button></div>
        <fieldset :disabled="busy || !!loadError">
          <div class="import-bar"><div><strong>从 GIL 自动识别</strong><p>选择包含 DSFG 结构体的存档，按结构体名称匹配。文件在本机读取。</p></div><button type="button" @click="fileInput?.click()">{{ busy ? '读取中…' : '读取 GIL' }}</button><input ref="fileInput" type="file" accept=".gil" hidden @change="readGil" /></div>
          <p v-if="importMessage" class="notice" role="status">{{ importMessage }}</p>
          <p v-for="warning in state.warnings" :key="warning" class="notice">{{ warning }}</p>
          <section v-for="group in STRUCT_ID_GROUPS" :key="group">
            <h3>{{ group }}</h3>
            <div class="fields"><div v-for="field in fieldsFor(group)" :key="field.key" class="field">
              <label :for="`struct-${field.key}`">{{ field.label }}<small>{{ field.description }}</small></label>
              <input :id="`struct-${field.key}`" v-model="draft[field.key]" :aria-label="`${group} · ${field.label} ID`" inputmode="numeric" autocomplete="off" placeholder="填写结构体 ID" />
              <select v-if="candidates[field.key]?.length > 1" v-model="draft[field.key]" :aria-label="`${group} · ${field.label} 候选 ID`"><option disabled value="">存在不同 ID，请选择或手动填写</option><option v-for="candidate in candidates[field.key]" :key="candidate.id" :value="candidate.id">{{ candidate.id }} · {{ candidate.source }}</option></select>
            </div></div>
          </section>
        </fieldset>
        <div v-if="errors.length" class="error" role="alert"><p v-for="message in errors" :key="message">{{ message }}</p></div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <footer><button type="button" :disabled="busy || !!loadError" @click="reset">恢复默认 ID</button><div><button type="button" :disabled="busy" @click="close">取消</button><button type="submit" class="primary" :disabled="busy || !!loadError || !!errors.length">{{ busy ? '处理中…' : '保存设置' }}</button></div></footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.workspace-ids-backdrop { position: fixed; inset: 0; z-index: 12000; padding: 24px; display: grid; place-items: center; background: #13203388; }
.workspace-ids { box-sizing: border-box; width: min(880px, 100%); max-height: calc(100dvh - 48px); overflow-y: auto; padding: 24px; border: 1px solid #dbe4f0; border-radius: 14px; background: #fff; color: #34445b; box-shadow: 0 20px 70px #10203033; outline: none; }
header, footer, .import-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
header span { color: #728298; font-size: 12px; } h2 { margin: 5px 0 0; font-size: 21px; } h3 { margin: 20px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e4ebf3; font-size: 14px; }
.intro, .import-bar p, .notice { font-size: 12px; line-height: 1.7; color: #6e7f95; }
.import-bar { padding: 14px; border-radius: 8px; background: #eef5fc; } .import-bar strong { font-size: 13px; } .import-bar p { margin: 4px 0 0; } .import-bar button { flex-shrink: 0; }
fieldset { margin: 0; padding: 0; border: 0; min-width: 0; } .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; }
.field { min-width: 0; } label { display: block; font-size: 13px; } small { display: block; margin: 4px 0 7px; color: #8090a5; font-size: 11px; }
input, select { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid #cad6e5; border-radius: 6px; background: #f8fafd; color: #34445b; font: inherit; font-size: 13px; } select { margin-top: 5px; }
button { padding: 7px 12px; border: 1px solid #c8d5e5; border-radius: 6px; background: white; color: #345f91; cursor: pointer; font: inherit; font-size: 12px; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #5088ca; outline-offset: 2px; }
.primary { background: #2877c7; color: white; border-color: #2877c7; } .error { color: #a43d42; background: #fff1f2; padding: 10px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; } .error p { margin: 3px 0; } .notice { background: #f1f6fc; padding: 10px; overflow-wrap: anywhere; }
footer { position: sticky; bottom: -24px; margin-top: 24px; padding: 16px 0; background: #fff; border-top: 1px solid #e3ebf3; } footer > div { display: flex; gap: 8px; }
@media (max-width: 600px) { .workspace-ids-backdrop { padding: 10px; } .workspace-ids { padding: 16px; max-height: calc(100dvh - 20px); } .fields { grid-template-columns: 1fr; } .import-bar { align-items: flex-start; flex-direction: column; } }
</style>
