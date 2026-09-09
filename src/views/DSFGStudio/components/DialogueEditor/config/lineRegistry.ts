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
  label: "Camera",
  clipLabel: "镜头",
  removable: false,
  defaultComponentTemplateIds: ["camera.shot"],
  allowedComponentTemplateIds: ["camera.shot", "base.target", "custom.data"],
});

registerLineDefinition({
  type: "Animation",
  label: "Animation",
  clipLabel: "动画",
  removable: true,
  defaultComponentTemplateIds: ["animation.play"],
  allowedComponentTemplateIds: ["animation.play", "base.target", "custom.data"],
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
  type: "Behavior",
  label: "Behavior",
  clipLabel: "行为",
  removable: true,
  defaultComponentTemplateIds: ["behavior.trigger"],
  allowedComponentTemplateIds: ["behavior.trigger", "base.target", "custom.data"],
});

registerLineDefinition({
  type: "Custom",
  label: "Custom",
  clipLabel: "Clip",
  removable: true,
  defaultComponentTemplateIds: ["custom.data"],
  allowedComponentTemplateIds: [],
});
