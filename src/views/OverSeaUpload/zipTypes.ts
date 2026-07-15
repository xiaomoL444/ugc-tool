import type { LevelChangelogItem } from "./levelApiTypes";

export interface TagItem {
  tag_id: string;
  tag_name: string;
}

export interface TagDraft {
  play_cate: string;
  devices_control: TagItem[];
  play_type: TagItem | null;
  tags: TagItem[];
}

export interface LanguageDraft {
  level_name: string;
  level_intro: string;
  desc: string;
  changelog?: LevelChangelogItem[];
  early_access_desc?: string;
}

export interface EditorDraftState {
  tags: TagDraft;
  selectedLanguages: string[];
  defaultLang: string;
  drafts: Record<string, LanguageDraft>;
}

export interface EditorMediaSource {
  label: string;
  file?: File | Blob;
  fileName?: string;
  mimeType?: string;
  remoteUrl?: string;
  sourceId?: string;
  objectKey?: string;
  md5?: string;
}

export interface EditorExportState extends EditorDraftState {
  cover: EditorMediaSource | null;
  displayImages: EditorMediaSource[];
  video: EditorMediaSource | null;
}

export type MediaSourceKind = "local" | "remote";

export interface ZipMediaEntry {
  path: string;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "video/mp4";
  size: number;
  source: {
    kind: MediaSourceKind;
    url?: string;
    sourceId?: string;
    objectKey?: string;
  };
  md5?: string;
}

export interface OverSeaUploadManifest {
  schemaVersion: 1 | 2;
  exportedAt: string;
  levelId: string;
  editor: EditorDraftState;
  media: {
    cover: ZipMediaEntry | null;
    displayImages: ZipMediaEntry[];
    video: ZipMediaEntry | null;
  };
}

export interface ImportedZip {
  manifest: OverSeaUploadManifest;
  cover: File | null;
  displayImages: File[];
  video: File | null;
}
