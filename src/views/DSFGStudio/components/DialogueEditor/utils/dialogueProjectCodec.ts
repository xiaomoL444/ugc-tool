import type { Edge, Node } from "@vue-flow/core";
import type {
  DialogueProject,
  FlowNodeData,
} from "../types/FileStruct";
import {
  CURRENT_SCHEMA_VERSION,
  normalizeDialogueProject,
} from "./dialogueProject";

/**
 * 唯一的数据读取入口。未来的版本迁移、用户模板解析应集中放在这里。
 */
export function decodeDialogueProject(source: string | unknown) {
  const value = typeof source === "string" ? JSON.parse(source) : source;
  return normalizeDialogueProject(value);
}

/**
 * 移除 Vue Flow 注入的 dimensions、computedPosition、sourceNode 等运行时状态。
 */
export function toSerializableDialogueProject(
  project: DialogueProject,
): DialogueProject {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportSettings: JSON.parse(JSON.stringify(project.exportSettings)),
    // Vue 的 reactive Proxy 不能直接 structuredClone；JSON 往返可得到纯业务数据。
    dialogue: JSON.parse(JSON.stringify(project.dialogue)),
    graph: {
      nodes: project.graph.nodes.map(serializeNode),
      edges: project.graph.edges.map(serializeEdge),
    },
  };
}

/** 唯一的数据文本保存入口。 */
export function encodeDialogueProject(project: DialogueProject) {
  return JSON.stringify(toSerializableDialogueProject(project), null, 2);
}

function serializeNode(node: Node<FlowNodeData>): Node<FlowNodeData> {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data: node.data?.dialogueNodeId
      ? { dialogueNodeId: node.data.dialogueNodeId }
      : node.data?.conditionBranchNodeId
        ? { conditionBranchNodeId: node.data.conditionBranchNodeId }
        : {},
    sourcePosition: node.sourcePosition,
    targetPosition: node.targetPosition,
    deletable: node.deletable,
  };
}

function serializeEdge(edge: Edge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: edge.type,
    label: edge.label,
    data: edge.data,
  };
}
