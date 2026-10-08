import type {
  ClipComponentTemplate,
  ClipPropertyDefinition,
  PerformanceClip,
} from "../types/DialogueNode";

// 对应 assets/DSFGStudio 的 V2.0 PositionSlot；位置和旋转共用此模板。
export const CAMERA_SLOT_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "space", label: "坐标空间", type: "select", defaultValue: 0,
    options: [{ label: "Local（0）", value: 0 }, { label: "World（1）", value: 1 }] },
  { key: "pointType", label: "点位类型", type: "select", defaultValue: "NOLOC_Vector3",
    options: ["NOLOC_Vector3", "NOLOC_Guid", "NOLOC_Entity"].map((value) => ({ label: value, value })) },
  { key: "vector3", label: "Vector3", type: "vector3", defaultValue: "0,0,0", step: 0.01,
    visibleWhen: { key: "pointType", values: ["NOLOC_Vector3"] } },
  { key: "guid", label: "GUID", type: "string", defaultValue: "0",
    entityPresetField: "guid",
    description: "整数 ID，以文本保存，避免大整数精度丢失。",
    visibleWhen: { key: "pointType", values: ["NOLOC_Guid"] } },
  { key: "entity", label: "实体", type: "string", defaultValue: "",
    entityPresetField: "entityQuery",
    visibleWhen: { key: "pointType", values: ["NOLOC_Entity"] } },
  { key: "attachmentPoint", label: "挂接点", type: "string", defaultValue: "GI_RootNode",
    visibleWhen: { key: "pointType", values: ["NOLOC_Guid", "NOLOC_Entity"] } },
  { key: "offset", label: "偏移", type: "vector3", defaultValue: "0,0,0", step: 0.01,
    visibleWhen: { key: "pointType", values: ["NOLOC_Guid", "NOLOC_Entity"] } },
  { key: "requiresClientPos", label: "需要客户端位置", type: "boolean", defaultValue: false,
    visibleWhen: { key: "pointType", values: ["NOLOC_Guid", "NOLOC_Entity"] } },
];

// Only camera-position slots hide coordinate space for literal Vector3 points.
const CAMERA_POSITION_SLOT_PROPERTIES = CAMERA_SLOT_PROPERTIES.map(property =>
  property.key === "space" ? { ...property, visibleWhen: { key: "pointType", values: ["NOLOC_Guid", "NOLOC_Entity"] } } : property,
);
const CAMERA_LINEAR_POSITION_SLOT_PROPERTIES = CAMERA_POSITION_SLOT_PROPERTIES.map(property =>
  property.key === "offset" ? { ...property, visibleWhen: { key: "pointType", values: ["NOLOC_Vector3", "NOLOC_Guid", "NOLOC_Entity"] } } : property,
);
const CAMERA_FOLLOW_SLOT_PROPERTIES = CAMERA_POSITION_SLOT_PROPERTIES.map(property => {
  if (property.key === "pointType") return { ...property, defaultValue: "NOLOC_Guid",
    options: property.options?.filter(option => option.value !== "NOLOC_Vector3"),
  };
  if (property.key === "vector3") return { ...property, visibleWhen: { key: "pointType", values: [] } };
  return property;
});

/** 固定角度只提供 Vector3 与旋转；保留隐藏字段用于存档和导出。 */
export const CAMERA_VIEWPOINT_SLOT_PROPERTIES: ClipPropertyDefinition[] = CAMERA_SLOT_PROPERTIES.map(property => {
  if (property.key === "space") return { ...property, visibleWhen: { key: "pointType", values: ["NOLOC_Rot"] } };
  if (property.key === "pointType") return { ...property, options: [
    ...(property.options ?? []).filter(option => option.value === "NOLOC_Vector3"),
    { label: "NOLOC_Rot（旋转）", value: "NOLOC_Rot" },
  ] };
  if (property.key === "vector3") return { ...property, visibleWhen: { key: "pointType", values: ["NOLOC_Vector3", "NOLOC_Rot"] } };
  if (property.visibleWhen) return { ...property, visibleWhen: { ...property.visibleWhen,
    values: property.visibleWhen.values.filter(value => value !== "NOLOC_Guid" && value !== "NOLOC_Entity"),
  } };
  return property;
});

function slotProperty(properties = CAMERA_SLOT_PROPERTIES): ClipPropertyDefinition {
  return {
    key: "slot", label: "点位列表", type: "struct-list", defaultValue: [],
    properties, maxItems: 100,
    description: "按列表顺序导出；每个 Slot 是一个 PositionSlot 结构体。",
  };
}

export const CAMERA_POSITION_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "type", label: "相机位置类型", type: "select", defaultValue: "NOLOC_Fixed",
    options: [{ label: "固定位置", value: "NOLOC_Fixed" }, { label: "线性移动", value: "NOLOC_Linear" },
      { label: "跟随", value: "NOLOC_Follow" }, { label: "环绕", value: "NOLOC_Orbit" }] },
  { ...slotProperty(CAMERA_POSITION_SLOT_PROPERTIES), defaultValue: [{}], minItems: 1, maxItems: 1,
    propertiesWhen: { key: "type", cases: {
      NOLOC_Linear: CAMERA_LINEAR_POSITION_SLOT_PROPERTIES,
      NOLOC_Follow: CAMERA_FOLLOW_SLOT_PROPERTIES,
    } },
    itemLimitsWhen: { key: "type", cases: {
      NOLOC_Fixed: { min: 1, max: 1 }, NOLOC_Follow: { min: 1, max: 1 }, NOLOC_Orbit: { min: 1, max: 1 }, NOLOC_Linear: { min: 1, max: 2 },
    } }, description: "固定位置、跟随、环绕使用 1 个点位；线性移动使用终点和可选起点。未填写起点时获取当前位置。切换为单点位类型时保留第一个点位。" },
  { key: "snapToTarget", label: "是否立即抵达目标", type: "boolean", defaultValue: false,
    visibleWhen: { key: "type", values: ["NOLOC_Follow"] } },
  { key: "orbitRotStart", label: "初始环绕角度", type: "vector3", defaultValue: "0,0,0", step: 0.1,
    visibleWhen: { key: "type", values: ["NOLOC_Orbit"] } },
  { key: "orbitRotEnd", label: "结束环绕角度", type: "vector3", defaultValue: "0,0,0", step: 0.1,
    visibleWhen: { key: "type", values: ["NOLOC_Orbit"] } },
  // CameraClip 内嵌默认是 0，而独立 PositionData 导出文件的示例值为 2。
  { key: "orbitRadius", label: "环绕半径", type: "number", defaultValue: 0, step: 0.01,
    visibleWhen: { key: "type", values: ["NOLOC_Orbit"] } },
];

export const CAMERA_ROTATION_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "type", label: "视点位置类型", type: "select", defaultValue: "NOLOC_Fixed",
    options: [{ label: "固定角度", value: "NOLOC_Fixed" }, { label: "线性移动", value: "NOLOC_Linear" },
      { label: "固定视点位置", value: "NOLOC_LookAt" }] },
  { ...slotProperty(CAMERA_VIEWPOINT_SLOT_PROPERTIES), defaultValue: [{}], minItems: 1, maxItems: 1,
    propertiesWhen: { key: "type", cases: {
      NOLOC_Linear: CAMERA_POSITION_SLOT_PROPERTIES,
      NOLOC_LookAt: CAMERA_POSITION_SLOT_PROPERTIES,
    } },
    itemLimitsWhen: { key: "type", cases: {
      NOLOC_Fixed: { min: 1, max: 1 }, NOLOC_Linear: { min: 1, max: 2 }, NOLOC_LookAt: { min: 1, max: 1 },
    } }, description: "固定角度、固定视点位置使用 1 个点位；线性移动使用终点和可选起点。未填写起点时获取当前位置。切换为单点位类型时保留第一个点位。" },
  { key: "snapToTarget", label: "是否立即抵达目标", type: "boolean", defaultValue: false,
    visibleWhen: { key: "type", values: ["NOLOC_LookAt"] } },
];

/** duration 直接使用 Timeline Clip 的持续时间，不在组件内保存第二份。 */
export const CAMERA_CLIP_COMPONENT_TEMPLATE: ClipComponentTemplate = {
  id: "camera.shot",
  name: "镜头参数",
  description: "V2.0 CameraClip；开始时间和持续时间由 Timeline 控制。",
  properties: [
    { key: "cameraName", label: "相机名称", type: "string", defaultValue: "NOLOC_Default" },
    { key: "positionData", label: "相机位置", type: "struct", defaultValue: {},
      properties: CAMERA_POSITION_PROPERTIES },
    { key: "rotationData", label: "视点位置", type: "struct", defaultValue: {},
      properties: CAMERA_ROTATION_PROPERTIES },
  ],
};

/** Upgrade only known camera enum values; preserve custom values and all point data. */
export function normalizeCameraMotion(value: unknown, kind: "position" | "rotation"): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const modes = kind === "position" ? ["Fixed", "Linear", "Follow", "Orbit"] : ["Fixed", "Linear", "LookAt"];
  const pointTypes = kind === "position" ? ["Vector3", "Guid", "Entity"] : ["Vector3", "Guid", "Entity", "Rot"];
  return {
    ...source,
    ...(typeof source.type === "string" && modes.includes(source.type) ? { type: `NOLOC_${source.type}` } : {}),
    ...(Array.isArray(source.slot) ? { slot: source.slot.map(slot => {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) return slot;
      return { ...slot, ...(pointTypes.includes(slot.pointType) ? { pointType: `NOLOC_${slot.pointType}` } : {}) };
    }) } : {}),
  };
}

export function normalizeCameraProperties(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  return {
    ...source,
    ...(Object.prototype.hasOwnProperty.call(source, "positionData") ? { positionData: normalizeCameraMotion(source.positionData, "position") } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, "rotationData") ? { rotationData: normalizeCameraMotion(source.rotationData, "rotation") } : {}),
  };
}

export function getCameraClipPreview(clip: PerformanceClip): string[] {
  const properties = clip.components.reduce<Record<string, unknown>>((result, component) => {
    if (component.enabled) {
      Object.assign(result, component.properties);
      if (component.templateId === "camera.shot" && component.cameraViewpointEnabled === false) result.rotationData = undefined;
    }
    return result;
  }, {});
  const describeData = (label: string, value: unknown) => {
    const data = value && typeof value === "object"
      ? value as Record<string, unknown>
      : {};
    return `${label}：${data.type || "未设置类型"} · ${Array.isArray(data.slot) ? data.slot.length : 0} 个 Slot`;
  };
  return [
    `相机：${properties.cameraName || "未命名"}`,
    describeData("相机位置", properties.positionData),
    properties.rotationData ? describeData("视点位置", properties.rotationData) : "视点位置：未配置",
  ];
}
