// SoundEffectPlayer/data.json 的数据结构
export interface SoundEffectData {
  data: SoundEffectItem[];
  category: SoundEffectCategory[];
}

export interface SoundEffectCategory {
  id: number;
  nameI18nKey: string;
}

export interface SoundEffectItem {
  id: string; // 音效唯一ID（如"10001"）
  nameI18nKey: string; // 项目 i18n 中的完整音效名称键
  duration: string; // 音效时长（字符串格式的数字，如"39.862"）
  category?: number; // 对应 category 列表中的分类 ID
  giVersion?: string; // 加入音效的游戏版本
  order?: number; // 分类内的展示顺序
}
