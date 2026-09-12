import dialogueDefinition from "@/assets/DSFGStudio/WalkTalk/1077936129对话节点.json";
import sequenceSample from "@/assets/DSFGStudio/WalkTalk/NOLOC_测试子结构体1077936131.json";
import { DEFAULT_WALK_TALK_STYLE } from "./walkTalkStyles";

export interface WalkTalkStructIds { sequence: string; dialogue: string }
// 数值也保留输入原文，保证未输完的数字和参数列表能正常保存、再次编辑。
export interface WalkTalkEntry {
  id: string;
  style: string;
  talker: string;
  subtitle: string;
  content: string;
  continueDelay: string;
  prams: string;
  autoContinue: string;
}
export interface WalkTalkProject {
  kind: "DSFGWalkTalk";
  schemaVersion: 1;
  structIds: WalkTalkStructIds;
  entries: WalkTalkEntry[];
}
export const WALK_TALK_LIMIT = 100;
export const DEFAULT_WALK_TALK_STRUCT_IDS: WalkTalkStructIds = {
  sequence: sequenceSample.structId,
  dialogue: sequenceSample.value[0].value.structId,
};
export const WALK_TALK_FIELDS = ["style", "talker", "subtitle", "content", "continueDelay", "prams", "autoContinue"] as const;
const defaults = Object.fromEntries(dialogueDefinition.value.map(field => [field.key, field.value.value]));

export function createWalkTalkProject(): WalkTalkProject {
  return { kind: "DSFGWalkTalk", schemaVersion: 1, structIds: { ...DEFAULT_WALK_TALK_STRUCT_IDS }, entries: [] };
}
export function addWalkTalkEntry(project: WalkTalkProject, afterId?: string): WalkTalkEntry {
  if (project.entries.length >= WALK_TALK_LIMIT) throw new Error("每份边走边说列表最多 100 条台词。");
  const entry = Object.fromEntries(WALK_TALK_FIELDS.map(key => [key, Array.isArray(defaults[key]) ? defaults[key].join(", ") : String(defaults[key])])) as unknown as WalkTalkEntry;
  entry.id = crypto.randomUUID();
  entry.style = DEFAULT_WALK_TALK_STYLE;
  const afterIndex = afterId === undefined ? -1 : project.entries.findIndex(item => item.id === afterId);
  project.entries.splice(afterIndex < 0 ? project.entries.length : afterIndex + 1, 0, entry);
  return entry;
}
export function moveWalkTalkEntry(project: WalkTalkProject, id: string, offset: number) {
  const index = project.entries.findIndex(entry => entry.id === id);
  const destination = index + offset;
  if (!Number.isInteger(offset) || index < 0 || destination < 0 || destination >= project.entries.length) return;
  const [entry] = project.entries.splice(index, 1);
  project.entries.splice(destination, 0, entry);
}
export function removeWalkTalkEntry(project: WalkTalkProject, id: string) {
  const index = project.entries.findIndex(entry => entry.id === id);
  if (index >= 0) project.entries.splice(index, 1);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const floatPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function parseWalkTalkFloat(text: string): string {
  const value = text.trim();
  if (!floatPattern.test(value) || !Number.isFinite(Number(value))) throw new Error("必须填写有效的有限数值");
  return value;
}
export function parseWalkTalkParams(text: string): string[] {
  const values = text.trim() ? text.trim().split(/[\s,，;；]+/).filter(Boolean) : [];
  if (values.length > 100) throw new Error("整数参数最多 100 项");
  return values.map(value => {
    const number = Number(value);
    if (!/^[+-]?\d+$/.test(value) || !Number.isInteger(number) || number < -2147483648 || number > 2147483647) {
      throw new Error(`「${value}」不是 Int32 整数`);
    }
    return String(number);
  });
}
export function validateWalkTalkStructIds(ids: WalkTalkStructIds): string[] {
  if (!isRecord(ids)) return ["缺少结构体 ID 设置。"];
  const errors: string[] = [];
  for (const [key, label] of [["sequence", "列表外层"], ["dialogue", "台词节点"]] as const) {
    if (typeof ids[key] !== "string" || !/^\d+$/.test(ids[key])) errors.push(`${label}结构体 ID 必须是数字文本。`);
  }
  if (!errors.length && ids.sequence.replace(/^0+(?=\d)/, "") === ids.dialogue.replace(/^0+(?=\d)/, "")) errors.push("外层与台词节点不能使用相同结构体 ID。");
  return errors;
}
export function validateWalkTalkProject(project: WalkTalkProject, forExport = false): string[] {
  if (!isRecord(project) || project.kind !== "DSFGWalkTalk" || project.schemaVersion !== 1) return ["不是支持的边走边说编辑器文件（DSFGWalkTalk v1）。"];
  const errors = validateWalkTalkStructIds(project.structIds);
  if (!Array.isArray(project.entries)) return [...errors, "台词必须是顺序列表。"];
  if (project.entries.length > WALK_TALK_LIMIT) errors.push("每份边走边说列表最多 100 条台词。");
  const ids = new Set<string>();
  project.entries.forEach((entry, index) => {
    const label = `第 ${index + 1} 条台词`;
    if (!isRecord(entry)) { errors.push(`${label}必须是对象。`); return; }
    if (typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) errors.push(`${label}的编辑器 ID 缺失或重复。`);
    else ids.add(entry.id);
    for (const key of WALK_TALK_FIELDS) {
      if (typeof entry[key] !== "string") { errors.push(`${label}的 ${key} 必须是文本。`); continue; }
      if (!forExport) continue;
      try {
        if (key === "continueDelay" || key === "autoContinue") parseWalkTalkFloat(entry[key]);
        if (key === "prams") parseWalkTalkParams(entry[key]);
      } catch (error) { errors.push(`${label}的 ${key}：${error instanceof Error ? error.message : String(error)}`); }
    }
  });
  return errors;
}
export function encodeWalkTalkProject(project: WalkTalkProject): string { return JSON.stringify(project, null, 2); }
export function decodeWalkTalkProject(raw: string): WalkTalkProject {
  let project: WalkTalkProject;
  try { project = JSON.parse(raw); } catch { throw new Error("边走边说文件不是有效的 JSON。"); }
  const errors = validateWalkTalkProject(project);
  if (errors.length) throw new Error(errors.join("；"));
  return project;
}
