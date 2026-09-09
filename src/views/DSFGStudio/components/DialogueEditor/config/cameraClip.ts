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

function slotProperty(): ClipPropertyDefinition {
  return {
    key: "slot", label: "点位列表", type: "struct-list", defaultValue: [],
    properties: CAMERA_SLOT_PROPERTIES, maxItems: 100,
    description: "按列表顺序导出；每个 Slot 是一个 PositionSlot 结构体。",
  };
}

export const CAMERA_POSITION_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "type", label: "位置类型", type: "select", defaultValue: "Fixed",
    options: ["Fixed", "Linear", "Follow", "Orbit"].map((value) => ({ label: value, value })) },
  slotProperty(),
  { key: "snapToTarget", label: "吸附到目标", type: "boolean", defaultValue: false },
  { key: "orbitRot", label: "环绕旋转", type: "vector3", defaultValue: "0,0,0", step: 0.1 },
  // CameraClip 内嵌默认是 0，而独立 PositionData 导出文件的示例值为 2。
  { key: "orbitRadius", label: "环绕半径", type: "number", defaultValue: 0, step: 0.01 },
];

export const CAMERA_ROTATION_PROPERTIES: ClipPropertyDefinition[] = [
  { key: "type", label: "旋转类型", type: "string", defaultValue: "",
    description: "填写运行时约定的旋转类型标识。" },
  slotProperty(),
  { key: "snapToTarget", label: "吸附到目标", type: "boolean", defaultValue: false },
];

/** duration 直接使用 Timeline Clip 的持续时间，不在组件内保存第二份。 */
export const CAMERA_CLIP_COMPONENT_TEMPLATE: ClipComponentTemplate = {
  id: "camera.shot",
  name: "镜头参数",
  description: "V2.0 CameraClip；开始时间和持续时间由 Timeline 控制。",
  properties: [
    { key: "cameraName", label: "相机名称", type: "string", defaultValue: "Default" },
    { key: "positionData", label: "位置配置", type: "struct", defaultValue: {},
      properties: CAMERA_POSITION_PROPERTIES },
    { key: "rotationData", label: "旋转配置", type: "struct", defaultValue: {},
      properties: CAMERA_ROTATION_PROPERTIES },
  ],
};

export function getCameraClipPreview(clip: PerformanceClip): string[] {
  const properties = clip.components.reduce<Record<string, unknown>>((result, component) => {
    if (component.enabled) Object.assign(result, component.properties);
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
    describeData("位置", properties.positionData),
    describeData("旋转", properties.rotationData),
  ];
}
