import { systemPresetConfig } from "../EntityPresetEditor/systemPresetConfig";
// 初始创建默认值保持兼容；可选样式由工作区预设管理。
export const DEFAULT_WALK_TALK_STYLE = "Default";
export const WALK_TALK_STYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  systemPresetConfig.walkTalkStyles.presets.map(preset => ({ value: preset.value, label: preset.label }));
