import type { Edge } from "@vue-flow/core";
import type { DialogueNode } from "../types/DialogueNode";

export const DIALOGUE_OUTLET_ID = "next";

export type GroupOutletKind = "Dialogue" | "Select";

/** Timeline 中的流程 Clip 解析出的一个可连接出口。 */
export interface GroupOutlet {
  id: string;
  kind: GroupOutletKind;
  label: string;
  optionId?: string;
}

export interface GroupOutletState {
  outlets: GroupOutlet[];
  warnings: string[];
}

export function selectOutletId(optionId: string) {
  return `select:${optionId}`;
}

/**
 * 出口是 Timeline 业务数据的派生结果，不单独保存到节点图：
 * - “玩家按下”的 Dialogue 请求一个出口；
 * - Select 的每个选项按列表顺序请求一个出口。
 */
export function resolveGroupOutlets(node: DialogueNode): GroupOutletState {
  const outlets: GroupOutlet[] = [];
  const warnings: string[] = [];
  const requestingClips: string[] = [];

  if (node.dialogue?.advanceMode === "PlayerInput") {
    requestingClips.push("Dialogue Clip");
    outlets.push({
      id: DIALOGUE_OUTLET_ID,
      kind: "Dialogue",
      label: "玩家按下",
    });
  }

  if (node.select) {
    if (!node.select.options.length) {
      warnings.push("Select Clip 尚未添加选项，无法生成选项出口。");
    } else {
      requestingClips.push("Select Clip");
    }

    node.select.options.forEach((option, index) => {
      outlets.push({
        id: selectOutletId(option.id),
        kind: "Select",
        label: `选项 ${index + 1}`,
        optionId: option.id,
      });
    });
  }

  if (requestingClips.length > 1) {
    warnings.push(
      `${requestingClips.join(" 与 ")} 同时请求流程出口，请只保留一种推进方式。`,
    );
  }

  if (!outlets.length) {
    warnings.push(
      "当前 Group 没有出口；请将 Dialogue 设为“玩家按下”，或添加带选项的 Select Clip。",
    );
  }

  return { outlets, warnings };
}

/** 兼容旧文件中未显式保存 sourceHandle 的单一 Dialogue 出口。 */
export function normalizeSourceHandle(handle: string | null | undefined) {
  return handle ?? DIALOGUE_OUTLET_ID;
}

export function edgeMatchesOutlet(edge: Edge, outletId: string) {
  return normalizeSourceHandle(edge.sourceHandle) === outletId;
}

/** 未连接是合法状态；这里只报告“无出口”或多个 Clip 抢占出口。 */
export function getGroupOutletWarnings(node: DialogueNode) {
  return resolveGroupOutlets(node).warnings;
}
