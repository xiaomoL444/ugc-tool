import { ParamType } from "../types/ParamsType";
export interface ParamMeta {
  title: string;
  color: string;
  background: string;
}
export const ParamMetaMap: Record<ParamType, ParamMeta> = {
  String: { title: "字符串", color: "#1E40AF", background: "#DBEAFE" },
  StringList: {
    title: "字符串列表",
    color: "#3730A3",
    background: "#E0E7FF",
  },
  Int32: { title: "整数", color: "#166534", background: "#DCFCE7" },
  Int32List: { title: "整数列表", color: "#065F46", background: "#D1FAE5" },
  Float: { title: "浮点数", color: "#854D0E", background: "#FEF9C3" },
  FloatList: { title: "浮点数列表", color: "#9A3412", background: "#FFEDD5" },
  Bool: { title: "布尔值", color: "#6B21A8", background: "#F3E8FF" },
  BoolList: { title: "布尔值列表", color: "#9D174D", background: "#FCE7F3" },
  Vector3: { title: "三维向量", color: "#991B1B", background: "#FEE2E2" },
  Vector3List: {
    title: "三维向量列表",
    color: "#9F1239",
    background: "#FFE4E6",
  },
  Entity: { title: "实体", color: "#155E75", background: "#CFFAFE" },
  EntityList: { title: "实体列表", color: "#115E59", background: "#CCFBF1" },
  Guid: { title: "Guid", color: "#1E293B", background: "#F1F5F9" },
  GuidList: { title: "Guid列表", color: "#1E293B", background: "#F1F5F9" },
  ConfigReference: {
    title: "配置ID",
    color: "#6B21A8",
    background: "#F3E8FF",
  },
  ConfigReferenceList: {
    title: "配置ID列表",
    color: "#9D174D",
    background: "#FCE7F3",
  },
  EntityReference: {
    title: "元件ID",
    color: "#9F1239",
    background: "#FFE4E6",
  },
  EntityReferenceList: {
    title: "元件ID列表",
    color: "#155E75",
    background: "#CFFAFE",
  },
  Army: { title: "阵营", color: "#3F6212", background: "#ECFCCB" },
  ArmyList: { title: "阵营列表", color: "#065F46", background: "#D1FAE5" },
  Struct: { title: "结构体", color: "#6A5ACD", background: "	#E6E6FA" },
  StructList: {
    title: "结构体列表",
    color: "#6A5ACD",
    background: "#E6E6FA",
  },
  Dict: { title: "字典", color: "#FFB90F", background: "#FFFACD" },
  NULL: { title: "空", color: "#B7B7B7FF", background: "#454545FF" },
};
