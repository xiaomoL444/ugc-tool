import type { PerformanceLineType } from "../types/DialogueNode";
import type { QxqyStructIdKey } from "../types/FileStruct";

/** 分支直接在 ActionClip 中保存表达式，不引用独立的数据结构体表。 */
export const CONDITION_BRANCH_ACTION_TYPE = "NOLOC_BRANCH";

export type QxqyActionSource =
  | "Dialogue"
  | "DialogueSelect"
  | PerformanceLineType;

export type QxqyDataField =
  | "DialogueDate"
  | "DialogueSelectData"
  | "CameraMovementDate";

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
  dataField: "DialogueDate",
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
  dataField: "CameraMovementDate",
  dataStructKey: "camera",
  referenceParam: "intParams",
});
