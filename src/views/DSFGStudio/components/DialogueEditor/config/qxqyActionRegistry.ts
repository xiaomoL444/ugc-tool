import type { PerformanceLineType } from "../types/DialogueNode";
import type { QxqyStructIdKey } from "../types/FileStruct";

/** 自定义触发字符串直接保存在 stringParams[0]。 */
export const CUSTOM_TRIGGER_ACTION_TYPE = "NOLOC_TRIGGERCUSTOME";

/** 公共事件字符串直接保存在 stringParams[0]。 */
export const PUBLIC_EVENT_ACTION_TYPE = "NOLOC_TRIGGERPUBLIC";

/** 强制跳过在 intParams[0] 保存出口对应的 NextGroup 零基索引。 */
export const FOCUS_PUSH_ACTION_TYPE = "NOLOC_FOCUSPUSH";

/** 分支直接在 ActionClip 中保存表达式，不引用独立的数据结构体表。 */
export const CONDITION_BRANCH_ACTION_TYPE = "NOLOC_BRANCH";

export type QxqyActionSource =
  | "Dialogue"
  | "DialogueSelect"
  | PerformanceLineType;

export type QxqyDataField =
  | "DialogueData"
  | "DialogueSelectData"
  | "CameraMovementData";

export interface QxqyActionMapping {
  source: QxqyActionSource;
  actionType: string;
  dataField: QxqyDataField;
  dataStructKey: Extract<QxqyStructIdKey, "dialogue" | "select" | "camera">;
  referenceParam: "intParams" | "stringParams";
}

const mappings = new Map<QxqyActionSource, QxqyActionMapping>();

/** 后续新增 Line/Clip Action 时，只需要向此表注册，不修改导出器。 */
export function registerQxqyActionMapping(mapping: QxqyActionMapping) {
  mappings.set(mapping.source, mapping);
}

export function getQxqyActionMapping(source: QxqyActionSource) {
  return mappings.get(source);
}

export function getQxqyActionMappings() {
  return [...mappings.values()];
}

registerQxqyActionMapping({
  source: "Dialogue",
  actionType: "NOLOC_DIALOG",
  dataField: "DialogueData",
  dataStructKey: "dialogue",
  referenceParam: "intParams",
});

registerQxqyActionMapping({
  source: "DialogueSelect",
  actionType: "NOLOC_DIALOG_SELECT",
  dataField: "DialogueSelectData",
  dataStructKey: "select",
  referenceParam: "intParams",
});

registerQxqyActionMapping({
  source: "Camera",
  actionType: "NOLOC_CAMERA",
  dataField: "CameraMovementData",
  dataStructKey: "camera",
  referenceParam: "intParams",
});
