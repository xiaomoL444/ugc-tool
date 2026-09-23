import { Position } from "@vue-flow/core";
import { readRuntime, assertImport } from "../../runtimeImport";
import { DEFAULT_QXQY_STRUCT_IDS, createQxqyStructWorkspace } from "./qxqyStructWorkspace";
import { createEmptyDialogueProject, createDialogueNode, createDialogueClip, createSelectClip, createSelectOption, createFocusPushClip, createConditionBranchNode, createConditionBranchOutput, createPerformanceLine, createPerformanceClip } from "./dialogueProject";
import { resolveGroupOutlets, FOCUS_PUSH_OUTLET_ID } from "./groupOutlets";
import { exportQxqyPerformance } from "./qxqyPerformanceExporter";
import { getFlowClipDuration } from "./groupTimeline";

function table(entries: any[]) {
  const result = new Map<number, any>();
  for (const entry of entries) {
    const bucket = Number(entry.key);
    assertImport(Number.isInteger(bucket) && bucket >= 0 && bucket < 100, "演出数据表的桶键必须在 0–99 之间");
    entry.value.forEach((value: any, index: number) => result.set(bucket * 100 + index, value));
  }
  return new Map([...result].sort((a, b) => a[0] - b[0]));
}

export function importQxqyPerformance(text: string) {
  const { data, ids } = readRuntime(text, DEFAULT_QXQY_STRUCT_IDS, DEFAULT_QXQY_STRUCT_IDS.performance, createQxqyStructWorkspace(DEFAULT_QXQY_STRUCT_IDS));
  const project = createEmptyDialogueProject(); project.exportSettings.qxqyStructIds = ids;
  const groups = table(data.ActionGroup);
  const tables = { NOLOC_DIALOG: table(data.DialogueData), NOLOC_DIALOG_SELECT: table(data.DialogueSelectData), NOLOC_CAMERA: table(data.CameraMovementData) };
  const referenced = new Set<string>();
  assertImport(!groups.size || groups.has(0), "演出缺少入口 Group 0");
  const nodeIds = new Map([...groups.keys()].map(index => [index, `import-group-${index}-${crypto.randomUUID()}`]));
  const warnings = ["运行时 JSON 不含画布位置、节点名称和预设编辑元数据；节点已重新排列，公共事件参数按类型还原。"];
  let order = 0;
  for (const [index, group] of groups) {
    const timers = new Map<string, number>(group.Timer.map((item: any) => [String(Number(item.key)), Number(item.value)]));
    assertImport(timers.size === group.ActionClip.length, `Group ${index} 的 Timer 与 ActionClip 数量不一致`);
    const actions = group.ActionClip.flatMap((bucket: any) => {
      const time = timers.get(String(Number(bucket.key)));
      assertImport(time !== undefined && time >= 0, `Group ${index} 缺少有效触发时间`);
      return bucket.value.map((action: any) => ({ ...action, time }));
    });
    const id = nodeIds.get(index)!;
    const branch = actions.find((action: any) => action.actionType === "NOLOC_BRANCH");
    function params(action: any, allowed: string[]) {
      for (const key of Object.keys(action).filter(key => key.endsWith("Params"))) {
        assertImport(allowed.includes(key) || action[key].length === 0, `Group ${index} 的 ${action.actionType}.${key} 暂不支持还原，未导入`);
      }
    }
    if (branch) {
      assertImport(actions.length === 1 && branch.time === 0 && Number(branch.duration) === 0, `Group ${index} 的混合/延迟分支暂不支持还原`);
      params(branch, ["stringParams"]);
      assertImport(branch.stringParams.length === group.NextGroup.length, `Group ${index} 分支表达式与出口数量不一致`);
      const node = createConditionBranchNode(id); node.name = `分支 ${index}`;
      node.outputs = branch.stringParams.map((condition: string, i: number) => ({ ...createConditionBranchOutput(i), condition }));
      project.dialogue.conditionBranches[id] = node;
    } else {
      const node = createDialogueNode(id); node.name = `Group ${index}`; node.dialogue = undefined; node.lines = []; node.timeline.duration = 0.1;
      for (const action of actions) {
        const duration = Number(action.duration);
        assertImport(duration >= 0, `Group ${index} 的动作时长不能为负数`);
        node.timeline.duration = Math.max(node.timeline.duration, action.time + duration);
        if (action.actionType in tables) {
          params(action, ["intParams"]);
          assertImport(action.intParams.length === 1, `Group ${index} 的数据引用必须为一个索引`);
          const source = tables[action.actionType as keyof typeof tables].get(Number(action.intParams[0]));
          assertImport(source, `Group ${index} 引用不存在的 ${action.actionType} 数据 ${action.intParams[0]}`);
          referenced.add(`${action.actionType}:${Number(action.intParams[0])}`);
          if (action.actionType === "NOLOC_DIALOG") {
            assertImport(!node.dialogue, `Group ${index} 有多个台词 Clip，当前编辑器不能无损还原`);
            const delay = Number(source.continueDelay);
            assertImport(delay === -1 || delay >= 0, "台词推进延迟只能为 -1 或非负数");
            node.dialogue = { ...createDialogueClip(), style: source.style, speaker: source.talker, subtitle: source.subtitle, content: source.content, nodeGraphEvent: source.prams,
              startTime: action.time, advanceMode: delay === -1 ? "None" : "PlayerInput", continueDelayTime: Math.max(0, delay) };
          } else if (action.actionType === "NOLOC_DIALOG_SELECT") {
            assertImport(!node.select && source.content.length === source.icons.length && !source.params.length, `Group ${index} 的选项数据无法无损还原（重复 Clip、列表不匹配或含额外 params）`);
            node.select = { ...createSelectClip(), style: source.style, startTime: action.time, continueDelayTime: duration,
              options: source.content.map((content: string, i: number) => ({ ...createSelectOption(), content, icon: Number(source.icons[i]) })) };
          } else {
            assertImport(Number(source.duration) === duration, `Group ${index} 镜头时长与 ActionClip 不一致`);
            const line = createPerformanceLine("Camera"), clip = createPerformanceClip("Camera", action.time);
            clip.duration = duration; clip.components[0].properties = source;
            // Numeric editor properties must be numbers, GUID/config identifiers remain strings.
            const convert = (value: any, key = ""): any => Array.isArray(value) ? value.map(item => convert(item)) : value && typeof value === "object"
              ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, convert(item, name)]))
              : key === "space" ? Number(value) : value;
            clip.components[0].properties = convert(source); line.clips.push(clip); node.lines.push(line);
          }
        } else if (action.actionType === "NOLOC_FOCUSPUSH") {
          params(action, ["stringParams", "intParams"]);
          assertImport(!node.focusPush && duration === 0 && action.stringParams.length === 1 && action.intParams.length === 1 && ["NOLOC_Shared", "NOLOC_Self"].includes(action.stringParams[0]), `Group ${index} 的 Focus Push 参数不匹配`);
          node.focusPush = { ...createFocusPushClip(action.time), outputMode: action.stringParams[0] === "NOLOC_Shared" ? "Shared" : "Self", sharedOutletIndex: Number(action.intParams[0]) };
        } else if (["NOLOC_TRIGGERCUSTOME", "NOLOC_TRIGGERPUBLIC"].includes(action.actionType)) {
          const publicEvent = action.actionType === "NOLOC_TRIGGERPUBLIC";
          if (!publicEvent) { params(action, ["stringParams"]); assertImport(duration === 0 && action.stringParams.length === 1, "Custom 触发参数不匹配"); }
          assertImport(action.stringParams.length >= 1, "公共事件缺少事件名");
          const line = createPerformanceLine(publicEvent ? "PublicEvent" : "Custom"), clip = createPerformanceClip(line.type, action.time);
          clip.duration = duration; clip.components[0].properties.value = action.stringParams[0];
          if (publicEvent) {
            const types: Record<string, string> = { stringParams: "String", intParams: "Int32", guidParams: "Guid", configParams: "ConfigReference", prefabParams: "EntityReference", floatParams: "Float" };
            params(action, Object.keys(types));
            clip.components[0].properties.parameters = Object.entries(types).flatMap(([field, type]) => (field === "stringParams" ? action[field].slice(1) : action[field] ?? []).map((value: string, i: number) => ({ id: crypto.randomUUID(), name: `${type} ${i + 1}`, type, value })));
          }
          line.clips.push(clip); node.lines.push(line);
        } else throw new Error(`Group ${index} 包含尚不支持的动作 ${action.actionType}，未导入`);
      }
      node.timeline.maxLines = Math.max(8, node.lines.length + 3);
      if (node.dialogue) {
        const action = actions.find((item: any) => item.actionType === "NOLOC_DIALOG");
        assertImport(Number(getFlowClipDuration(node, node.dialogue).toFixed(2)) === Number(action.duration), `Group ${index} 的台词结束时间与其他 Clip 冲突，无法按当前 Timeline 模型无损还原`);
      }
      const outlets = resolveGroupOutlets(node).outlets;
      assertImport(outlets.length === group.NextGroup.length, `Group ${index} 的出口数量与 NextGroup 不一致`);
      if (node.focusPush) assertImport(node.focusPush.sharedOutletIndex >= 0 && node.focusPush.sharedOutletIndex < outlets.length && (node.focusPush.outputMode === "Shared" || outlets[node.focusPush.sharedOutletIndex]?.id === FOCUS_PUSH_OUTLET_ID), `Group ${index} 的强制推进出口不匹配`);
      project.dialogue.nodes[id] = node;
    }
    project.graph.nodes.push({ id, type: branch ? "condition" : "group", position: { x: 440 + (order % 4) * 420, y: 80 + Math.floor(order++ / 4) * 300 },
      data: branch ? { conditionBranchNodeId: id } : { dialogueNodeId: id }, sourcePosition: Position.Right, targetPosition: Position.Left });
  }
  for (const [index, group] of groups) {
    const source = nodeIds.get(index)!;
    const outlets = project.dialogue.conditionBranches[source]?.outputs ?? resolveGroupOutlets(project.dialogue.nodes[source]).outlets;
    group.NextGroup.forEach((targetText: string, slot: number) => {
      const targetIndex = Number(targetText); if (targetIndex === -1) return;
      assertImport(nodeIds.has(targetIndex) && targetIndex !== index, `Group ${index} 的目标 ${targetText} 无效或为自连`);
      project.graph.edges.push({ id: crypto.randomUUID(), source, sourceHandle: outlets[slot].id, target: nodeIds.get(targetIndex)!, targetHandle: "input" });
    });
  }
  if (groups.size) project.graph.edges.unshift({ id: crypto.randomUUID(), source: project.dialogue.entryNodeId!, sourceHandle: "output", target: nodeIds.get(0)!, targetHandle: "input" });
  for (const [type, values] of Object.entries(tables)) assertImport([...values.keys()].every(index => referenced.has(`${type}:${index}`)), `${type} 表含未被 Clip 引用的数据，无法无损还原`);
  exportQxqyPerformance(project); // Validate editor-side values before any storage mutation.
  return { project, warnings };
}
