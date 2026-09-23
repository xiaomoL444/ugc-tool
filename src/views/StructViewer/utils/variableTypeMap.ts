import { ParamType } from "../types/ParamsType";
export interface ParamMeta {
  titleKey: string;
  color: string;
  background: string;
}
export const ParamMetaMap: Record<ParamType, ParamMeta> = {
  String: { titleKey: "structViewer.ui.types.String", color: "#1E40AF", background: "#DBEAFE" },
  StringList: {
    titleKey: "structViewer.ui.types.StringList",
    color: "#3730A3",
    background: "#E0E7FF",
  },
  Int32: { titleKey: "structViewer.ui.types.Int32", color: "#166534", background: "#DCFCE7" },
  Int32List: { titleKey: "structViewer.ui.types.Int32List", color: "#065F46", background: "#D1FAE5" },
  Float: { titleKey: "structViewer.ui.types.Float", color: "#854D0E", background: "#FEF9C3" },
  FloatList: { titleKey: "structViewer.ui.types.FloatList", color: "#9A3412", background: "#FFEDD5" },
  Bool: { titleKey: "structViewer.ui.types.Bool", color: "#6B21A8", background: "#F3E8FF" },
  BoolList: { titleKey: "structViewer.ui.types.BoolList", color: "#9D174D", background: "#FCE7F3" },
  Vector3: { titleKey: "structViewer.ui.types.Vector3", color: "#991B1B", background: "#FEE2E2" },
  Vector3List: {
    titleKey: "structViewer.ui.types.Vector3List",
    color: "#9F1239",
    background: "#FFE4E6",
  },
  Entity: { titleKey: "structViewer.ui.types.Entity", color: "#155E75", background: "#CFFAFE" },
  EntityList: { titleKey: "structViewer.ui.types.EntityList", color: "#115E59", background: "#CCFBF1" },
  Guid: { titleKey: "structViewer.ui.types.Guid", color: "#1E293B", background: "#F1F5F9" },
  GuidList: { titleKey: "structViewer.ui.types.GuidList", color: "#1E293B", background: "#F1F5F9" },
  ConfigReference: {
    titleKey: "structViewer.ui.types.ConfigReference",
    color: "#6B21A8",
    background: "#F3E8FF",
  },
  ConfigReferenceList: {
    titleKey: "structViewer.ui.types.ConfigReferenceList",
    color: "#9D174D",
    background: "#FCE7F3",
  },
  EntityReference: {
    titleKey: "structViewer.ui.types.EntityReference",
    color: "#9F1239",
    background: "#FFE4E6",
  },
  EntityReferenceList: {
    titleKey: "structViewer.ui.types.EntityReferenceList",
    color: "#155E75",
    background: "#CFFAFE",
  },
  Army: { titleKey: "structViewer.ui.types.Army", color: "#3F6212", background: "#ECFCCB" },
  ArmyList: { titleKey: "structViewer.ui.types.ArmyList", color: "#065F46", background: "#D1FAE5" },
  Struct: { titleKey: "structViewer.ui.types.Struct", color: "#6A5ACD", background: "	#E6E6FA" },
  StructList: {
    titleKey: "structViewer.ui.types.StructList",
    color: "#6A5ACD",
    background: "#E6E6FA",
  },
  Dict: { titleKey: "structViewer.ui.types.Dict", color: "#FFB90F", background: "#FFFACD" },
  NULL: { titleKey: "structViewer.ui.types.NULL", color: "#B7B7B7FF", background: "#454545FF" },
};
