import { VariableWorkspace, type StructDefinition } from "miliastra-variable";
import dialogueDefinition from "@/assets/DSFGStudio/WalkTalk/1077936168[消息]边走边说对话.json";
import sequenceDefinition from "@/assets/DSFGStudio/WalkTalk/1077936171[消息]边走边说对话列表结构体.json";
import {
  WALK_TALK_FIELDS, parseWalkTalkFloat, parseWalkTalkParams, validateWalkTalkProject, validateWalkTalkStructIds,
  type WalkTalkProject, type WalkTalkStructIds,
} from "./walkTalkProject";

export function createWalkTalkStructWorkspace(ids: WalkTalkStructIds) {
  const errors = validateWalkTalkStructIds(ids);
  if (errors.length) throw new Error(errors.join("；"));
  const outer = JSON.parse(JSON.stringify(sequenceDefinition)) as StructDefinition;
  outer.value[0].value.value = { structId: ids.dialogue, value: [] };
  return new VariableWorkspace({
    [ids.sequence]: outer,
    [ids.dialogue]: JSON.parse(JSON.stringify(dialogueDefinition)) as StructDefinition,
  });
}

export function exportWalkTalk(project: WalkTalkProject): { value: unknown; json: string } {
  const errors = validateWalkTalkProject(project, true);
  if (errors.length) throw new Error(errors.join("；"));
  const workspace = createWalkTalkStructWorkspace(project.structIds);
  const root = workspace.createDefault(project.structIds.sequence);
  for (const entry of project.entries) {
    const dialogue = workspace.createDefault(project.structIds.dialogue);
    for (const key of WALK_TALK_FIELDS) {
      dialogue.value[key].setValue(key === "params" ? parseWalkTalkParams(entry.params)
        : key === "continueDelay" ? parseWalkTalkFloat(entry[key]) : entry[key]);
    }
    root.value.datas.appendItem(dialogue);
  }
  if (root.issues.length) throw new Error(`边走边说结构体校验失败：${root.issues.map(issue => issue.message).join("；")}`);
  return { value: root.toQxqyValue(), json: root.serialize(2) };
}
