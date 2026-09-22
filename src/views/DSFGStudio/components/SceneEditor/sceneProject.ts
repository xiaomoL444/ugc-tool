import sample from "@/assets/DSFGStudio/Scene/NOLOC_场景配置数据.json";

export const SCENE_FILE = "Scene.json";
export const SCENE_STRUCT_IDS = { scene: "1077936176", world: "1077936175", mainArea: "1077936174", subArea: "1077936173", subAreaTable: "1077936177" };
export type SceneStructIds = typeof SCENE_STRUCT_IDS;
export interface SceneContact { key: string; x: string; y: string; z: string }
export interface SceneWorld { id: string; name: string; contacts: SceneContact[] }
export interface SceneMainArea { id: string; name: string; worldId: string }
export interface SceneSubArea { id: string; name: string; mainAreaId: string; bgm: string }
export interface SceneProject {
  kind: "DSFGScene"; schemaVersion: 1; structIds: SceneStructIds;
  worlds: SceneWorld[]; mainAreas: SceneMainArea[]; subAreas: SceneSubArea[];
}
export function createSceneProject(): SceneProject {
  const fields = (sample as any).value;
  return {
    kind: "DSFGScene", schemaVersion: 1, structIds: { ...SCENE_STRUCT_IDS },
    worlds: fields[0].value.value.map((entry: any) => {
      const values = entry.value.value.value;
      return { id: values[0].value, name: values[1].value, contacts: values[2].value.value.map((point: any) => {
        const [x, y, z] = point.value.value.split(",");
        return { key: point.key.value, x, y, z };
      }) };
    }),
    mainAreas: fields[1].value.value.map((entry: any) => {
      const values = entry.value.value.value;
      return { id: values[0].value, name: values[1].value, worldId: values[2].value };
    }),
    subAreas: fields[2].value.value.flatMap((entry: any) => entry.value.value.value[0].value.value.map((row: any) => {
      const values = row.value.value.value;
      return { id: values[0].value, name: values[1].value, mainAreaId: values[2].value, bgm: values[3].value };
    })),
  };
}
export const encodeSceneProject = (project: SceneProject) => JSON.stringify(project, null, 2);
export function decodeSceneProject(raw: string): SceneProject {
  const data = JSON.parse(raw);
  const fail = () => { throw new Error("场景文件格式不完整，原文件已保留。"); };
  const strings = (value: any, keys: string[]) => value && keys.every(key => typeof value[key] === "string");
  if (data?.kind !== "DSFGScene" || data.schemaVersion !== 1 || !strings(data.structIds, Object.keys(SCENE_STRUCT_IDS))) fail();
  for (const [list, keys] of [[data.worlds, ["id", "name"]], [data.mainAreas, ["id", "name", "worldId"]], [data.subAreas, ["id", "name", "mainAreaId", "bgm"]]] as const) {
    if (!Array.isArray(list) || list.some((item: any) => !strings(item, [...keys]))) fail();
  }
  for (const world of data.worlds) if (!Array.isArray(world.contacts) || world.contacts.some((point: any) => !strings(point, ["key", "x", "y", "z"]))) fail();
  return data;
}
export function nextSceneId(rows: { id: string }[]): string {
  const ids = new Set(rows.map(row => Number(row.id)));
  let id = 0; while (ids.has(id)) id++;
  return String(id);
}
export function contactWorldOptions(project: SceneProject, world: SceneWorld, currentKey?: string): SceneWorld[] {
  return project.worlds.filter(target => Number(target.id) !== Number(world.id)
    && (currentKey !== undefined && Number(target.id) === Number(currentKey)
      || !world.contacts.some(point => Number(point.key) === Number(target.id))));
}
export function updateSceneWorldId(project: SceneProject, world: SceneWorld, next: string) {
  const old = world.id;
  world.id = next;
  for (const area of project.mainAreas) if (Number(area.worldId) === Number(old)) area.worldId = next;
  for (const source of project.worlds) for (const point of source.contacts) if (Number(point.key) === Number(old)) point.key = next;
}
export function validateSceneProject(project: SceneProject): string[] {
  const errors: string[] = [];
  const integer = (value: string) => /^[+-]?\d+$/.test(value.trim()) && Number(value) >= -2147483648 && Number(value) <= 2147483647;
  const unique = (values: string[], label: string) => {
    if (values.some(value => !integer(value))) errors.push(`${label}必须为 Int32 整数。`);
    if (new Set(values.map(Number)).size !== values.length) errors.push(`${label}不能重复。`);
  };
  const ids = Object.values(project.structIds);
  if (ids.some(id => !/^\d+$/.test(id) || Number(id) <= 0) || new Set(ids.map(Number)).size !== ids.length) errors.push("结构体 ID 必须为互不重复的正整数。");
  unique(project.worlds.map(row => row.id), "世界 ID");
  unique(project.mainAreas.map(row => row.id), "一级区域 ID");
  unique(project.subAreas.map(row => row.id), "二级区域 ID");
  for (const world of project.worlds) {
    unique(world.contacts.map(point => point.key), `世界「${world.name}」的关联世界 ID`);
    for (const point of world.contacts) {
      if (!integer(point.key) || !project.worlds.some(target => Number(target.id) === Number(point.key))) errors.push(`世界「${world.name}」的关联世界不存在。`);
      else if (Number(point.key) === Number(world.id)) errors.push(`世界「${world.name}」不能关联自身。`);
    }
    for (const point of world.contacts) if ([point.x, point.y, point.z].some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Math.fround(Number(value))))) errors.push(`世界「${world.name}」的 contact 坐标必须为有效浮点数。`);
  }
  for (const area of project.mainAreas) if (!integer(area.worldId) || !project.worlds.some(world => Number(world.id) === Number(area.worldId))) errors.push(`一级区域「${area.name}」的所属世界不存在。`);
  for (const area of project.subAreas) {
    if (!integer(area.mainAreaId) || !project.mainAreas.some(main => Number(main.id) === Number(area.mainAreaId))) errors.push(`二级区域「${area.name}」的所属一级区域不存在。`);
    if (!integer(area.bgm)) errors.push(`二级区域「${area.name}」的 BGM 必须为 Int32 整数。`);
  }
  return errors;
}
