export interface ConditionBranchNode {
  id: string;
  name: string;
  nodeType: "ConditionBranch";
  outputs: ConditionBranchOutput[];
}

export interface ConditionBranchOutput {
  id: string;
  label: string;
  /** 仅对应本出口的表达式；可视化编辑生成字符串，原文模式保留复杂语法；不在网页执行。 */
  condition: string;
}
