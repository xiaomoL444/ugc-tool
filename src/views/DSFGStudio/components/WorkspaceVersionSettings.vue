<script setup lang="ts">
import { computed } from "vue";
import StudioSelectField from "./StudioSelectField.vue";
import type { WorkspaceSettings } from "./workspaceSettings";
import { baseReleases } from "./versioning/baseReleases";
import { formatReleaseLabel } from "./versioning/types";
import { extensionPackages } from "./versioning/extensionPackages";
import { changeWorkspaceBase, cloneWorkspaceTarget, getBasePackageIds, workspaceTargetErrors } from "./versioning/catalog";

const props = defineProps<{ modelValue: WorkspaceSettings; disabled?: boolean; overlayTarget?: HTMLElement | false }>();
const emit = defineEmits<{ "update:modelValue": [value: WorkspaceSettings] }>();
const bases = computed(() => [...baseReleases].sort((a, b) => b.order - a.order));
const includedPackageIds = computed(() => getBasePackageIds(props.modelValue.baseReleaseId));
const enabledPackageIds = computed(() => cloneWorkspaceTarget(props.modelValue).packageIds);
const errors = computed(() => workspaceTargetErrors(props.modelValue));
function changeBase(id: number | null) {
  if (props.disabled || id === null) return;
  emit("update:modelValue", { ...props.modelValue, ...changeWorkspaceBase(props.modelValue, id) });
}
function togglePackage(id: number, event: Event) {
  if (props.disabled || includedPackageIds.value.includes(id)) return;
  const checked = (event.target as HTMLInputElement).checked;
  emit("update:modelValue", { ...props.modelValue, packageIds: checked
    ? [...props.modelValue.packageIds.filter(value => value !== id), id]
    : props.modelValue.packageIds.filter(value => value !== id) });
}
</script>

<template>
  <div class="workspace-versions">
    <p class="version-hint">基准自带的扩展包自动启用；其他包请按实际安装情况选择。</p>
    <label class="version-field">基准版本
      <StudioSelectField :model-value="modelValue.baseReleaseId" :to="overlayTarget ?? false" :disabled="disabled || !bases.length"
        aria-label="基准版本" @update:model-value="changeBase">
        <option v-for="base in bases" :key="base.id" :value="base.id" :disabled="!!base.fileTypes && !base.fileTypes.includes(modelValue.fileType)">{{ formatReleaseLabel(base) }}</option>
      </StudioSelectField>
    </label>
    <div class="package-field" role="group" aria-label="已安装扩展包">
      <span>已安装扩展包</span>
      <p v-if="!extensionPackages.length" class="version-hint">暂无可选扩展包</p>
      <label v-for="extension in extensionPackages" :key="extension.id" class="package-option">
        <input type="checkbox" :checked="enabledPackageIds.includes(extension.id)" :disabled="disabled || includedPackageIds.includes(extension.id)" @change="togglePackage(extension.id, $event)" />
        {{ extension.name }}
        <small v-if="includedPackageIds.includes(extension.id)" class="package-included">基准自带</small>
      </label>
    </div>
    <p v-for="message in errors" :key="message" class="version-error" role="alert">{{ message }}</p>
  </div>
</template>

<style scoped>
.workspace-versions { display: grid; gap: 12px; color: #34445b; font-size: 13px; }
.version-field, .package-field { display: grid; gap: 7px; }
.version-hint { margin: 0; color: #6e7f95; font-size: 12px; line-height: 1.7; }
.package-option { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
.package-option input { width: auto; margin: 0; }
.package-included { color: #6e7f95; font-size: 11px; }
.version-error { margin: 0; color: #a43d42; font-size: 12px; line-height: 1.6; }
</style>
