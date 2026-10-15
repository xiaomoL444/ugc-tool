import type { DialogueClip, SelectClip } from "../types/DialogueNode";
import { cloneStyleParameters, type StyleParameter } from "../../EntityPresetEditor/styleParameters";

type ParameterClip = DialogueClip | SelectClip;
type ParameterStyle = { id: string; parameters?: readonly StyleParameter[] };

function parameterValues(clip: ParameterClip): string[] {
  return "nodeGraphEvent" in clip ? clip.nodeGraphEvent : clip.params;
}

function setParameterValues(clip: ParameterClip, values: string[]) {
  if ("nodeGraphEvent" in clip) clip.nodeGraphEvent = values;
  else clip.params = values;
}

/** 显式选用或重新应用预设时，将参数定义与默认值一起复制到 Clip。 */
export function applyStyleParameters(clip: ParameterClip, style: ParameterStyle) {
  const parameters = cloneStyleParameters(style.parameters ?? []);
  setParameterValues(clip, parameters.map(parameter => parameter.defaultValue));
  clip.parameterPreset = { style: style.id, parameters };
}

/**
 * 载入旧文件按位置接续整数草稿；已经绑定的 Clip 保留自己的定义和值。
 * 未知样式等待其工作区预设加载完成，避免清空未解析的数据。
 */
export function syncStyleParameters(clip: ParameterClip, styles: readonly ParameterStyle[]) {
  const style = styles.find(item => item.id === clip.style);
  if (!style || clip.parameterPreset?.style === clip.style) return;
  if (clip.parameterPreset) {
    applyStyleParameters(clip, style);
    return;
  }
  const previousValues = parameterValues(clip);
  const parameters = cloneStyleParameters(style.parameters ?? []);
  const ids = new Set(parameters.map(parameter => parameter.id));
  for (let index = parameters.length; index < previousValues.length; index++) {
    let id = `legacy:${clip.id}:${index}`;
    while (ids.has(id)) id += ":copy";
    ids.add(id);
    parameters.push({ id, name: `旧参数 ${index + 1}`, type: "Int32", defaultValue: previousValues[index] });
  }
  setParameterValues(clip, parameters.map((parameter, index) => previousValues[index] ?? parameter.defaultValue));
  clip.parameterPreset = { style: style.id, parameters };
}
