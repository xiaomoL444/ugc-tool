import { systemPresetConfig } from "../EntityPresetEditor/systemPresetConfig";
// 新建台词使用系统默认样式；可选样式由工作区预设管理。
export const DEFAULT_WALK_TALK_STYLE = systemPresetConfig.walkTalkStyles.presets[0].value;
export const WALK_TALK_STYLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  systemPresetConfig.walkTalkStyles.presets.map(preset => ({ value: preset.value, label: preset.label }));
