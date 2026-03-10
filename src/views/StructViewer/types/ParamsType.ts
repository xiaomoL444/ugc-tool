export interface ParamNode {
  param_type: ParamType;
  value: unknown;
}

export interface StructNode {
  structId: string;
  type: "Struct";
  value: ParamNode[];
}

export interface StructListNode {
  structId: string;
  value: (ParamNode & { param_type: "Struct" })[]; //但这个限定param_type是Struct
}

export interface DictNode {
  type: "Dict";
  key_type: ParamType;
  value_type: ParamType;
  value: DictEntry[];
  value_structId?: string;//字典可能会有结构体的id
}
export interface DictEntry {
  key: ParamNode;
  value: ParamNode;
}

export type ParamType =
  | "String"
  | "StringList"
  | "Int32"
  | "Int32List"
  | "Float"
  | "FloatList"
  | "Bool"
  | "BoolList"
  | "Vector3"
  | "Vector3List"
  | "Entity"
  | "EntityList"
  | "Guid"
  | "GuidList"
  | "ConfigReference"
  | "ConfigReferenceList"
  | "EntityReference"
  | "EntityReferenceList"
  | "Army"
  | "ArmyList"
  | "Struct"
  | "StructList"
  | "Dict";
