import { compilePublicEventArguments } from "./publicEventParameters";
import {
  VariableValue,
  VariableWorkspace,
  type QxqyParamNode,
} from "miliastra-variable";
import type {
  DialogueClip,
  DialogueNode,
  PerformanceClip,
  PerformanceLine,
  SelectClip,
} from "../types/DialogueNode";
import type { ConditionBranchNode } from "../types/ConditionBranchNode";
import type {
  DialogueProject,
  QxqyStructIds,
} from "../types/FileStruct";
import {
  CONDITION_BRANCH_ACTION_TYPE,
  FOCUS_PUSH_ACTION_TYPE,
  CUSTOM_TRIGGER_ACTION_TYPE,
  PUBLIC_EVENT_ACTION_TYPE,
  getQxqyActionMapping,
  type QxqyActionMapping,
  type QxqyActionSource,
  type QxqyDataField,
} from "../config/qxqyActionRegistry";
import {
  createQxqyStructWorkspace,
  validateQxqyStructIds,
} from "./qxqyStructWorkspace";
import {
  edgeMatchesOutlet,
  FOCUS_PUSH_OUTLET_ID,
  getGroupOutletWarnings,
  resolveGroupOutlets,
} from "./groupOutlets";
import { getFlowClipDuration } from "./groupTimeline";

const MAX_STRUCT_LIST_ITEMS = 100;

type SourceClip =
  | { source: "FocusPush"; startTime: number; duration: number; node: DialogueNode; focusPush: true }
  | {
      source: "Dialogue";
      startTime: number;
      duration: number;
      node: DialogueNode;
      dialogue: DialogueClip;
    }
  | {
      source: "DialogueSelect";
      startTime: number;
      duration: number;
      node: DialogueNode;
      select: SelectClip;
    }
  | {
      source: string;
      startTime: number;
      duration: number;
      node: DialogueNode;
      line: PerformanceLine;
      clip: PerformanceClip;
    };

export interface QxqyPerformanceExportResult {
  value: unknown;
  json: string;
  /** 普通 Group 和条件节点共用的 ActionGroup 全局序号顺序。 */
  groupOrder: string[];
  warnings: string[];
}

interface TimedActionBucket {
  /** 与 Timer 字典中的值一致，已经按千星 Float 精度格式化。 */
  startTime: string;
  actionClips: VariableValue[];
}

/** 将编辑器业务数据编译为可被千星奇域重新导入的 [演出]演出 结构体。 */
export function exportQxqyPerformance(
  project: DialogueProject,
): QxqyPerformanceExportResult {
  const structIds = project.exportSettings.qxqyStructIds;
  const configurationErrors = validateQxqyStructIds(structIds);
  if (configurationErrors.length) {
    throw new Error(configurationErrors.join("；"));
  }

  const workspace = createQxqyStructWorkspace(structIds);
  const root = workspace.createDefault(structIds.performance);
  const warnings: string[] = [];
  const groupOrder = resolveGroupOrder(project, warnings);
  const groupIndex = new Map(groupOrder.map((id, index) => [id, index]));
  const dataTables: Record<QxqyDataField, VariableValue[]> = {
    DialogueData: [],
    DialogueSelectData: [],
    CameraMovementData: [],
  };


  const actionGroups = groupOrder.map((nodeId) => {
    const node = getExportNode(project, nodeId)!;
    // 每个出口占据一个固定槽位，空连接不能过滤或合并重复目标。
    const nextGroups = outgoingTargets(project, nodeId).map((targetId) =>
      targetId === undefined ? -1 : groupIndex.get(targetId) ?? -1,
    );
    if (nextGroups.length > MAX_STRUCT_LIST_ITEMS) {
      throw new Error(
        `节点「${node.name}」有 ${nextGroups.length} 个出口，NextGroup 列表最多支持 ${MAX_STRUCT_LIST_ITEMS} 项，请减少出口数量。`,
      );
    }
    if (node.nodeType === "ConditionBranch") {
      if (!node.outputs.length) warnings.push(`条件分支「${node.name}」没有出口。`);
      return compileConditionBranch(workspace, node, nextGroups, structIds);
    }
    warnings.push(
      ...getGroupOutletWarnings(node).map(
        (warning) => `Group「${node.name}」：${warning}`,
      ),
    );
    const focusPushIndex = node.focusPush?.outputMode === "Shared"
      ? node.focusPush.sharedOutletIndex
      : resolveGroupOutlets(node).outlets.findIndex(
          (outlet) => outlet.id === FOCUS_PUSH_OUTLET_ID,
        );
    if (node.focusPush && (!Number.isInteger(focusPushIndex) ||
        focusPushIndex < 0 || focusPushIndex >= nextGroups.length)) {
      throw new Error(`Group「${node.name}」的 Focus Push 共用出口不可用，请重新选择出口。`);
    }
    return compileActionGroup(
      workspace,
      node,
      nextGroups,
      focusPushIndex,
      dataTables,
      warnings,
      structIds,
    );
  });

  writeChunkedStructTable(
    workspace,
    root.value.ActionGroup,
    actionGroups,
    structIds.actionGroup,
  );
  writeChunkedStructTable(
    workspace,
    root.value.DialogueData,
    dataTables.DialogueData,
    structIds.dialogue,
  );
  writeChunkedStructTable(
    workspace,
    root.value.DialogueSelectData,
    dataTables.DialogueSelectData,
    structIds.select,
  );
  writeChunkedStructTable(
    workspace,
    root.value.CameraMovementData,
    dataTables.CameraMovementData,
    structIds.camera,
  );

  const value = root.toQxqyValue();
  return {
    value,
    json: root.serialize(2),
    groupOrder,
    warnings,
  };
}

function compileConditionBranch(
  workspace: VariableWorkspace,
  node: ConditionBranchNode,
  nextGroups: number[],
  structIds: QxqyStructIds,
) {
  const group = workspace.createDefault(structIds.actionGroup);
  const actionClip = workspace.createDefault(structIds.actionClip);
  actionClip.value.actionType.setValue(CONDITION_BRANCH_ACTION_TYPE);
  actionClip.value.duration.setValue("0.00");
  actionClip.value.stringParams.setValue(node.outputs.map((output) => output.condition));
  actionClip.value.intParams.setValue([]);
  writeTimedActionTable(
    workspace,
    group.value.ActionClip,
    group.value.Timer,
    [{ startTime: "0.00", actionClips: [actionClip] }],
    structIds.actionClip,
  );
  group.value.NextGroup.setValue(nextGroups.map(String));
  return group;
}

function compileActionGroup(
  workspace: VariableWorkspace,
  node: DialogueNode,
  nextGroups: number[],
  focusPushIndex: number,
  dataTables: Record<QxqyDataField, VariableValue[]>,
  warnings: string[],
  structIds: QxqyStructIds,
) {
  const group = workspace.createDefault(structIds.actionGroup);
  const sourceClips = collectSourceClips(node);
  const timedActions: TimedActionBucket[] = [];

  for (const sourceClip of sourceClips) {
    if ("focusPush" in sourceClip) {
      const actionClip = workspace.createDefault(structIds.actionClip);
      actionClip.value.actionType.setValue(FOCUS_PUSH_ACTION_TYPE);
      actionClip.value.duration.setValue("0.00");
      actionClip.value.stringParams.setValue([
        node.focusPush?.outputMode === "Shared" ? "NOLOC_Shared" : "NOLOC_Self",
      ]);
      // 保存 Focus Push 出口在 NextGroup 中的零基索引，目标由对应槽位解析。
      actionClip.value.intParams.setValue([String(focusPushIndex)]);
      appendTimedAction(timedActions, sourceClip.startTime, actionClip);
      continue;
    }
    if ((sourceClip.source === "Custom" || sourceClip.source === "PublicEvent") && "clip" in sourceClip) {
      const isPublicEvent = sourceClip.source === "PublicEvent";
      const templateId = isPublicEvent ? "public.event" : "custom.data";
      const config = sourceClip.clip.components.find(component => component.templateId === templateId && component.enabled);
      const value = config?.properties.value ?? "";
      if (typeof value !== "string") {
        throw new Error(`Group「${node.name}」${sourceClip.source}「${sourceClip.clip.name}」的触发参数必须是字符串。`);
      }
      const actionClip = workspace.createDefault(structIds.actionClip);
      actionClip.value.actionType.setValue(isPublicEvent ? PUBLIC_EVENT_ACTION_TYPE : CUSTOM_TRIGGER_ACTION_TYPE);
      actionClip.value.duration.setValue(isPublicEvent ? formatFloat(sourceClip.duration) : "0.00");
      if (isPublicEvent) {
        const lists = compilePublicEventArguments(value, config?.properties.parameters);
        for (const [field, values] of Object.entries(lists)) actionClip.value[field].setValue(values);
      } else {
        actionClip.value.stringParams.setValue([value]);
        actionClip.value.intParams.setValue([]);
      }
      appendTimedAction(timedActions, sourceClip.startTime, actionClip);
      continue;
    }
    const mapping = getQxqyActionMapping(sourceClip.source as QxqyActionSource);
    if (!mapping) {
      warnings.push(
        `Group「${node.name}」中的 ${sourceClip.source} Clip 尚未注册千星 Action 映射，已跳过。`,
      );
      continue;
    }

    const dataValue = createActionData(
      workspace,
      mapping,
      sourceClip,
      structIds,
    );
    const dataIndex = dataTables[mapping.dataField].push(dataValue) - 1;
    appendTimedAction(
      timedActions,
      sourceClip.startTime,
      createActionClip(
        workspace,
        mapping,
        sourceClip.duration,
        dataIndex,
        structIds,
      ),
    );
  }

  writeTimedActionTable(
    workspace,
    group.value.ActionClip,
    group.value.Timer,
    timedActions,
    structIds.actionClip,
  );
  group.value.NextGroup.setValue(nextGroups.map(String));
  return group;
}

/**
 * Timer[n] 是第 n 个触发时间，ActionClip[n] 则是该时间触发的全部事件。
 * 同一时间超过千星 StructList 的 100 项上限时，拆成多个相同 Timer 值的槽。
 */
function appendTimedAction(
  buckets: TimedActionBucket[],
  startTime: number,
  actionClip: VariableValue,
) {
  const formattedStartTime = formatFloat(startTime);
  const lastBucket = buckets[buckets.length - 1];
  const bucket =
    lastBucket &&
    lastBucket.startTime === formattedStartTime &&
    lastBucket.actionClips.length < MAX_STRUCT_LIST_ITEMS
      ? lastBucket
      : undefined;

  if (bucket) {
    bucket.actionClips.push(actionClip);
    return;
  }

  buckets.push({ startTime: formattedStartTime, actionClips: [actionClip] });
}

function writeTimedActionTable(
  workspace: VariableWorkspace,
  actionDictionary: VariableValue,
  timerDictionary: VariableValue,
  buckets: TimedActionBucket[],
  actionClipStructId: string,
) {
  clearCollection(actionDictionary);
  clearCollection(timerDictionary);

  buckets.forEach((bucket, index) => {
    const structList = createStructList(workspace, actionClipStructId);
    bucket.actionClips.forEach((actionClip) =>
      structList.appendItem(actionClip),
    );
    const key = String(index);
    actionDictionary.appendItem({ key, value: structList });
    timerDictionary.appendItem({ key, value: bucket.startTime });
  });
}

function collectSourceClips(node: DialogueNode): SourceClip[] {
  let registrationOrder = 0;
  const clips: Array<SourceClip & { registrationOrder: number }> = [];

  if (node.dialogue) {
    clips.push({
      source: "Dialogue",
      startTime: node.dialogue.startTime,
      duration: getFlowClipDuration(node, node.dialogue),
      node,
      dialogue: node.dialogue,
      registrationOrder: registrationOrder++,
    });
  }

  if (node.select) {
    clips.push({
      source: "DialogueSelect",
      startTime: node.select.startTime,
      // SelectData 没有 continueDelay 字段，内部延迟写入 ActionClip.duration。
      duration: node.select.continueDelayTime,
      node,
      select: node.select,
      registrationOrder: registrationOrder++,
    });
  }

  if (node.focusPush) {
    clips.push({
      source: "FocusPush", startTime: node.focusPush.startTime, duration: 0,
      node, focusPush: true, registrationOrder: registrationOrder++,
    });
  }

  for (const line of node.lines) {
    for (const clip of line.clips) {
      clips.push({
        source: clip.type || line.type,
        startTime: clip.startTime,
        duration: clip.duration,
        node,
        line,
        clip,
        registrationOrder: registrationOrder++,
      });
    }
  }

  return clips
    .sort(
      (left, right) =>
        left.startTime - right.startTime ||
        left.registrationOrder - right.registrationOrder,
    )
    .map(({ registrationOrder: _registrationOrder, ...clip }) => clip);
}

function createActionClip(
  workspace: VariableWorkspace,
  mapping: QxqyActionMapping,
  duration: number,
  dataIndex: number,
  structIds: QxqyStructIds,
) {
  const actionClip = workspace.createDefault(structIds.actionClip);
  actionClip.value.actionType.setValue(mapping.actionType);
  actionClip.value.duration.setValue(formatFloat(duration));
  actionClip.value.stringParams.setValue(
    mapping.referenceParam === "stringParams" ? [String(dataIndex)] : [],
  );
  actionClip.value.intParams.setValue(
    mapping.referenceParam === "intParams" ? [String(dataIndex)] : [],
  );
  return actionClip;
}

function createActionData(
  workspace: VariableWorkspace,
  mapping: QxqyActionMapping,
  sourceClip: SourceClip,
  structIds: QxqyStructIds,
) {
  const data = workspace.createDefault(structIds[mapping.dataStructKey]);

  if (mapping.dataField === "DialogueData" && "dialogue" in sourceClip) {
    data.value.style.setValue(sourceClip.dialogue.style);
    data.value.talker.setValue(sourceClip.dialogue.speaker);
    data.value.subtitle.setValue(sourceClip.dialogue.subtitle);
    data.value.content.setValue(sourceClip.dialogue.content);
    data.value.continueDelay.setValue(
      sourceClip.dialogue.advanceMode === "PlayerInput"
        ? formatFloat(sourceClip.dialogue.continueDelayTime)
        : "-1.00",
    );
    const params = sourceClip.dialogue.nodeGraphEvent;
    if (params.length > MAX_STRUCT_LIST_ITEMS) throw new Error("对话入参最多 100 项。");
    data.value.prams.setValue(params.map((value, index) => {
      const text = value.trim().replace(/^\+/, "");
      if (!isInt32String(text)) throw new Error(`对话「${sourceClip.dialogue.content}」的第 ${index + 1} 个入参必须是 Int32 整数。`);
      return String(Number(text));
    }));
    return data;
  }

  if (mapping.dataField === "DialogueSelectData" && "select" in sourceClip) {
    data.value.style.setValue(sourceClip.select.style);
    data.value.content.setValue(
      sourceClip.select.options.map((option) => option.content),
    );
    data.value.icons.setValue(
      sourceClip.select.options.map((option) => String(option.icon)),
    );
    data.value.params.setValue([]);
    return data;
  }

  if (mapping.dataField === "CameraMovementData" && "clip" in sourceClip) {
    // 从 CameraClip 的内嵌默认值出发；它与独立 PositionData 的默认值不同。
    // 开始时间仅由 Timer 排程，新版 CameraClip 没有 delay 字段。
    writeCameraValue(
      data,
      {
        ...flattenComponentProperties(sourceClip.clip),
        duration: formatFloat(sourceClip.duration),
      },
      `Group「${sourceClip.node.name}」镜头「${sourceClip.clip.name}」`,
    );
  }

  return data;
}

function flattenComponentProperties(clip: PerformanceClip) {
  return clip.components.reduce<Record<string, unknown>>((result, component) => {
    if (component.enabled) {
      Object.assign(result, component.properties);
      if (component.templateId === "camera.shot" && component.cameraViewpointEnabled === false) {
        result.rotationData = { type: "", slot: [], snapToTarget: false };
      }
    }
    return result;
  }, {});
}

/** 按结构体定义顺序递归写入，保留字段类型、嵌套 ID 和未填写字段的默认值。 */
function writeCameraValue(target: VariableValue, value: unknown, path: string) {
  if (value === undefined) return;

  if (target.type === "Struct") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${path} 必须是结构体参数对象。`);
    }
    const source = value as Record<string, unknown>;
    for (const [key, field] of Object.entries(target.value)) {
      writeCameraValue(field as VariableValue, source[key], `${path}.${key}`);
    }
    return;
  }

  if (target.type === "StructList") {
    if (!Array.isArray(value)) throw new Error(`${path} 必须是列表。`);
    if (value.length > MAX_STRUCT_LIST_ITEMS) {
      throw new Error(
        `${path} 有 ${value.length} 项，千星结构体列表最多支持 ${MAX_STRUCT_LIST_ITEMS} 项，请减少目标点数量。`,
      );
    }
    const structId = target.structId;
    if (!structId) throw new Error(`${path} 缺少结构体 ID。`);
    clearCollection(target);
    value.forEach((item, index) => {
      const slot = target.workspace.createDefault(structId);
      if (item === undefined) throw new Error(`${path}[${index}] 缺少目标点参数。`);
      writeCameraValue(slot, item, `${path}[${index}]`);
      target.appendItem(slot);
    });
    return;
  }

  const invalid = () => new Error(`${path} 的值不符合 ${target.type} 类型。`);
  if (target.type === "String") {
    if (typeof value !== "string") throw invalid();
    target.setValue(value);
    return;
  }
  if (target.type === "Bool") {
    if (value !== true && value !== false && value !== "True" && value !== "False") {
      throw invalid();
    }
    target.setValue(value === true || value === "True" ? "True" : "False");
    return;
  }

  const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (target.type === "Vector3") {
    if (typeof value !== "string") throw invalid();
    const components = value.split(",").map((component) => component.trim());
    if (
      components.length !== 3 ||
      components.some((component) =>
        !numberPattern.test(component) || !Number.isFinite(Number(component)),
      )
    ) throw invalid();
    target.setValue(components.join(","));
    return;
  }

  if (typeof value !== "number" && typeof value !== "string") throw invalid();
  const text = String(value).trim();
  if (target.type === "Float") {
    if (!numberPattern.test(text) || !Number.isFinite(Number(text))) throw invalid();
  } else if (target.type === "Int32" || target.type === "Guid") {
    if (!/^[+-]?\d+$/.test(text)) throw invalid();
    // Guid 以字符串保存；拒绝已经被 JS Number 舍入的大整数。
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw invalid();
    if (target.type === "Int32" && !isInt32String(text.replace(/^\+/, ""))) {
      throw invalid();
    }
  } else {
    throw new Error(`${path} 尚不支持 ${target.type} 类型的运镜参数。`);
  }
  target.setValue(text);
}

function writeChunkedStructTable(
  workspace: VariableWorkspace,
  dictionary: VariableValue,
  items: VariableValue[],
  structId: string,
) {
  clearCollection(dictionary);
  for (let offset = 0; offset < items.length; offset += MAX_STRUCT_LIST_ITEMS) {
    const chunkIndex = Math.floor(offset / MAX_STRUCT_LIST_ITEMS);
    const structList = createStructList(workspace, structId);
    for (const item of items.slice(offset, offset + MAX_STRUCT_LIST_ITEMS)) {
      structList.appendItem(item);
    }
    dictionary.appendItem({ key: String(chunkIndex), value: structList });
  }
}

function createStructList(workspace: VariableWorkspace, structId: string) {
  return workspace.parse({
    param_type: "StructList",
    value: {
      structId,
      value: [],
    },
  } as QxqyParamNode);
}

function clearCollection(collection: VariableValue) {
  while (collection.itemCount) collection.removeItem(collection.itemCount - 1);
}

function resolveGroupOrder(project: DialogueProject, warnings: string[]) {
  const graphNodeIds = project.graph.nodes
    .filter(
      (node) =>
        (node.type === "group" || node.type === "condition") &&
        Boolean(getExportNode(project, node.id)),
    )
    .map((node) => node.id);
  const entryId =
    project.dialogue.entryNodeId ??
    project.graph.nodes.find((node) => node.type === "entry")?.id;
  const entryTargets = entryId ? outgoingTargets(project, entryId) : [];
  const ordered: string[] = [];
  const visited = new Set<string>();

  function visit(nodeId: string) {
    if (visited.has(nodeId) || !getExportNode(project, nodeId)) return;
    visited.add(nodeId);
    ordered.push(nodeId);
    for (const targetId of outgoingTargets(project, nodeId)) {
      if (targetId !== undefined) visit(targetId);
    }
  }

  if (entryTargets[0]) {
    visit(entryTargets[0]);
    for (const extraTarget of entryTargets.slice(1)) {
      if (extraTarget !== undefined) visit(extraTarget);
    }
  } else if (graphNodeIds.length) {
    warnings.push("开始节点尚未连接 Group 或条件分支，暂按画布节点注册顺序导出。");
  }

  for (const nodeId of graphNodeIds) {
    if (!visited.has(nodeId)) {
      warnings.push(`节点「${getExportNode(project, nodeId)!.name}」未连接到开始流程，已追加到末尾。`);
      visit(nodeId);
    }
  }
  for (const nodeId of [
    ...Object.keys(project.dialogue.nodes),
    ...Object.keys(project.dialogue.conditionBranches),
  ]) {
    if (!visited.has(nodeId)) {
      warnings.push(`节点「${getExportNode(project, nodeId)!.name}」缺少画布节点，已追加到末尾。`);
      visit(nodeId);
    }
  }
  return ordered;
}

function getExportNode(
  project: DialogueProject,
  nodeId: string,
): DialogueNode | ConditionBranchNode | undefined {
  return project.dialogue.nodes[nodeId] ?? project.dialogue.conditionBranches[nodeId];
}

function outgoingTargets(
  project: DialogueProject,
  sourceId: string,
): Array<string | undefined> {
  const sourceNode = getExportNode(project, sourceId);

  // 普通 Group、选项卡和条件分支统一按 UI 出口顺序返回，包含空位。
  if (sourceNode) {
    const outlets = sourceNode.nodeType === "ConditionBranch"
      ? sourceNode.outputs
      : resolveGroupOutlets(sourceNode).outlets;
    return outlets.map((outlet) => {
      let connectedEdge: DialogueProject["graph"]["edges"][number] | undefined;
      for (const edge of project.graph.edges) {
        if (
          edge.source === sourceId &&
          (sourceNode.nodeType === "ConditionBranch"
            ? edge.sourceHandle === outlet.id
            : edgeMatchesOutlet(edge, outlet.id))
        ) {
          connectedEdge = edge;
        }
      }
      return connectedEdge &&
        connectedEdge.target !== sourceId &&
        getExportNode(project, connectedEdge.target)
        ? connectedEdge.target
        : undefined;
    });
  }

  // 开始节点没有 Timeline，只保留原本的画布连线顺序。
  const targets: string[] = [];
  for (const edge of project.graph.edges) {
    if (
      edge.source === sourceId &&
      edge.target !== sourceId &&
      getExportNode(project, edge.target) &&
      !targets.includes(edge.target)
    ) {
      targets.push(edge.target);
    }
  }
  return targets;
}

function formatFloat(value: number) {
  return (Number.isFinite(value) ? Math.max(0, value) : 0).toFixed(2);
}

function isInt32String(value: string) {
  return /^-?\d+$/.test(value) && Number(value) >= -2147483648 && Number(value) <= 2147483647;
}
