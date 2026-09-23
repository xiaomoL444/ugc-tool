import { readRuntime, keyedRows } from "../runtimeImport";
import { createSceneProject, SCENE_STRUCT_IDS, validateSceneProject } from "./sceneProject";
import { createSceneStructWorkspace } from "./sceneExporter";

export function importScene(text: string) {
  const { data, ids } = readRuntime(text, SCENE_STRUCT_IDS, SCENE_STRUCT_IDS.scene, createSceneStructWorkspace(SCENE_STRUCT_IDS));
  const project = createSceneProject(); project.structIds = ids;
  project.worlds = keyedRows(data["世界"]).map(row => ({ id: row.id, name: row.name, contacts: row.contact.map((point: any) => {
    const [x, y, z] = point.value.split(",").map((part: string) => part.trim()); return { key: point.key, x, y, z };
  }) }));
  project.mainAreas = keyedRows(data["一级区域"]);
  project.subAreas = data["二级区域"].flatMap((bucket: any) => keyedRows(bucket.value["二级区域字典"], Number(bucket.key)));
  const errors = validateSceneProject(project); if (errors.length) throw new Error(errors.join("；"));
  return project;
}
