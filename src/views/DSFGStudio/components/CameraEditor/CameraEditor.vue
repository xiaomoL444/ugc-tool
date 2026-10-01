<script setup lang="ts">
import SectionLayout from "@/components/Layout/SectionLayout.vue";
import { downloadTextFile } from "@/utils/download";
import { toast } from "vue-sonner";
import StudioFileList from "../StudioFileList.vue";
import StudioSidebarContent from "../StudioSidebarContent.vue";
import StudioCreateDialog from "../StudioCreateDialog.vue";
import CameraClipEditor from "../DialogueEditor/components/clip-editors/CameraClipEditor.vue";
import { exportQxqyCameraClip } from "../DialogueEditor/utils/qxqyPerformanceExporter";
import { useWorkspaceStructIds } from "../useWorkspaceStructIds";
import { useCameraFiles } from "./useCameraFiles";
import type { StudioEditorKind } from "../studioSidebar";

withDefaults(defineProps<{ editorKind?: StudioEditorKind }>(), { editorKind: "Camera" });
const { project, files, selectedFile, creating, newName, busy, status, error,
  refreshFiles, selectFile, createFile, deleteFile, prepareToLeave, flush } = useCameraFiles();
const workspaceIds = useWorkspaceStructIds();
defineExpose({ prepareToLeave });
function updateDuration(event: Event) {
  if (!project.value) return;
  const input = event.target as HTMLInputElement;
  if (Number.isFinite(input.valueAsNumber) && input.valueAsNumber >= 0.1) project.value.clip.duration = input.valueAsNumber;
  input.value = String(project.value.clip.duration);
}
function exportCamera() {
  if (busy.value || !project.value) return;
  try {
    const result = exportQxqyCameraClip(project.value.clip, workspaceIds.camera());
    downloadTextFile(result.json, `${selectedFile.value.replace(/\.json$/i, "")}-镜头.json`, "application/json");
  } catch (reason) { toast.error(reason instanceof Error ? reason.message : String(reason)); }
}
</script>

<template>
  <div class="camera-file-editor" :inert="busy">
    <StudioSidebarContent>
      <div class="camera-file-sidebar" :inert="busy">
        <div class="studio-sidebar-heading"><strong>镜头文件</strong></div>
        <StudioFileList :disabled="busy" :values="files" :selected-value="selectedFile" @select="selectFile" @add="creating = true" @delete="deleteFile" />
        <button type="button" class="refresh-files" :disabled="busy" @click="refreshFiles">刷新列表</button>
      </div>
    </StudioSidebarContent>
    <SectionLayout :title="selectedFile || '镜头编辑'" class="camera-file-section">
      <div class="camera-file-workspace">
        <header class="camera-file-toolbar">
          <span class="save-status" role="status">{{ status }}</span>
          <label v-if="project" class="duration-field">时长（秒）<input type="number" min="0.1" step="0.1" aria-label="镜头时长（秒）" :value="project.clip.duration" @change="updateDuration" /></label>
          <button v-if="project" type="button" class="primary" @click="exportCamera">导出千星镜头</button>
        </header>
        <p v-if="error && !creating" class="file-error" role="alert">{{ error }} <button v-if="status === '保存失败'" type="button" @click="flush().catch(() => undefined)">重试保存</button></p>
        <div v-if="project" class="camera-file-scroll"><div class="camera-file-card"><CameraClipEditor :key="selectedFile" :clip="project.clip" /></div></div>
        <div v-else class="studio-empty"><h2>编辑一份镜头</h2><p>从左侧选择文件，或新建一个镜头。</p><button type="button" @click="creating = true">＋ 新建镜头文件</button></div>
      </div>
    </SectionLayout>
    <StudioCreateDialog v-if="creating" v-model="newName" title="新建镜头文件" label="镜头文件名" placeholder="输入镜头文件名" submit-label="创建并打开" :busy="busy" @submit="createFile" @close="creating = false">
      <p v-if="error" class="file-error" role="alert">{{ error }}</p>
    </StudioCreateDialog>
  </div>
</template>

<style scoped>
.camera-file-editor { --timeline-field: #fff; --timeline-surface: #f7f9fd; --timeline-soft: #eef3f9; --timeline-border: #cbd7e6; --timeline-text: #334155; --timeline-muted: #64748b; --timeline-subtle: #71839a; --timeline-accent: #2877c7; --timeline-active: #e2edfc; --timeline-active-text: #245a98; --timeline-warning: #94651c; --timeline-danger: #b45367; --timeline-success: #338460; --timeline-axis-blue: #3579b8; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; color-scheme: light; }
.camera-file-sidebar { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.camera-file-sidebar .studio-sidebar-heading { margin-bottom: 4px; }
.refresh-files { align-self: flex-start; padding: 5px 0; border: 0; background: transparent; color: #8290ad; font: inherit; font-size: 11px; cursor: pointer; }
.camera-file-section { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.camera-file-workspace { display: flex; flex: 1; flex-direction: column; min-height: 0; height: 100%; }
.camera-file-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-height: 44px; padding: 4px 6px 14px; }
.save-status { margin-right: auto; color: #438472; font-size: 12px; }
.duration-field { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 12px; }
.duration-field input { box-sizing: border-box; width: 90px; min-height: 34px; padding: 7px 9px; border: 1px solid #cbd7e6; border-radius: 7px; background: #fff; color: #334155; font: inherit; }
.camera-file-toolbar button, .file-error button { min-height: 34px; padding: 7px 12px; border: 1px solid #ced3f3; border-radius: 7px; background: #fff; color: #526588; font: inherit; font-size: 12px; cursor: pointer; }
.camera-file-toolbar .primary { border-color: #078cff; background: linear-gradient(110deg, #1683ff, #00a7f2); color: #fff; }
.camera-file-scroll { flex: 1; min-height: 0; overflow: auto; padding: 6px 6px 20px; }
.camera-file-card { box-sizing: border-box; max-width: 820px; padding: 22px; border: 1px solid #d4d8f4; border-top: 3px solid #00b4f0; border-radius: 10px; background: #ffffffeb; }
.file-error { margin: 0 6px 12px; color: #b45367; font-size: 12px; overflow-wrap: anywhere; }
.file-error button { margin-left: 8px; }
button:focus-visible, input:focus-visible { outline: 2px solid #54a8ff; outline-offset: 2px; }
</style>
