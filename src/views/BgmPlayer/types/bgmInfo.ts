export interface BgmInfo {
  id: number;
  giVersion?: string;
  nameI18nKey: string;
  song_id: number;
  album_id: number;
  albumI18nKey: string;
  time: number;
  minute: number;
  second: number;
  category: number;
  order: number;
}

export interface BgmDataFile {
  data: BgmInfo[];
  category: { id: number; nameI18nKey: string }[];
}
