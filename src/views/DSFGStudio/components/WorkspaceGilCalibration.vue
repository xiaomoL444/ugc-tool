<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import StudioSelectField from "./StudioSelectField.vue";
import { readWorkspaceGilCalibration, workspaceGilCalibrationFiles, type WorkspaceGilCalibration } from "./workspaceGilCalibration";
import { WORKSPACE_STRUCT_ID_FIELDS } from "./workspaceStructIds";
import { cloneWorkspaceTarget, workspaceTargetKey, type WorkspaceTarget } from "./workspaceSettings";

const props = defineProps<{ target: WorkspaceTarget; disabled?: boolean; overlayTarget?: HTMLElement }>();
const emit = defineEmits<{ change: [value: WorkspaceGilCalibration | undefined]; busy: [value: boolean] }>();
const fileInput = ref<HTMLInputElement>();
const calibration = ref<WorkspaceGilCalibration>();
const busy = ref(false), error = ref("");
let request = 0;
watch(calibration, value => emit("change", value), { deep: true, flush: "sync" });
watch(() => workspaceTargetKey(props.target), () => {
  request++; calibration.value = undefined; error.value = ""; busy.value = false; emit("busy", false);
});
onBeforeUnmount(() => { request++; emit("busy", false); emit("change", undefined); });
const pending = computed(() => {
  if (!calibration.value) return "";
  try { workspaceGilCalibrationFiles(calibration.value); return ""; }
  catch (reason) { return reason instanceof Error ? reason.message : String(reason); }
});
const structLabel = (key: string) => {
  const field = WORKSPACE_STRUCT_ID_FIELDS.find(field => field.key === key);
  return field ? `${field.group} · ${field.label}` : key;
};
const skillLabel = (id: string) => calibration.value?.result.skills.presets.find(preset => preset.id === id)?.name || id;
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = "";
  if (!file || busy.value || props.disabled) return;
  const version = ++request, target = cloneWorkspaceTarget(props.target);
  calibration.value = undefined; error.value = ""; busy.value = true; emit("busy", true);
  try {
    const result = await readWorkspaceGilCalibration(file, target);
    if (version === request) calibration.value = result;
  } catch (reason) {
    if (version === request) error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    if (version === request) { busy.value = false; emit("busy", false); }
  }
}
</script>

<template>
  <section class="gil-calibration" aria-label="导入 GIL 校对编辑器参数" :aria-busy="busy">
    <strong>导入 GIL 校对编辑器参数</strong>
    <p>选择元件版时，需要导入 GIL 存档校对编辑器参数，完成后才能创建工作区。此步骤仅在本机读取，不会将存档上传云端。</p>
    <button type="button" :disabled="busy || disabled" @click="fileInput?.click()">{{ busy ? '正在校对…' : calibration ? '重新导入 GIL' : '导入 GIL 存档' }}</button>
    <input ref="fileInput" type="file" accept=".gil" hidden aria-label="选择校对用 GIL 存档" @change="readFile" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-if="calibration">
      <p role="status">「{{ calibration.fileName }}」已识别 {{ calibration.result.structs.matched.length }} 项结构体和 {{ calibration.result.skills.matched.length }} 项技能动画。{{ pending ? '请选择以下候选，完成校对。' : '校对完成，参数将在创建时保存到新工作区。' }}</p>
      <label v-for="key in calibration.result.structs.ambiguous" :key="key">{{ structLabel(key) }}
        <StudioSelectField v-model="calibration.structSelections[key]" :to="overlayTarget ?? false" :disabled="disabled" :aria-label="`${structLabel(key)} 校对候选 ID`" placeholder="请选择结构体 ID">
          <option v-for="candidate in calibration.result.structs.candidates[key]" :key="candidate.id" :value="candidate.id">{{ candidate.id }} · {{ candidate.source }}</option>
        </StudioSelectField>
      </label>
      <label v-for="id in calibration.result.skills.ambiguous" :key="id">{{ skillLabel(id) }}
        <StudioSelectField v-model="calibration.skillSelections[id]" :to="overlayTarget ?? false" :disabled="disabled" :aria-label="`${skillLabel(id)} 校对候选 ID`" placeholder="请选择技能动画 ID">
          <option v-for="candidate in calibration.result.skills.candidates[id]" :key="candidate.id" :value="candidate.id">{{ candidate.id }} · {{ candidate.name }}</option>
        </StudioSelectField>
      </label>
      <p v-if="pending" class="error" role="alert">{{ pending }}</p>
      <details v-if="calibration.result.structs.missing.length || calibration.result.skills.missing.length">
        <summary>未识别项保留默认值（{{ calibration.result.structs.missing.length + calibration.result.skills.missing.length }} 项）</summary>
        <p v-if="calibration.result.structs.missing.length">结构体：{{ calibration.result.structs.missing.map(structLabel).join('、') }}</p>
        <p v-if="calibration.result.skills.missing.length">技能动画：{{ calibration.result.skills.missing.map(skillLabel).join('、') }}</p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.gil-calibration { display: grid; gap: 10px; padding: 14px; border: 1px solid #cfdef0; border-radius: 8px; background: #eef5fc; color: #526588; font-size: 12px; line-height: 1.7; }
p { margin: 0; overflow-wrap: anywhere; }
strong { color: #34445b; font-size: 13px; }
button { justify-self: start; padding: 7px 12px; border: 1px solid #bdcfe6; border-radius: 6px; background: #fff; color: #345f91; font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
label { display: grid; gap: 6px; }
.error { color: #a43d42; }
summary { cursor: pointer; }
</style>
