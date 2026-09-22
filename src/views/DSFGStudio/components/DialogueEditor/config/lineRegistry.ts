import type {
  PerformanceLineDefinition,
  PerformanceLineType,
} from "../types/DialogueNode";

const definitions = new Map<PerformanceLineType, PerformanceLineDefinition>();

export function registerLineDefinition(definition: PerformanceLineDefinition) {
  definitions.set(definition.type, definition);
}

export function getLineDefinition(type: PerformanceLineType) {
  return definitions.get(type);
}

export function getLineDefinitions() {
  return [...definitions.values()];
}

registerLineDefinition({
  type: "Camera",
  label: "相机",
  clipLabel: "镜头",
  removable: false,
  defaultComponentTemplateIds: ["camera.shot"],
  allowedComponentTemplateIds: ["camera.shot", "base.target", "custom.data"],
});

registerLineDefinition({
  type: "Audio",
  label: "Audio",
  clipLabel: "音频",
  removable: true,
  defaultComponentTemplateIds: ["audio.play"],
  allowedComponentTemplateIds: ["audio.play", "custom.data"],
});

registerLineDefinition({
  type: "Custom",
  label: "自定义事件",
  clipLabel: "Clip",
  removable: true,
  defaultComponentTemplateIds: ["custom.data"],
  allowedComponentTemplateIds: [],
});

registerLineDefinition({
  type: "PublicEvent",
  label: "公共事件",
  clipLabel: "公共事件",
  removable: true,
  defaultComponentTemplateIds: ["public.event"],
  allowedComponentTemplateIds: ["public.event"],
});
