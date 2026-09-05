export interface BgmInfo {
  id: number;
  name: string;
  song_id: number;
  album_id: number;
  album: string;
  time: number;
  minute: number;
  second: number;
  category: number;
  order: number;
}

export interface BgmDataFile {
  musicData: BgmInfo[];
  categoryData: Record<string, string>;
}
