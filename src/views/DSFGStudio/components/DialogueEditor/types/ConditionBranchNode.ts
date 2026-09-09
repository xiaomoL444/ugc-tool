export interface ConditionBranchNode {
  id: string;
  name: string;
  nodeType: "ConditionBranch";
  outputs: ConditionBranchOutput[];
}

export interface ConditionBranchOutput {
  id: string;
  label: string;
  /** 仅对应本出口的表达式；编辑器按原文保存，不解析或执行。 */
  condition: string;
}
