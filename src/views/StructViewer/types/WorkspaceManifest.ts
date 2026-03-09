import { ParamNode } from "./ParamsType";

export interface WorkspaceManifest {
  manifestVersion: "1.0";
  activeWorkspace: string | null;
  order: string[];
  workspaces: Record<string, WorkspaceConfig>; //id和对应的配置
}

export interface WorkspaceConfig {
  name: string;
  id: string;
}

export interface BaseStruct {
  structId: string; //结构体的id
  structDefinition: {
    type: string;
    struct_ype: string;
    name: string;
    value: BaseStructValue[];
  }; //结构体的定义
}
export interface BaseStructValue {
  key: string;
  param_type: string;
  value: ParamNode;
}

export interface VariableData {
  variableName: string;
  value: any;
}

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JSONValue }
  | JSONValue[];
