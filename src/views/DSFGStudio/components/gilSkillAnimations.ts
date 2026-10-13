import { decode } from "genshin-impact-ugc-file-converter-web";
import type { SkillAnimationPreset } from "./EntityPresetEditor/skillAnimationPresets";
import { matchGilStructIds, readGilStructTable } from "./gilStructIds";
import type { WorkspaceStructIds } from "./workspaceStructIds";

export interface GilSkill { id: string; name: string }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value: unknown) => typeof value === "string" ? value.replace(/^string:/, "") : "";
const configId = (value: unknown): string | null => {
  const raw = typeof value === "number" || typeof value === "string" ? String(value) : "";
  const number = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(number) && number > 0 && number <= 2147483647 ? String(number) : null;
};
// Both prefixes occur in DSFG exports; the remaining complete name must match exactly.
const animationName = (name: string) => name.replace(/^\[(?:演出|演岀)\]/, "");

/** GIL 15/1 contains configuration definitions. Type 6 is a skill; graph references are ignored. */
export function readGilSkillTable(document: { json: unknown }): GilSkill[] {
  const root = record(document.json) ? document.json : {};
  const section = record(root["15"]) ? root["15"] : {};
  const skills = new Map<string, GilSkill>();
  for (const entry of list(section["1"])) {
    if (!record(entry) || entry["2"] !== 6) continue;
    const id = configId(entry["1"]);
    if (!id) continue;
    for (const component of list(entry["4"])) {
      if (!record(component) || component["1"] !== 1 || !record(component["11"])) continue;
      const name = text(component["11"]["1"]);
      if (name.trim()) skills.set(`${id}:${name}`, { id, name });
    }
  }
  return [...skills.values()];
}

export function matchGilSkillAnimationIds(skills: GilSkill[], current: SkillAnimationPreset[]) {
  const matched: string[] = [], missing: string[] = [], ambiguous: string[] = [];
  const candidateEntries: Array<[string, GilSkill[]]> = [];
  const presets = current.map(preset => {
    const name = animationName(preset.name);
    const unique = new Map<string, GilSkill>();
    if (name.trim()) for (const skill of skills) {
      const id = configId(skill.id);
      if (id && animationName(skill.name) === name) unique.set(id, { id, name: skill.name });
    }
    const matches = [...unique.values()];
    if (matches.length === 1) {
      matched.push(preset.id);
      return { ...preset, configId: matches[0].id };
    }
    if (matches.length > 1) {
      ambiguous.push(preset.id);
      candidateEntries.push([preset.id, matches]);
    } else missing.push(preset.id);
    return { ...preset };
  });
  const candidates: Record<string, GilSkill[]> = Object.fromEntries(candidateEntries);
  return { presets, candidates, matched, missing, ambiguous };
}

/** Decode once, then independently match each table. A missing table does not hide decoding errors. */
export function importGilWorkspaceIds(bytes: ArrayBuffer | ArrayBufferView, currentStructIds: WorkspaceStructIds, currentPresets: SkillAnimationPreset[]) {
  const document = decode(bytes, { type: "gil" });
  return {
    structs: matchGilStructIds(readGilStructTable(document, false), currentStructIds),
    skills: matchGilSkillAnimationIds(readGilSkillTable(document), currentPresets),
  };
}
