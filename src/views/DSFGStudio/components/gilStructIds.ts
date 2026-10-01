import { decode } from "genshin-impact-ugc-file-converter-web";
import { WORKSPACE_STRUCT_ID_FIELDS, type StructIdCandidate, type WorkspaceStructIds } from "./workspaceStructIds";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown) => typeof value === "string" ? value.replace(/^string:/, "") : "";
export interface GilStruct { id: string; name: string }
/** GIL 10/6 is the structure definition table; 1 and 2 are editable/runtime snapshots, not node-graph references. */
export function readGilStructTable(document: { json: unknown }): GilStruct[] {
  const root = record(document.json) ? document.json : {};
  const section = record(root["10"]) ? root["10"] : {};
  const structs = new Map<string, GilStruct>();
  for (const entry of list(section["6"])) {
    if (!record(entry)) continue;
    for (const snapshot of [entry["1"], entry["2"]]) {
      if (!record(snapshot)) continue;
      const id = String(snapshot["1"] ?? ""), name = text(snapshot["501"]);
      if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || Number(id) > 2147483647 || !name) continue;
      structs.set(`${id}:${name}`, { id, name });
    }
  }
  if (!structs.size) throw new Error("GIL 中没有找到可识别的结构体定义，请确认存档包含 DSFG 结构体。");
  return [...structs.values()];
}
export function matchGilStructIds(structs: GilStruct[], current: WorkspaceStructIds) {
  const ids = { ...current }, candidates: Record<string, StructIdCandidate[]> = {};
  const matched: string[] = [], missing: string[] = [], ambiguous: string[] = [];
  for (const field of WORKSPACE_STRUCT_ID_FIELDS) {
    const matches = structs.filter(item => field.names.includes(item.name));
    const unique = [...new Map(matches.map(item => [item.id, { id: item.id, source: item.name }])).values()];
    if (unique.length === 1) { ids[field.key] = unique[0].id; matched.push(field.key); }
    else if (unique.length > 1) { ids[field.key] = ""; ambiguous.push(field.key); candidates[field.key] = unique; }
    else missing.push(field.key);
  }
  return { ids, candidates, matched, missing, ambiguous };
}
export function importGilStructIds(bytes: ArrayBuffer | ArrayBufferView, current: WorkspaceStructIds) {
  return matchGilStructIds(readGilStructTable(decode(bytes, { type: "gil" })), current);
}
