import JSZip from "jszip";
import SparkMD5 from "spark-md5";
import type {
  EditorDraftState,
  ImportedZip,
  OverSeaUploadManifest,
  ZipMediaEntry,
} from "./zipTypes";

export const ZIP_SCHEMA_VERSION = 2 as const;
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_MANIFEST_SIZE = 1024 * 1024;
const MAX_ARCHIVE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024;

export function isObjectUrl(url: string): boolean {
  return url.startsWith("blob:");
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

export interface ResolvedMedia {
  blob: Blob;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "video/mp4";
  source: {
    kind: "local" | "remote";
    url?: string;
    sourceId?: string;
    objectKey?: string;
  };
}

export interface ZipExportPayload {
  levelId: string;
  editor: EditorDraftState;
  cover: ResolvedMedia | null;
  displayImages: ResolvedMedia[];
  video: ResolvedMedia | null;
}

export async function createExportZip(
  payload: ZipExportPayload,
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  if (payload.displayImages.length > 4) {
    throw new Error("展示图片不能超过 4 张。");
  }

  const zip = new JSZip();
  const cover = payload.cover
    ? await addMedia(zip, payload.cover, `media/cover.${extensionFor(payload.cover.mimeType)}`)
    : null;
  const displayImages = await Promise.all(payload.displayImages.map((media, index) =>
    addMedia(
      zip,
      media,
      `media/display/${index + 1}.${extensionFor(media.mimeType)}`,
    ),
  ));
  const video = payload.video
    ? await addMedia(zip, payload.video, "media/video.mp4")
    : null;
  const manifest: OverSeaUploadManifest = {
    schemaVersion: ZIP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    levelId: payload.levelId,
    editor: cloneDraftState(payload.editor),
    media: { cover, displayImages, video },
  };

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync(
    { type: "blob", compression: "STORE", platform: "DOS" },
    (metadata) => onProgress?.(Math.round(metadata.percent)),
  );
}

export async function readImportZip(file: File): Promise<ImportedZip> {
  if (file.size > MAX_ARCHIVE_SIZE) {
    throw new Error("ZIP 文件过大（上限 2 GiB）。");
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file, { createFolders: false });
  } catch {
    throw new Error("无法读取 ZIP，文件可能已损坏或并非有效 ZIP。");
  }

  const allEntries = Object.values(zip.files);
  for (const entry of allEntries) {
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) {
      throw new Error(`ZIP 中存在路径穿越项：${entry.unsafeOriginalName}`);
    }
    assertSafePath(entry.name.replace(/\/$/, ""));
  }
  const zipEntries = allEntries.filter((entry) => !entry.dir);
  const fileNames = zipEntries.map((entry) => entry.name);
  for (const path of fileNames) assertSafePath(path);

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("ZIP 缺少 manifest.json。");
  const manifestBytes = await manifestFile.async("uint8array");
  if (manifestBytes.byteLength > MAX_MANIFEST_SIZE) {
    throw new Error("manifest.json 异常大（上限 1 MiB）。");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("manifest.json 不是有效 JSON。");
  }
  const manifest = validateManifest(raw);
  const expectedPaths = new Set(["manifest.json"]);
  const cover = await extractMedia(zip, manifest.media.cover, "封面", expectedPaths);
  const displayImages: File[] = [];
  for (const [index, entry] of manifest.media.displayImages.entries()) {
    const image = await extractMedia(
      zip,
      entry,
      `展示图片 ${index + 1}`,
      expectedPaths,
    );
    if (!image) throw new Error(`展示图片 ${index + 1} 缺少文件。`);
    displayImages.push(image);
  }
  const video = await extractMedia(zip, manifest.media.video, "视频", expectedPaths);

  const unexpected = fileNames.find((path) => !expectedPaths.has(path));
  if (unexpected) throw new Error(`ZIP 包含未声明文件：${unexpected}`);

  return { manifest, cover, displayImages, video };
}

async function addMedia(
  zip: JSZip,
  media: ResolvedMedia,
  path: string,
): Promise<ZipMediaEntry> {
  zip.file(path, media.blob, { compression: "STORE", binary: true });
  const md5 = SparkMD5.ArrayBuffer.hash(await media.blob.arrayBuffer());
  return {
    path,
    fileName: sanitizeFileName(media.fileName),
    mimeType: media.mimeType,
    size: media.blob.size,
    // ZIP 只存二进制，不写入任何远端 URL / objectKey，导入时一律重新上传。
    source: { kind: "local" },
    md5,
  };
}

async function extractMedia(
  zip: JSZip,
  entry: ZipMediaEntry | null,
  label: string,
  expectedPaths: Set<string>,
): Promise<File | null> {
  if (!entry) return null;
  assertSafePath(entry.path);
  if (expectedPaths.has(entry.path)) throw new Error(`${label}文件路径重复。`);
  expectedPaths.add(entry.path);
  const zipped = zip.file(entry.path);
  if (!zipped) throw new Error(`${label}缺少文件：${entry.path}`);
  const bytes = await zipped.async("uint8array");
  if (bytes.byteLength !== entry.size) throw new Error(`${label}文件大小与清单不符。`);
  if (entry.mimeType !== "video/mp4" && bytes.byteLength > MAX_IMAGE_SIZE) {
    throw new Error(`${label}超过 5 MiB。`);
  }
  if (!matchesSignature(bytes, entry.mimeType)) {
    throw new Error(`${label}的实际文件类型与清单不符。`);
  }
  const fileBytes = new Uint8Array(bytes.byteLength);
  fileBytes.set(bytes);
  if (
    entry.md5 &&
    SparkMD5.ArrayBuffer.hash(fileBytes.buffer).toLowerCase() !==
      entry.md5.toLowerCase()
  ) {
    throw new Error(`${label}文件 MD5 与清单不符。`);
  }
  return new File([fileBytes], entry.fileName, { type: entry.mimeType });
}

function validateManifest(value: unknown): OverSeaUploadManifest {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== 1 && value.schemaVersion !== ZIP_SCHEMA_VERSION)
  ) {
    throw new Error("不支持的 manifest schemaVersion。");
  }
  if (
    typeof value.exportedAt !== "string" ||
    !Number.isFinite(Date.parse(value.exportedAt)) ||
    typeof value.levelId !== "string" ||
    value.levelId.length > 128
  ) {
    throw new Error("manifest 基本信息无效。");
  }
  const editor = validateEditor(value.editor);
  if (!isRecord(value.media)) throw new Error("manifest.media 无效。");
  const cover = validateMedia(value.media.cover, "image", true);
  if (cover) assertRolePath(cover, "cover");
  if (!Array.isArray(value.media.displayImages) || value.media.displayImages.length > 4) {
    throw new Error("展示图片清单无效或超过 4 张。");
  }
  const displayImages = value.media.displayImages.map((item) =>
    requiredMedia(item, "image"),
  );
  const video = validateMedia(value.media.video, "video", true);
  displayImages.forEach((entry, index) => assertRolePath(entry, "display", index));
  if (video) assertRolePath(video, "video");
  if (
    value.schemaVersion === ZIP_SCHEMA_VERSION &&
    [cover, ...displayImages, video].some((entry) => entry && !entry.md5)
  ) {
    throw new Error("schema 2 媒体清单缺少 MD5。");
  }
  return {
    schemaVersion: value.schemaVersion,
    exportedAt: value.exportedAt,
    levelId: value.levelId,
    editor,
    media: { cover, displayImages, video },
  };
}

function validateEditor(value: unknown): EditorDraftState {
  if (!isRecord(value) || !isRecord(value.tags) || !isRecord(value.drafts)) {
    throw new Error("manifest.editor 无效。");
  }
  const tags = value.tags;
  if (
    typeof tags.play_cate !== "string" ||
    tags.play_cate.length > 128 ||
    !Array.isArray(tags.devices_control) ||
    tags.devices_control.length > 16 ||
    !Array.isArray(tags.tags) ||
    tags.tags.length > 6 ||
    !(tags.play_type === null || isTag(tags.play_type)) ||
    !tags.devices_control.every(isTag) ||
    !tags.tags.every(isTag)
  ) {
    throw new Error("关卡标签草稿无效。");
  }
  if (
    !Array.isArray(value.selectedLanguages) ||
    value.selectedLanguages.length > 15 ||
    !value.selectedLanguages.every(isLanguageCode) ||
    new Set(value.selectedLanguages).size !== value.selectedLanguages.length
  ) {
    throw new Error("已选语言列表无效。");
  }
  const defaultLang =
    value.defaultLang === undefined
      ? value.selectedLanguages[0] || ""
      : value.defaultLang;
  if (
    typeof defaultLang !== "string" ||
    (defaultLang && !value.selectedLanguages.includes(defaultLang)) ||
    (value.selectedLanguages.length > 0 && !defaultLang)
  ) {
    throw new Error("主要语言必须包含在已选择语言中。");
  }
  const draftLanguages = Object.keys(value.drafts);
  if (
    draftLanguages.length > 15 ||
    !draftLanguages.every(isLanguageCode) ||
    value.selectedLanguages.some((lang) => !draftLanguages.includes(lang))
  ) {
    throw new Error("语言草稿与已选语言不匹配。");
  }
  const drafts: EditorDraftState["drafts"] = {};
  for (const [lang, draft] of Object.entries(value.drafts)) {
    if (!isLanguageCode(lang) || !isRecord(draft)) {
      throw new Error(`语言草稿无效：${lang}`);
    }
    const { level_name, level_intro, desc, early_access_desc, changelog } = draft;
    if (![level_name, level_intro, desc].every((item) => typeof item === "string")) {
      throw new Error(`语言草稿字段无效：${lang}`);
    }
    if (
      early_access_desc !== undefined &&
      typeof early_access_desc !== "string"
    ) {
      throw new Error(`语言抢先体验说明无效：${lang}`);
    }
    if (
      changelog !== undefined &&
      (!Array.isArray(changelog) ||
        !changelog.every(
          (item) =>
            isRecord(item) &&
            typeof item.version_id === "string" &&
            typeof item.edition === "string" &&
            typeof item.content === "string",
        ))
    ) {
      throw new Error(`语言更新记录无效：${lang}`);
    }
    drafts[lang] = {
      level_name,
      level_intro,
      desc,
      early_access_desc,
      changelog: Array.isArray(changelog)
        ? changelog.map((item) => ({
            version_id: item.version_id as string,
            edition: item.edition as string,
            content: item.content as string,
          }))
        : undefined,
    };
  }
  return {
    tags: {
      play_cate: tags.play_cate,
      devices_control: tags.devices_control.map(cloneTag),
      play_type: tags.play_type ? cloneTag(tags.play_type) : null,
      tags: tags.tags.map(cloneTag),
    },
    selectedLanguages: [...value.selectedLanguages],
    defaultLang,
    drafts,
  };
}

function isLanguageCode(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 32 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(value);
}

function validateMedia(
  value: unknown,
  kind: "image" | "video",
  nullable: boolean,
): ZipMediaEntry | null {
  if (value === null && nullable) return null;
  if (!isRecord(value)) throw new Error("媒体清单项无效。");
  const allowedTypes = kind === "image" ? IMAGE_TYPES : new Set(["video/mp4"]);
  if (
    typeof value.path !== "string" ||
    typeof value.fileName !== "string" ||
    !value.fileName ||
    value.fileName.length > 255 ||
    /[\\/\0-\x1f\x7f]/.test(value.fileName) ||
    typeof value.mimeType !== "string" ||
    !allowedTypes.has(value.mimeType) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 0 ||
    !isRecord(value.source) ||
    (value.source.kind !== "local" && value.source.kind !== "remote") ||
    (value.source.url !== undefined && typeof value.source.url !== "string") ||
    (value.source.sourceId !== undefined &&
      (typeof value.source.sourceId !== "string" ||
        !value.source.sourceId ||
        value.source.sourceId.length > 256)) ||
    (value.source.objectKey !== undefined &&
      (typeof value.source.objectKey !== "string" ||
        !value.source.objectKey ||
        value.source.objectKey.length > 1024)) ||
    (value.md5 !== undefined &&
      (typeof value.md5 !== "string" || !/^[a-f0-9]{32}$/i.test(value.md5)))
  ) {
    throw new Error(`媒体清单项无效：${String(value.path || "")}`);
  }
  if (
    (kind === "image" && value.size > MAX_IMAGE_SIZE) ||
    (kind === "video" && value.size > MAX_VIDEO_SIZE)
  ) {
    throw new Error(`媒体大小超出限制：${value.path}`);
  }
  if (value.source.kind === "local" && value.source.url !== undefined) {
    throw new Error(`本地媒体不应包含来源 URL：${value.path}`);
  }
  if (value.source.kind === "local" && value.source.objectKey !== undefined) {
    throw new Error(`本地媒体不应包含对象 key：${value.path}`);
  }
  if (value.source.kind === "local" && value.source.sourceId !== undefined) {
    throw new Error(`本地媒体不应包含来源标识：${value.path}`);
  }
  if (value.source.kind === "remote") {
    if (typeof value.source.url !== "string" || !isAllowedRemoteUrl(value.source.url)) {
      throw new Error(`远端媒体来源 URL 无效：${value.path}`);
    }
    if (
      value.source.objectKey !== undefined &&
      value.source.objectKey !== stableObjectKey(value.source.url)
    ) {
      throw new Error(`远端媒体对象 key 与来源 URL 不符：${value.path}`);
    }
  }
  assertSafePath(value.path);
  return value as unknown as ZipMediaEntry;
}

function requiredMedia(value: unknown, kind: "image" | "video") {
  const media = validateMedia(value, kind, false);
  if (!media) throw new Error("媒体清单项不能为空。");
  return media;
}

function assertSafePath(path: string) {
  if (
    !path ||
    path.length > 240 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`ZIP 中存在不安全路径：${path}`);
  }
}

function assertRolePath(
  entry: ZipMediaEntry,
  role: "cover" | "display" | "video",
  index = 0,
) {
  const extension = entry.mimeType === "image/png"
    ? "png"
    : entry.mimeType === "image/jpeg"
      ? "jpg"
      : "mp4";
  const expected = role === "cover"
    ? `media/cover.${extension}`
    : role === "video"
      ? "media/video.mp4"
      : `media/display/${index + 1}.${extension}`;
  if (entry.path !== expected) {
    throw new Error(`${role} 媒体路径无效：${entry.path}`);
  }
}

function isAllowedRemoteUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      /^(cht|asia|en|us)-ugc-upload\.hoyoverse\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

function stableObjectKey(value: string) {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return undefined;
  }
}

function matchesSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") {
    return bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  }
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
}

function extensionFor(mime: ResolvedMedia["mimeType"]) {
  return mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "mp4";
}

function sanitizeFileName(name: string) {
  const clean = name.replace(/[\\/\0-\x1f\x7f]/g, "_").slice(0, 255);
  return clean || "media";
}

function cloneDraftState(editor: EditorDraftState): EditorDraftState {
  return JSON.parse(JSON.stringify(editor)) as EditorDraftState;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTag(value: unknown): value is { tag_id: string; tag_name: string } {
  return isRecord(value) &&
    typeof value.tag_id === "string" &&
    typeof value.tag_name === "string";
}

function cloneTag<T extends { tag_id: string; tag_name: string }>(tag: T) {
  return { tag_id: tag.tag_id, tag_name: tag.tag_name };
}
