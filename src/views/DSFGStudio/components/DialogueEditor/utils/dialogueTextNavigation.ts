import type { DialogueProject } from "../types/FileStruct";
import type { TextPreviewBlock } from "./dialogueTextPreview";

export interface TextPreviewNavigationTarget {
  nodeId: string;
  kind: TextPreviewBlock["kind"];
}

/** 合并卡片中的台词属于各自的 Group，出口属于卡片末尾的节点。 */
export function getTextPreviewNavigationTarget(
  block: TextPreviewBlock,
  lineNodeId?: string,
  outlet = false,
): TextPreviewNavigationTarget | undefined {
  const nodeId = lineNodeId !== undefined
    ? block.lines.find((line) => line.nodeId === lineNodeId)?.nodeId
    : outlet ? block.nodeIds[block.nodeIds.length - 1] : block.nodeIds[0];
  return nodeId === undefined ? undefined : { nodeId, kind: block.kind };
}

/** 预览使用业务 ID；定位必须找到原图中对应的可见节点，不能直接拿业务 ID 当画布 ID。 */
export function resolveTextPreviewGraphNodeId(
  project: DialogueProject,
  target: TextPreviewNavigationTarget,
): string | undefined {
  return project.graph.nodes.find((node) => {
    if (node.hidden) return false;
    if (target.kind === "entry" || target.kind === "output") {
      return node.type === target.kind && node.id === target.nodeId;
    }
    if (target.kind === "condition") {
      return (node.type === "condition" || Boolean(node.data?.conditionBranchNodeId)) &&
        (node.data?.conditionBranchNodeId ?? node.id) === target.nodeId;
    }
    return node.type !== "entry" && node.type !== "output" &&
      node.type !== "condition" && !node.data?.conditionBranchNodeId &&
      (node.data?.dialogueNodeId ?? node.id) === target.nodeId;
  })?.id;
}
