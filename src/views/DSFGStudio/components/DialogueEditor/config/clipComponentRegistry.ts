import type {
  ClipComponent,
  ClipComponentTemplate,
  ClipPropertyDefinition,
} from "../types/DialogueNode";
import { createClipPropertyValues } from "../utils/clipProperties";
import { CAMERA_CLIP_COMPONENT_TEMPLATE } from "./cameraClip";

const templates = new Map<string, ClipComponentTemplate>();

export function registerClipComponentTemplate(
  template: ClipComponentTemplate,
) {
  templates.set(template.id, template);
}

export function getClipComponentTemplate(templateId: string) {
  return templates.get(templateId);
}

export function getClipComponentTemplates(templateIds?: string[]) {
  const all = [...templates.values()];
  return templateIds?.length
    ? all.filter((template) => templateIds.includes(template.id))
    : all;
}

export function resolveClipComponentTemplate(
  templateId: string,
  resolving = new Set<string>(),
): ClipComponentTemplate | undefined {
  const template = templates.get(templateId);
  if (!template) return undefined;
  if (!template.extends) return template;
  if (resolving.has(templateId)) {
    throw new Error(`Clip Component 模板存在循环继承：${templateId}`);
  }

  resolving.add(templateId);
  const parent = resolveClipComponentTemplate(template.extends, resolving);
  resolving.delete(templateId);
  if (!parent) return template;

  const properties = new Map<string, ClipPropertyDefinition>();
  for (const property of parent.properties) properties.set(property.key, property);
  for (const property of template.properties) properties.set(property.key, property);

  return {
    ...template,
    properties: [...properties.values()],
  };
}

export function createClipComponent(templateId: string): ClipComponent {
  const template = resolveClipComponentTemplate(templateId);
  if (!template) {
    throw new Error(`未注册 Clip Component 模板：${templateId}`);
  }

  return {
    id: `component_${crypto.randomUUID()}`,
    templateId: template.id,
    name: template.name,
    enabled: true,
    ...(template.id === "camera.shot" ? { cameraViewpointEnabled: false } : {}),
    properties: createClipPropertyValues(template.properties),
  };
}

registerClipComponentTemplate({
  id: "base.target",
  name: "目标",
  properties: [
    { key: "target", label: "目标", type: "string", defaultValue: "" },
  ],
});

registerClipComponentTemplate(CAMERA_CLIP_COMPONENT_TEMPLATE);

registerClipComponentTemplate({
  id: "animation.play",
  name: "动画播放",
  extends: "base.target",
  properties: [
    { key: "animation", label: "动画", type: "string", defaultValue: "" },
    {
      key: "speed",
      label: "播放速度",
      type: "number",
      defaultValue: 1,
      min: 0,
      step: 0.1,
    },
    { key: "loop", label: "循环", type: "boolean", defaultValue: false },
  ],
});

registerClipComponentTemplate({
  id: "audio.play",
  name: "音频播放",
  properties: [
    { key: "resource", label: "音频资源", type: "string", defaultValue: "" },
    {
      key: "volume",
      label: "音量",
      type: "number",
      defaultValue: 1,
      min: 0,
      max: 1,
      step: 0.05,
    },
    { key: "loop", label: "循环", type: "boolean", defaultValue: false },
  ],
});

registerClipComponentTemplate({
  id: "behavior.trigger",
  name: "行为触发",
  extends: "base.target",
  properties: [
    { key: "action", label: "行为", type: "string", defaultValue: "" },
    { key: "arguments", label: "参数", type: "text", defaultValue: "" },
  ],
});

registerClipComponentTemplate({
  id: "custom.data",
  name: "自定义数据",
  properties: [
    { key: "key", label: "键", type: "string", defaultValue: "" },
    { key: "value", label: "值", type: "text", defaultValue: "" },
  ],
});
