import { Edge, Node } from "@vue-flow/core";
import { DialogueNode } from "./DialogueNode";
import { ConditionBranchNode } from "./ConditionBranchNode";

export interface DialogueProject {
  schemaVersion: 12;
  exportSettings: DialogueExportSettings;
  dialogue: DialogueDocument;
  graph: FlowLayout;
}

/** 对话工程自己的导出目标；不同千星编辑器可以使用不同的结构体 ID。 */
export interface DialogueExportSettings {
  qxqyStructIds: QxqyStructIds;
}

export interface QxqyStructIds {
  performance: string;
  actionGroup: string;
  actionClip: string;
  dialogue: string;
  select: string;
  camera: string;
  cameraPosition: string;
  cameraRotation: string;
  cameraSlot: string;
}

export type QxqyStructIdKey = keyof QxqyStructIds;

/** 与画布实现无关的对话业务数据。 */
export interface DialogueDocument {
  tree: unknown;
  entryNodeId?: string;
  nodes: Record<string, DialogueNode>;
  conditionBranches: Record<string, ConditionBranchNode>;
}

/** Vue Flow 节点只保存业务节点引用，不再承载对话内容。 */
export interface FlowNodeData {
  dialogueNodeId?: string;
  conditionBranchNodeId?: string;
}

export interface FlowLayout {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}
