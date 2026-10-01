import { DEFAULT_QXQY_STRUCT_IDS, QXQY_STRUCT_ID_FIELDS } from "./DialogueEditor/utils/qxqyStructWorkspace";
import { DEFAULT_QUEST_STRUCT_IDS, QUEST_STRUCT_ID_FIELDS } from "./QuestEditor/questProject";
import { DEFAULT_WALK_TALK_STRUCT_IDS } from "./WalkTalkEditor/walkTalkProject";
import { SCENE_STRUCT_IDS } from "./SceneEditor/sceneProject";
import type { QxqyStructIds } from "./DialogueEditor/types/FileStruct";
import type { QuestStructIds } from "./QuestEditor/types";
import type { WalkTalkStructIds } from "./WalkTalkEditor/walkTalkProject";
import type { SceneStructIds } from "./SceneEditor/sceneProject";

export type WorkspaceStructIds = Record<string, string>;
export const WORKSPACE_STRUCT_IDS_FILE = "StructIds.json";
export const STRUCT_ID_GROUPS = ["演出对话", "任务", "边走边说", "场景"];
const names: Record<string, string[]> = {
  performance: ["[演出]演出", "演出"], actionGroup: ["[演出]ActionGroup", "ActionGroup"],
  actionClip: ["[演出]ActionClip", "ActionClip"], dialogue: ["[演出]对话", "[对话]对话节点"],
  select: ["[演出]选项卡", "[对话]选项卡"], camera: ["[运镜]运镜参数", "CameraClip"],
  cameraPosition: ["[运镜]PositionData", "PositionData"], cameraRotation: ["[运镜]RotationData", "RotationnData", "RotationData"],
  cameraSlot: ["[运镜]PositionSlot", "PositionSlot"],
};
export const WORKSPACE_STRUCT_ID_FIELDS = [
  ...QXQY_STRUCT_ID_FIELDS.map(field => ({ key: `dialogue.${field.key}`, label: field.label,
    group: "演出对话", description: field.description,
    defaultId: DEFAULT_QXQY_STRUCT_IDS[field.key], names: names[field.key] })),
  ...QUEST_STRUCT_ID_FIELDS.map(field => ({ key: `quest.${field.key}`, label: field.label, group: "任务", description: field.description,
    defaultId: DEFAULT_QUEST_STRUCT_IDS[field.key], names: [`[任务]${field.label}`] })),
  ...(["sequence", "dialogue"] as const).map(key => ({ key: `walkTalk.${key}`, label: key === "sequence" ? "对话列表" : "对话节点", group: "边走边说", description: key === "sequence" ? "列表外层结构体" : "每条台词的结构体",
    defaultId: DEFAULT_WALK_TALK_STRUCT_IDS[key], names: key === "sequence" ? ["[消息]边走边说对话列表结构体"] : ["[消息]边走边说对话节点", "[消息]边走边说对话"] })),
  ...Object.entries({ scene: "场景配置数据", world: "世界", mainArea: "一级区域", subArea: "二级区域", subAreaTable: "二级区域字典" }).map(([key, label]) => ({
    key: `scene.${key}`, label, group: "场景", description: `场景 · ${label}`, defaultId: SCENE_STRUCT_IDS[key as keyof SceneStructIds], names: [`[场景]${label}`],
  })),
];
export const createWorkspaceStructIds = (): WorkspaceStructIds => Object.fromEntries(WORKSPACE_STRUCT_ID_FIELDS.map(field => [field.key, field.defaultId]));
export function validateWorkspaceStructIds(ids: WorkspaceStructIds): string[] {
  const errors: string[] = [], used = new Map<string, string>();
  for (const field of WORKSPACE_STRUCT_ID_FIELDS) {
    const id = ids[field.key]?.trim();
    const label = `${field.group} · ${field.label}`;
    if (!id || !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || Number(id) > 2147483647) {
      errors.push(`${label}：请填写正 Int32 结构体 ID`); continue;
    }
    const canonical = String(Number(id));
    if (used.has(canonical)) errors.push(`${label}与${used.get(canonical)}的 ID 重复`);
    used.set(canonical, label);
  }
  return errors;
}
export function moduleStructIds(ids: WorkspaceStructIds) {
  const group = (prefix: string) => Object.fromEntries(WORKSPACE_STRUCT_ID_FIELDS.filter(field => field.key.startsWith(`${prefix}.`)).map(field => [field.key.split(".")[1], String(Number(ids[field.key]))]));
  return { dialogue: group("dialogue") as unknown as QxqyStructIds,
    // Legacy task metadata; the current task format uses Vector3 and no longer exports PositionSlot.
    quest: { ...group("quest"), positionSlot: DEFAULT_QUEST_STRUCT_IDS.positionSlot } as QuestStructIds,
    walkTalk: group("walkTalk") as unknown as WalkTalkStructIds, scene: group("scene") as SceneStructIds };
}
export interface StructIdStorage {
  exists(path: string): Promise<boolean>; readFile(path: string): Promise<string>;
  getFiles(path: string): Promise<string[]>; writeFile(path: string, value: string): Promise<unknown>;
}
export interface StructIdCandidate { id: string; source: string }
export interface WorkspaceStructIdState { ids: WorkspaceStructIds; candidates: Record<string, StructIdCandidate[]>; warnings: string[] }
export function encodeWorkspaceStructIds(ids: WorkspaceStructIds) {
  const errors = validateWorkspaceStructIds(ids);
  if (errors.length) throw new Error(errors.join("；"));
  return JSON.stringify({ kind: "DSFGStructIds", schemaVersion: 1,
    ids: Object.fromEntries(WORKSPACE_STRUCT_ID_FIELDS.map(field => [field.key, String(Number(ids[field.key]))])) }, null, 2);
}
/** Existing documents remain intact. Conflicting custom IDs require an explicit choice in the workspace dialog. */
export async function loadWorkspaceStructIds(storage: StructIdStorage, workspace: string): Promise<WorkspaceStructIdState> {
  const path = `/${workspace}/${WORKSPACE_STRUCT_IDS_FILE}`;
  const state: WorkspaceStructIdState = { ids: createWorkspaceStructIds(), candidates: {}, warnings: [] };
  if (await storage.exists(path)) {
    const saved = JSON.parse(await storage.readFile(path));
    if (saved?.kind !== "DSFGStructIds" || saved.schemaVersion !== 1 || !saved.ids || typeof saved.ids !== "object" || Array.isArray(saved.ids)) throw new Error("工作区结构体设置格式无效，原文件已保留。");
    for (const field of WORKSPACE_STRUCT_ID_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(saved.ids, field.key)) {
        if (typeof saved.ids[field.key] !== "string") throw new Error("工作区结构体 ID 必须为文本，原文件已保留。");
        state.ids[field.key] = saved.ids[field.key];
      }
    }
    return state;
  }
  const paths: Array<{ path: string; group: string }> = [];
  for (const [file, group] of [["QuestEditor.json", "quest"], ["Scene.json", "scene"]]) {
    if (await storage.exists(`/${workspace}/${file}`)) paths.push({ path: `/${workspace}/${file}`, group });
  }
  for (const [directory, group] of [["DialogueEditor", "dialogue"], ["WalkTalkEditor", "walkTalk"], ["QuestEditor", "quest"]]) {
    if (group === "quest" && paths.some(item => item.group === "quest")) continue;
    const base = `/${workspace}/${directory}`;
    if (await storage.exists(base)) for (const file of (await storage.getFiles(base)).filter(name => /^[^/\\]+\.json$/i.test(name)).sort()) paths.push({ path: `${base}/${file}`, group });
  }
  for (const entry of paths) {
    try {
      const project = JSON.parse(await storage.readFile(entry.path));
      const ids = entry.group === "dialogue" ? project.exportSettings?.qxqyStructIds : project.structIds;
      for (const field of WORKSPACE_STRUCT_ID_FIELDS) {
        const localKey = field.key.startsWith(`${entry.group}.`) ? field.key.split(".")[1] : undefined;
        const id = localKey && ids?.[localKey];
        if (typeof id !== "string" || !/^\d+$/.test(id) || Number(id) === Number(field.defaultId)) continue;
        const list = state.candidates[field.key] ??= [];
        if (!list.some(candidate => Number(candidate.id) === Number(id))) list.push({ id, source: entry.path });
      }
    } catch { state.warnings.push(`未能读取 ${entry.path} 的旧 ID，原文件已保留。`); }
  }
  for (const [key, candidates] of Object.entries(state.candidates)) state.ids[key] = candidates.length === 1 ? candidates[0].id : "";
  return state;
}
