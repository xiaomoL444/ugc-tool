// 单个音效数据的类型
export interface SoundEffectData {
  [soundId: string]: SoundEffectItem;
}

export interface SoundEffectItem {
  id: string; // 音效唯一ID（如"10001"）
  name: string; // 音效名称（如"环境_地震"）
  duration: string; // 音效时长（字符串格式的数字，如"39.862"）
}
