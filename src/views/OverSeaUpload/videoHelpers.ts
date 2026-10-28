import type { LevelVideoInfo } from "./levelApiTypes";
import type { EditorMediaSource } from "./zipTypes";

/** Keep the upload callback reference separate from the URL used to play it. */
export function buildVideoUploadInfo(media: EditorMediaSource): LevelVideoInfo {
  const videoUrl = media.remoteUrl?.trim() || "";
  if (!videoUrl) {
    throw new Error("展示视频缺少上传回调地址，请等待上传完成或重新上传。");
  }

  const isRelativePath = videoUrl.startsWith("/") && !videoUrl.startsWith("//");
  try {
    if (/[\\\u0000-\u001f\u007f]/.test(videoUrl)) throw new Error();
    if (!isRelativePath) {
      const url = new URL(videoUrl);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    }
  } catch {
    throw new Error("展示视频地址无效，必须为上传回调路径或 HTTPS 地址。");
  }

  // A newly uploaded source file has no VOD ID yet. Its OSS key is not an ID.
  const videoId = media.sourceId?.trim() || "";
  if (/[\\/\u0000-\u001f\u007f]/.test(videoId)) {
    throw new Error("展示视频的 video_id 无效，请重新查询关卡或上传视频。");
  }
  return { video_url: videoUrl, video_id: videoId };
}

export function resolveVideoAccessUrl(value: string, mediaBaseUrl?: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, mediaBaseUrl || undefined);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
