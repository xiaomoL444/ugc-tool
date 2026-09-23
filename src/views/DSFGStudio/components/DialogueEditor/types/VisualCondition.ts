export type ConditionValueSource = "player" | "character" | "level" | "number" | "text" | "boolean";
export interface ConditionValue {
  source: ConditionValueSource;
  value: string;
}
export type ComparisonOperator = "==" | "!=" | ">" | ">=" | "<" | "<=";
export interface ConditionComparison {
  id: string;
  kind: "comparison";
  left: ConditionValue;
  operator: ComparisonOperator;
  right: ConditionValue;
}
export interface ConditionGroup {
  id: string;
  kind: "group";
  operator: "and" | "or";
  children: VisualCondition[];
}
export type VisualCondition = ConditionComparison | ConditionGroup;

export function createConditionComparison(): ConditionComparison {
  return {
    id: crypto.randomUUID(), kind: "comparison",
    left: { source: "player", value: "" }, operator: "==",
    right: { source: "number", value: "0" },
  };
}
export function createConditionGroup(): ConditionGroup {
  return { id: crypto.randomUUID(), kind: "group", operator: "and", children: [createConditionComparison()] };
}
