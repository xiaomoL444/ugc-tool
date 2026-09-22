import { VariableWorkspace, type StructDefinition } from "miliastra-variable";
import world from "@/assets/DSFGStudio/Scene/1077936175[场景]世界.json";
import mainArea from "@/assets/DSFGStudio/Scene/1077936174[场景]一级区域.json";
import subArea from "@/assets/DSFGStudio/Scene/1077936173[场景]二级区域.json";
import scene from "@/assets/DSFGStudio/Scene/1077936176[场景]场景配置数据.json";
import subAreaTable from "@/assets/DSFGStudio/Scene/1077936177[场景]二级区域字典.json";
import { SCENE_STRUCT_IDS, validateSceneProject, type SceneProject, type SceneStructIds } from "./sceneProject";

export function createSceneStructWorkspace(ids: SceneStructIds) {
  const definitions = { world, mainArea, subArea, scene, subAreaTable };
  const replacements = new Map(Object.entries(SCENE_STRUCT_IDS).map(([key, value]) => [value, ids[key as keyof SceneStructIds]]));
  function remap(value: any): any {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, (key === "structId" || key === "value_structId") && typeof child === "string" ? replacements.get(child) ?? child : remap(child)]));
  }
  return new VariableWorkspace(Object.fromEntries(Object.entries(definitions).map(([key, definition]) => [ids[key as keyof SceneStructIds], remap(definition) as StructDefinition])));
}
export function exportScene(project: SceneProject): { value: unknown; json: string } {
  const errors = validateSceneProject(project);
  if (errors.length) throw new Error(errors.join("；"));
  const ids = project.structIds;
  const workspace = createSceneStructWorkspace(ids);
  const root = workspace.createDefault(ids.scene);
  const integer = (value: string) => String(Number(value));
  for (const row of project.worlds) {
    const value = workspace.createDefault(ids.world);
    value.value.id.setValue(integer(row.id)); value.value.name.setValue(row.name);
    while (value.value.contact.itemCount) value.value.contact.removeItem(0);
    for (const point of row.contacts) value.value.contact.appendItem({ key: integer(point.key), value: `${Number(point.x)},${Number(point.y)},${Number(point.z)}` });
    root.value["世界"].appendItem({ key: integer(row.id), value });
  }
  for (const row of project.mainAreas) {
    const value = workspace.createDefault(ids.mainArea);
    value.value.id.setValue(integer(row.id)); value.value.name.setValue(row.name); value.value.worldId.setValue(integer(row.worldId));
    root.value["一级区域"].appendItem({ key: integer(row.id), value });
  }
  const buckets = new Map<string, ReturnType<typeof workspace.createDefault>>();
  for (const row of [...project.subAreas].sort((a, b) => Number(a.id) - Number(b.id))) {
    const key = String(Math.floor(Number(row.id) / 100));
    let bucket = buckets.get(key);
    if (!bucket) { bucket = workspace.createDefault(ids.subAreaTable); buckets.set(key, bucket); }
    const value = workspace.createDefault(ids.subArea);
    value.value.id.setValue(integer(row.id)); value.value.name.setValue(row.name);
    value.value.mainAreaId.setValue(integer(row.mainAreaId)); value.value.bgm.setValue(integer(row.bgm));
    bucket.value["二级区域字典"].appendItem({ key: integer(row.id), value });
  }
  for (const [key, value] of buckets) root.value["二级区域"].appendItem({ key, value });
  if (root.issues.length) throw new Error(root.issues.map(issue => issue.message).join("；"));
  return { value: root.toQxqyValue(), json: root.serialize(2) };
}
