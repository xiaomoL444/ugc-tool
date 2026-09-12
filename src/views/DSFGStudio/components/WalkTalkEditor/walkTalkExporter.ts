import { VariableWorkspace, type StructDefinition } from "miliastra-variable";
import dialogueDefinition from "@/assets/DSFGStudio/WalkTalk/1077936129对话节点.json";
import sequenceSample from "@/assets/DSFGStudio/WalkTalk/NOLOC_测试子结构体1077936131.json";
import {
  WALK_TALK_FIELDS, parseWalkTalkFloat, parseWalkTalkParams, validateWalkTalkProject, validateWalkTalkStructIds,
  type WalkTalkProject, type WalkTalkStructIds,
} from "./walkTalkProject";

export function createWalkTalkStructWorkspace(ids: WalkTalkStructIds) {
  const errors = validateWalkTalkStructIds(ids);
  if (errors.length) throw new Error(errors.join("；"));
  const list = sequenceSample.value[0];
  if (sequenceSample.value.length !== 1 || list.param_type !== "StructList") throw new Error("边走边说样例必须只有一个结构体列表字段。");
  // 外层样例不包含字段名；dialogues 仅为库内访问别名。输出仍是 ID + 有序值列表。
  const outer: StructDefinition = {
    type: "Struct", struct_ype: "basic", name: "边走边说",
    value: [{ key: "dialogues", param_type: "StructList", value: {
      param_type: "StructList", value: { structId: ids.dialogue, value: [] },
    } }],
  };
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
      dialogue.value[key].setValue(key === "prams" ? parseWalkTalkParams(entry.prams)
        : key === "continueDelay" || key === "autoContinue" ? parseWalkTalkFloat(entry[key]) : entry[key]);
    }
    root.value.dialogues.appendItem(dialogue);
  }
  if (root.issues.length) throw new Error(`边走边说结构体校验失败：${root.issues.map(issue => issue.message).join("；")}`);
  return { value: root.toQxqyValue(), json: root.serialize(2) };
}
