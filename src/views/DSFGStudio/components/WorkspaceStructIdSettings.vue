<script setup lang="ts">
import StudioSelectField from "./StudioSelectField.vue";
import StudioHistoryToolbar from "./StudioHistoryToolbar.vue";
import { useStudioHistory } from "./useStudioHistory";
import { useSkillAnimationPresets } from "./EntityPresetEditor/useSkillAnimationPresets";
import type { SkillAnimationPreset } from "./EntityPresetEditor/skillAnimationPresets";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { toast } from "vue-sonner";
import { createWorkspaceStructIds, STRUCT_ID_GROUPS, WORKSPACE_STRUCT_ID_FIELDS, validateWorkspaceStructIds,
  type WorkspaceStructIds, type WorkspaceStructIdState, type StructIdCandidate } from "./workspaceStructIds";
import { workspaceFileTypeOptions } from "./versioning/types";
import { createWorkspaceSettings, type WorkspaceSettings } from "./workspaceSettings";
import { workspaceTargetErrors } from "./versioning/catalog";
import WorkspaceVersionSettings from "./WorkspaceVersionSettings.vue";
import { isWorkspaceStructGroupAvailable } from "./workspaceFeatures";

const props = defineProps<{ workspace: string; state: WorkspaceStructIdState; loadError: string;
  settings: WorkspaceSettings;
  saveSettings: (ids: WorkspaceStructIds, settings: WorkspaceSettings, name: string) => Promise<void>;
  finishSettings?: (name: string) => Promise<void>;
  deleteWorkspace: () => Promise<boolean> }>();
const emit = defineEmits<{ close: []; retry: [] }>();
const draft = ref({ ...props.state.ids });
const draftName = ref(props.workspace);
const draftSettings = ref(createWorkspaceSettings(props.settings));
const visibleStructGroups = computed(() => STRUCT_ID_GROUPS.filter(group => isWorkspaceStructGroupAvailable(group, draftSettings.value)));
const candidates = ref<Record<string, StructIdCandidate[]>>({ ...props.state.candidates });
const { presets: skillPresets, ready: skillsReady, error: skillsError, retry: retrySkills, saveSnapshot: saveSkillsSnapshot } = useSkillAnimationPresets();
const draftSkills = ref<SkillAnimationPreset[]>([]);
const skillOriginalIds = ref<Record<string, string>>({});
const skillMatched = ref<string[]>([]), skillMissing = ref<string[]>([]);
const busy = ref(false), error = ref<string>(""), importMessage = ref("");
const fileInput = ref<HTMLInputElement>(), dialog = ref<HTMLElement>();
const history = useStudioHistory({
  session: false,
  element: dialog, blocked: () => busy.value || !!props.loadError, label: "修改工作区设置",
  capture: () => JSON.stringify({ name: draftName.value, settings: draftSettings.value, ids: draft.value, candidates: candidates.value, importMessage: importMessage.value,
    skills: draftSkills.value, skillOriginalIds: skillOriginalIds.value,
    skillMatched: skillMatched.value, skillMissing: skillMissing.value }),
  restore: snapshot => {
    const state = JSON.parse(snapshot);
    draftName.value = state.name; draftSettings.value = state.settings;
    draft.value = state.ids; candidates.value = state.candidates; importMessage.value = state.importMessage;
    draftSkills.value = state.skills; skillOriginalIds.value = state.skillOriginalIds;
    skillMatched.value = state.skillMatched; skillMissing.value = state.skillMissing;
    error.value = "";
  },
  onError: reason => { error.value = (reason instanceof Error ? reason.message : String(reason)); },
});
const previousFocus = document.activeElement as HTMLElement | null;
const errors = computed(() => [...workspaceTargetErrors(draftSettings.value), ...validateWorkspaceStructIds(draft.value, draftSettings.value)]);
const skillChanges = computed(() => draftSkills.value.filter(preset => preset.configId !== skillOriginalIds.value[preset.id]));
const skillPreview = computed(() => draftSkills.value.filter(preset => skillMatched.value.includes(preset.id)
  || preset.configId !== skillOriginalIds.value[preset.id]));
const skillName = (id: string) => draftSkills.value.find(preset => preset.id === id)?.name || "未命名技能动画";
const fieldsFor = (group: string) => WORKSPACE_STRUCT_ID_FIELDS.filter(field => field.group === group);
const labelFor = (key: string) => { const field = WORKSPACE_STRUCT_ID_FIELDS.find(item => item.key === key)!; return `${field.group} · ${field.label}`; };
function close() { if (!busy.value) emit("close"); }
async function removeWorkspace() {
  if (busy.value) return;
  busy.value = true;
  try { await props.deleteWorkspace(); }
  finally { busy.value = false; }
}
function reset() { draft.value = createWorkspaceStructIds(); candidates.value = {}; error.value = ""; }
async function readGil(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true; error.value = "";
  try {
    if (!/\.gil$/i.test(file.name)) throw new Error("请选择 .gil 存档文件。");
    if (file.size > 100 * 1024 * 1024) throw new Error("GIL 文件超过 100 MB，请选择较小的存档。");
    if (!skillsReady.value && !skillsError.value) throw new Error("技能动画预设正在读取，请稍后重试。");
    const { importGilWorkspaceIds } = await import("./gilSkillAnimations");
    const currentSkills = skillsReady.value ? (draftSkills.value.length ? draftSkills.value : skillPresets.value) : [];
    const { structs: result, skills } = importGilWorkspaceIds(await file.arrayBuffer(), draft.value, currentSkills);
    if (!result.matched.length && !result.ambiguous.length && !skills.matched.length && !skills.ambiguous.length) {
      throw new Error("未找到匹配的 DSFG 结构体或技能动画，现有 ID 已保留。");
    }
    draft.value = result.ids;
    for (const key of result.matched) delete candidates.value[key];
    skillOriginalIds.value = Object.fromEntries(currentSkills.map(preset => [preset.id,
      Object.prototype.hasOwnProperty.call(skillOriginalIds.value, preset.id) ? skillOriginalIds.value[preset.id] : preset.configId]));
    draftSkills.value = skills.presets;
    skillMatched.value = skills.matched; skillMissing.value = skills.missing;
    const conflicts = [
      ...result.ambiguous.map(labelFor),
      ...skills.ambiguous.map(id => `技能动画 · ${skillName(id)}`),
    ];
    if (conflicts.length) toast.warning("GIL 导入存在 ID 冲突", {
      description: `以下项存在多个同名 ID，已跳过并保留原值：${conflicts.join("、")}。`,
      duration: 8000,
    });
    importMessage.value = `「${file.name}」已识别 ${result.matched.length} / ${WORKSPACE_STRUCT_ID_FIELDS.length} 项结构体；`
      + `技能动画 ${skills.matched.length} / ${currentSkills.length} 项，${skillChanges.value.length} 项 ID 待更新。`
      + (result.missing.length ? `未识别项保留原值：${result.missing.map(labelFor).join("、")}。` : "")
      + (!skillsReady.value ? "技能动画预设读取失败，本次仅识别结构体 ID。" : "")
      + "点击保存后应用到当前工作区。";
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}
async function save() {
  if (busy.value || props.loadError || errors.value.length) return;
  busy.value = true; error.value = "";
  let structsSaved = false;
  try {
    if (skillChanges.value.length && !skillsReady.value) throw new Error(skillsError.value || "请先重新读取技能动画预设。");
    await props.saveSettings(draft.value, draftSettings.value, draftName.value); structsSaved = true;
    if (skillChanges.value.length) {
      const changes = new Map(skillChanges.value.map(preset => [preset.id, preset.configId]));
      await saveSkillsSnapshot(skillPresets.value.map(preset => changes.has(preset.id) ? { ...preset, configId: changes.get(preset.id)! } : preset));
    }
    await props.finishSettings?.(draftName.value);
    emit("close");
  }
  catch (reason) { error.value = (structsSaved ? "工作区与结构体设置已保存，后续保存未完成，请重试：" : "")
    + (reason instanceof Error ? reason.message : String(reason)); }
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
        <header><div><span>{{ workspace }}</span><h2 id="workspace-ids-title">工作区设置</h2></div><StudioHistoryToolbar local :history="history" :disabled="busy || !!loadError" /><button type="button" :disabled="busy" aria-label="关闭工作区设置" @click="close">×</button></header>
        <p class="intro">此工作区的所有模块共用文件类型、基准版本、扩展包和结构体 ID。</p>
        <div v-if="loadError" class="error" role="alert">{{ loadError }} <button type="button" @click="emit('retry')">重新读取</button></div>
        <fieldset :disabled="busy || !!loadError">
          <section class="workspace-target" aria-label="工作区目标配置">
            <div class="field"><label for="workspace-name">工作区名称</label><input id="workspace-name" v-model="draftName" required autocomplete="off" /></div>
            <div class="field"><label for="workspace-file-type">项目文件类型</label><StudioSelectField id="workspace-file-type" v-model="draftSettings.fileType" :to="false" :disabled="busy || !!loadError" aria-label="项目文件类型"><option v-for="option in workspaceFileTypeOptions" :key="option.value" :value="option.value">{{ option.label }}</option></StudioSelectField></div>
            <WorkspaceVersionSettings v-model="draftSettings" :disabled="busy || !!loadError" />
          </section>
          <h3>结构体 ID</h3>
          <div class="import-bar"><div><strong>从 GIL 自动识别</strong><p>按名称匹配结构体 ID 和技能动画配置 ID，保存后应用到当前工作区。文件在本机读取。</p></div><button type="button" :disabled="!skillsReady && !skillsError" @click="fileInput?.click()">{{ busy ? '读取中…' : '读取 GIL' }}</button><input ref="fileInput" type="file" accept=".gil" hidden @change="readGil" /></div>
          <p v-if="importMessage" class="notice" role="status">{{ importMessage }}</p>
          <div v-if="skillsError" class="error" role="alert">技能动画预设：{{ skillsError }} <button type="button" @click="retrySkills().catch(() => undefined)">重新读取／保存</button></div>
          <section v-if="draftSkills.length" class="skill-import" aria-labelledby="skill-import-title">
            <h3 id="skill-import-title">技能动画配置 ID</h3>
            <p class="notice">已匹配 {{ skillMatched.length }} 项，{{ skillChanges.length }} 项 ID 待更新。只更新预设，已有 Timeline 动作的技能 ID 保持原值。</p>
            <p v-if="skillMissing.length" class="notice">未识别项保留原值：{{ skillMissing.map(skillName).join('、') }}。</p>
            <details v-if="skillPreview.length" open>
              <summary>查看技能动画 ID（{{ skillPreview.length }} 项）</summary>
              <div class="skill-rows">
                <div v-for="preset in skillPreview" :key="preset.id" class="skill-row" :class="{ changed: preset.configId !== skillOriginalIds[preset.id] }">
                  <span class="skill-name">{{ preset.name }}</span>
                  <span class="skill-ids"><code>{{ skillOriginalIds[preset.id] || '未填写' }}</code><span aria-hidden="true"> → </span><code>{{ preset.configId || '未填写' }}</code></span>
                </div>
              </div>
            </details>
          </section>
          <p v-for="warning in state.warnings" :key="warning" class="notice">{{ warning }}</p>
          <section v-for="group in visibleStructGroups" :key="group">
            <h3>{{ group }}</h3>
            <div class="fields"><div v-for="field in fieldsFor(group)" :key="field.key" class="field">
              <label :for="`struct-${field.key}`">{{ field.label }}<small>{{ field.description }}</small></label>
              <input :id="`struct-${field.key}`" v-model="draft[field.key]" :aria-label="`${group} · ${field.label} ID`" inputmode="numeric" autocomplete="off" placeholder="填写结构体 ID" />
              <StudioSelectField v-if="candidates[field.key]?.length > 1" v-model="draft[field.key]" :to="false" :aria-label="`${group} · ${field.label} 候选 ID`"><option disabled value="">存在不同 ID，请选择或手动填写</option><option v-for="candidate in candidates[field.key]" :key="candidate.id" :value="candidate.id">{{ candidate.id }} · {{ candidate.source }}</option></StudioSelectField>
            </div></div>
          </section>
        </fieldset>
        <div v-if="errors.length" class="error" role="alert"><p v-for="message in errors" :key="message">{{ message }}</p></div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <footer><div><button type="button" class="danger" :disabled="busy" @click="removeWorkspace">删除工作区</button><button type="button" :disabled="busy || !!loadError" @click="reset">恢复默认结构体 ID</button></div><div><button type="button" :disabled="busy" @click="close">取消</button><button type="submit" class="primary" :disabled="busy || !!loadError || !!errors.length || !draftName.trim()">{{ busy ? '处理中…' : '保存设置' }}</button></div></footer>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.workspace-target { display: grid; gap: 16px; margin: 20px 0 24px; }
.workspace-target .field { display: grid; gap: 7px; }
button.danger { color: #a43d42; border-color: #e7bec3; }
.workspace-ids-backdrop { position: fixed; inset: 0; z-index: 12000; padding: 24px; display: grid; place-items: center; background: #13203388; }
.workspace-ids { box-sizing: border-box; width: min(880px, 100%); max-height: calc(100dvh - 48px); overflow-y: auto; padding: 24px; border: 1px solid #dbe4f0; border-radius: 14px; background: #fff; color: #34445b; box-shadow: 0 20px 70px #10203033; outline: none; }
header, footer, .import-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
header span { color: #728298; font-size: 12px; } h2 { margin: 5px 0 0; font-size: 21px; } h3 { margin: 20px 0 12px; padding-bottom: 8px; border-bottom: 1px solid #e4ebf3; font-size: 14px; }
.intro, .import-bar p, .notice { font-size: 12px; line-height: 1.7; color: #6e7f95; }
.import-bar { padding: 14px; border-radius: 8px; background: #eef5fc; } .import-bar strong { font-size: 13px; } .import-bar p { margin: 4px 0 0; } .import-bar button { flex-shrink: 0; }
fieldset { margin: 0; padding: 0; border: 0; min-width: 0; } .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; }
.field { min-width: 0; } label, .skill-name { display: block; font-size: 13px; } small { display: block; margin: 4px 0 7px; color: #8090a5; font-size: 11px; }
.skill-import summary { cursor: pointer; color: #345f91; font-size: 12px; padding: 8px 0; }
.skill-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; }
.skill-row { min-width: 0; padding: 10px; border: 1px solid #e4ebf3; border-radius: 6px; background: #f8fafd; }
.skill-row.changed { border-color: #c7ddf3; background: #eef5fc; }
.skill-ids { display: block; margin-top: 5px; font-size: 11px; overflow-wrap: anywhere; }
.skill-ids code { font-size: inherit; }
input, select { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid #cad6e5; border-radius: 6px; background: #f8fafd; color: #34445b; font: inherit; font-size: 13px; } select { margin-top: 5px; }
button { padding: 7px 12px; border: 1px solid #c8d5e5; border-radius: 6px; background: white; color: #345f91; cursor: pointer; font: inherit; font-size: 12px; } button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #5088ca; outline-offset: 2px; }
.primary { background: #2877c7; color: white; border-color: #2877c7; } .error { color: #a43d42; background: #fff1f2; padding: 10px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; } .error p { margin: 3px 0; } .notice { background: #f1f6fc; padding: 10px; overflow-wrap: anywhere; }
footer { position: sticky; bottom: -24px; margin-top: 24px; padding: 16px 0; background: #fff; border-top: 1px solid #e3ebf3; } footer > div { display: flex; gap: 8px; }
@media (max-width: 600px) { .workspace-ids-backdrop { padding: 10px; } .workspace-ids { padding: 16px; max-height: calc(100dvh - 20px); } .fields, .skill-rows { grid-template-columns: 1fr; } .import-bar { align-items: flex-start; flex-direction: column; } }
</style>
