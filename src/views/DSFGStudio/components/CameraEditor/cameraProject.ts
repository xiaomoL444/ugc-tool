import type { PerformanceClip } from "../DialogueEditor/types/DialogueNode";
import { createPerformanceClip, normalizePerformanceClip } from "../DialogueEditor/utils/dialogueProject";

export interface CameraProject {
  kind: "DSFGCameraProject";
  schemaVersion: 1;
  clip: PerformanceClip;
}

export function createCameraProject(name = "新建镜头"): CameraProject {
  return { kind: "DSFGCameraProject", schemaVersion: 1, clip: { ...createPerformanceClip("Camera"), name } };
}

export function encodeCameraProject(project: CameraProject) {
  return JSON.stringify(project, null, 2);
}

export function decodeCameraProject(raw: string): CameraProject {
  const data = JSON.parse(raw.replace(/^\uFEFF/, ""));
  const clip = data?.clip;
  if (data?.kind !== "DSFGCameraProject" || data.schemaVersion !== 1 || !clip || clip.type !== "Camera"
      || typeof clip.id !== "string" || !clip.id || typeof clip.name !== "string"
      || !Number.isFinite(clip.startTime) || clip.startTime < 0 || !Number.isFinite(clip.duration) || clip.duration < 0.1
      || !Array.isArray(clip.components)) throw new Error("无法识别镜头编辑文件，原文件已保留。");
  const ids = new Set<string>();
  for (const component of clip.components) {
    if (!component || typeof component.id !== "string" || !component.id || ids.has(component.id)
        || typeof component.templateId !== "string" || !component.templateId || typeof component.enabled !== "boolean"
        || !component.properties || typeof component.properties !== "object" || Array.isArray(component.properties)) {
      throw new Error("镜头参数不完整，原文件已保留。");
    }
    ids.add(component.id);
  }
  return { kind: "DSFGCameraProject", schemaVersion: 1, clip: normalizePerformanceClip(clip, "Camera", 0, 0) };
}

export function cameraFileName(input: string) {
  const base = input.trim().replace(/\.json$/i, "");
  if (!base || /[<>:"/\\|?*\u0000-\u001f]/.test(base) || base === "." || base === "..") {
    throw new Error("请输入有效的镜头文件名，不能包含路径或特殊字符。");
  }
  return `${base}.json`;
}
