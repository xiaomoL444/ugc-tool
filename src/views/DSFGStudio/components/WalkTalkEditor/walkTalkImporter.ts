import { readRuntime } from "../runtimeImport";
import { createWalkTalkProject, addWalkTalkEntry, DEFAULT_WALK_TALK_STRUCT_IDS, validateWalkTalkProject } from "./walkTalkProject";
import { createWalkTalkStructWorkspace } from "./walkTalkExporter";

export function importWalkTalk(text: string) {
  const { data, ids } = readRuntime(text, DEFAULT_WALK_TALK_STRUCT_IDS, DEFAULT_WALK_TALK_STRUCT_IDS.sequence, createWalkTalkStructWorkspace(DEFAULT_WALK_TALK_STRUCT_IDS));
  const project = createWalkTalkProject(); project.structIds = ids;
  for (const row of data.datas) Object.assign(addWalkTalkEntry(project), row, { params: row.params.join(", ") });
  const errors = validateWalkTalkProject(project, true);
  if (errors.length) throw new Error(errors.join("；"));
  return project;
}
