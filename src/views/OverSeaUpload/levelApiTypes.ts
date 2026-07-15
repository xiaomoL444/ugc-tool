import type { TagItem } from "./zipTypes";

export interface LevelChangelogItem {
  version_id: string;
  edition: string;
  content: string;
}

export interface LevelLanguageContent {
  lang: string;
  level_name: string;
  level_intro: string;
  desc: string;
  changelog: LevelChangelogItem[];
  early_access_desc: string;
}

export interface LevelImageInfo {
  img_id: string;
  img_url: string;
}

export interface LevelVideoInfo {
  video_url: string;
  video_id: string;
  video_cover?: string;
}

export interface LevelInfoData {
  level_name?: string;
  level_intro?: string;
  desc?: string;
  early_access_status?: string;
  early_access_desc?: string;
  cover_img?: LevelImageInfo;
  images?: LevelImageInfo[];
  video_info?: Partial<LevelVideoInfo>;
  devices_control?: TagItem[];
  tags?: TagItem[];
  play_type?: TagItem;
  play_cate?: string;
  changelog?: LevelChangelogItem[];
  default_lang?: string;
  multi_lang_info?: Record<string, Partial<LevelLanguageContent>>;
}

export interface LevelDetailData {
  level_id?: string;
  meta_data?: {
    player_count?: string;
    pass_time?: string;
    device_performance?: string;
    has_online_once?: boolean;
  };
  info_data?: LevelInfoData;
  op_info?: {
    allow_edit_play_cate?: boolean;
  };
  online_data?: {
    online_detail_langs?: string[];
    online_level_langs?: string[];
    online_devices_control?: TagItem[];
    online_play_type?: TagItem;
    online_play_cate?: string;
    online_tags?: TagItem[];
  };
}

export interface LevelUploadPayload {
  level_id: string;
  early_access_status: string;
  early_access_desc: string;
  level_name: string;
  level_intro: string;
  desc: string;
  devices_control: string[];
  tags: string[];
  play_type: string;
  play_cate: string;
  cover_img: string;
  images: string[];
  video_info: LevelVideoInfo | Record<string, never>;
  changelog: LevelChangelogItem[];
  default_lang: string;
  multi_lang_info: Record<string, LevelLanguageContent>;
}

export interface LevelUploadSuccessResponse {
  retcode: 0;
  message: string;
  data: Record<string, unknown>;
}

export interface LevelUploadUnchangedResponse {
  retcode: -2000438;
  message: string;
  data: null;
}

export interface LevelUploadRateLimitedResponse {
  retcode: -2000448;
  message: string;
  data: null;
}

export interface LevelUploadOtherResponse {
  retcode: number;
  message: string;
  data?: unknown;
}

export type LevelUploadResponse =
  | LevelUploadSuccessResponse
  | LevelUploadUnchangedResponse
  | LevelUploadRateLimitedResponse
  | LevelUploadOtherResponse;
