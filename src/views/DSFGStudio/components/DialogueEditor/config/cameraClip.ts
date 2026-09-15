import type {
  ClipComponentTemplate,
  ClipPropertyDefinition,
  PerformanceClip,
} from "../types/DialogueNode";

// 对应 assets/DSFGStudio 的 V2.0 PositionSlot；位置和旋转共用此模板。
export const CAMERA_SLOT_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "space", label: "坐标空间", type: "select", defaultValue: 0,
    options: [{ label: "Local（0）", value: 0 }, { label: "World（1）", value: 1 }] },
  { key: "pointType", label: "点位类型", type: "select", defaultValue: "Vector3",
    options: ["Vector3", "Guid", "Entity"].map((value) => ({ label: value, value })) },
  { key: "vector3", label: "Vector3", type: "vector3", defaultValue: "0,0,0", step: 0.01,
    visibleWhen: { key: "pointType", values: ["Vector3"] } },
  { key: "guid", label: "GUID", type: "string", defaultValue: "0",
    description: "整数 ID，以文本保存，避免大整数精度丢失。",
    visibleWhen: { key: "pointType", values: ["Guid"] } },
  { key: "entity", label: "实体", type: "string", defaultValue: "",
    visibleWhen: { key: "pointType", values: ["Entity"] } },
  { key: "attachmentPoint", label: "挂接点", type: "string", defaultValue: "",
    visibleWhen: { key: "pointType", values: ["Guid", "Entity"] } },
  { key: "offset", label: "偏移", type: "vector3", defaultValue: "0,0,0", step: 0.01,
    visibleWhen: { key: "pointType", values: ["Guid", "Entity"] } },
  { key: "requiresClientPos", label: "需要客户端位置", type: "boolean", defaultValue: false,
    visibleWhen: { key: "pointType", values: ["Guid", "Entity"] } },
];

/** 视点额外支持以旋转值确定目标位置，仍写入 PositionSlot.vector3。 */
export const CAMERA_VIEWPOINT_SLOT_PROPERTIES: ClipPropertyDefinition[] = CAMERA_SLOT_PROPERTIES.map(property => {
  if (property.key === "pointType") return { ...property, options: [...(property.options ?? []), { label: "Rot（旋转）", value: "Rot" }] };
  if (property.key === "vector3") return { ...property, visibleWhen: { key: "pointType", values: ["Vector3", "Rot"] } };
  return property;
});
const CAMERA_FIXED_VIEWPOINT_SLOT_PROPERTIES = CAMERA_VIEWPOINT_SLOT_PROPERTIES.map(property =>
  property.key === "pointType" ? { ...property, options: property.options?.filter(option => option.value === "Vector3" || option.value === "Rot") } : property,
);

function slotProperty(properties = CAMERA_SLOT_PROPERTIES): ClipPropertyDefinition {
  return {
    key: "slot", label: "点位列表", type: "struct-list", defaultValue: [],
    properties, maxItems: 100,
    description: "按列表顺序导出；每个 Slot 是一个 PositionSlot 结构体。",
  };
}

export const CAMERA_POSITION_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "type", label: "相机位置类型", type: "select", defaultValue: "Fixed",
    options: ["Fixed", "Linear", "Follow", "Orbit"].map((value) => ({ label: value, value })) },
  { ...slotProperty(), defaultValue: [{}], minItems: 1, maxItems: 1,
    itemLimitsWhen: { key: "type", cases: {
      Fixed: { min: 1, max: 1 }, Follow: { min: 1, max: 1 }, Orbit: { min: 1, max: 1 }, Linear: { min: 1, max: 2 },
    } }, description: "Fixed、Follow、Orbit 使用 1 个 Slot；Linear 可使用 1～2 个。切换为单 Slot 类型时保留第一个点位。" },
  { key: "snapToTarget", label: "立即抵达目标", type: "boolean", defaultValue: false,
    visibleWhen: { key: "type", values: ["Follow"] } },
  { key: "orbitRot", label: "环绕旋转", type: "vector3", defaultValue: "0,0,0", step: 0.1,
    visibleWhen: { key: "type", values: ["Orbit"] } },
  // CameraClip 内嵌默认是 0，而独立 PositionData 导出文件的示例值为 2。
  { key: "orbitRadius", label: "环绕半径", type: "number", defaultValue: 0, step: 0.01,
    visibleWhen: { key: "type", values: ["Orbit"] } },
];

export const CAMERA_ROTATION_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "type", label: "视点位置类型", type: "select", defaultValue: "Fixed",
    options: ["Fixed", "Linear", "LookAt"].map((value) => ({ label: value, value })) },
  { ...slotProperty(CAMERA_VIEWPOINT_SLOT_PROPERTIES), defaultValue: [{}], minItems: 1, maxItems: 1,
    propertiesWhen: { key: "type", cases: { Fixed: CAMERA_FIXED_VIEWPOINT_SLOT_PROPERTIES } },
    itemLimitsWhen: { key: "type", cases: {
      Fixed: { min: 1, max: 1 }, Linear: { min: 1, max: 2 }, LookAt: { min: 1, max: 1 },
    } }, description: "Fixed、LookAt 使用 1 个 Slot；Linear 可使用 1～2 个。切换为单 Slot 类型时保留第一个点位。" },
  { key: "snapToTarget", label: "吸附到目标", type: "boolean", defaultValue: false,
    visibleWhen: { key: "type", values: ["LookAt"] } },
];

/** duration 直接使用 Timeline Clip 的持续时间，不在组件内保存第二份。 */
export const CAMERA_CLIP_COMPONENT_TEMPLATE: ClipComponentTemplate = {
  id: "camera.shot",
  name: "镜头参数",
  description: "V2.0 CameraClip；开始时间和持续时间由 Timeline 控制。",
  properties: [
    { key: "cameraName", label: "相机名称", type: "string", defaultValue: "Default" },
    { key: "positionData", label: "相机位置", type: "struct", defaultValue: {},
      properties: CAMERA_POSITION_PROPERTIES },
    { key: "rotationData", label: "视点位置", type: "struct", defaultValue: {},
      properties: CAMERA_ROTATION_PROPERTIES },
  ],
};

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
