<template>
  <div class="level-editor">
    <section class="level-overview">
      <div class="overview-left">
        <div class="level-title">
          <h3>{{ primaryDraft?.level_name || "未命名关卡" }}</h3>
          <span class="edit-mark">✎</span>
        </div>

        <div class="section-label">✦ 关卡封面</div>
        <button
          class="cover-picker"
          type="button"
          :disabled="coverUploading"
          @click="openCoverPicker"
        >
          <img
            v-if="displayCoverUrl"
            class="cover-image"
            :src="displayCoverUrl"
            :alt="primaryDraft?.level_name || '关卡封面'"
          />
          <span v-else class="cover-placeholder">暂无封面</span>
          <span class="cover-overlay">
            {{ coverUploading ? "正在上传…" : "点击更换封面" }}
          </span>
        </button>
        <input
          ref="coverInput"
          class="file-input"
          type="file"
          accept="image/png,image/jpeg,.jpg,.jpeg,.png"
          @change="handleCoverChange"
        />
        <p class="cover-hint">支持 PNG、JPG、JPEG，文件不超过 5 MiB</p>
        <p v-if="localCoverError || coverUploadError" class="cover-error">
          {{ localCoverError || coverUploadError }}
        </p>
        <p v-else-if="uploadedCoverRemoteUrl" class="cover-success">
          封面上传成功
        </p>

        <dl class="facts">
          <div>
            <dt>游玩人数</dt>
            <dd>{{ playerCount }}</dd>
          </div>
          <div>
            <dt>控制设备</dt>
            <dd class="inline-list">
              <span v-for="device in devices" :key="device.tag_id">
                {{ device.tag_name }}
              </span>
            </dd>
          </div>
          <div>
            <dt>玩法类型</dt>
            <dd>{{ playTypeName }}</dd>
          </div>
          <div>
            <dt>玩法分类</dt>
            <dd>{{ playCategoryName }}</dd>
          </div>
          <div>
            <dt>平均时长</dt>
            <dd>{{ averageDuration }}</dd>
          </div>
          <div>
            <dt>负载要求</dt>
            <dd>{{ performanceName }}</dd>
          </div>
        </dl>
      </div>

      <div class="overview-right">
        <div class="info-block">
          <div class="section-label">✦ 玩法说明</div>
          <p class="multiline">{{ primaryDraft?.level_intro || "暂无玩法说明" }}</p>
        </div>

        <div class="info-block">
          <div class="section-label">✦ 关卡详情</div>
          <p class="multiline">{{ primaryDraft?.desc || "暂无关卡详情" }}</p>
        </div>

        <div class="info-block">
          <div class="section-label">✦ 关卡标签</div>
          <button
            class="tag-editor-trigger"
            type="button"
            aria-haspopup="dialog"
            @click="openTagEditor"
          >
            <span v-if="tagSummary.length" class="chips">
              <span
                v-for="item in tagSummary"
                :key="item.key"
                :class="['chip', { 'chip-primary': item.primary }]"
              >
                {{ item.name }}
              </span>
            </span>
            <span v-else class="tag-placeholder">点击添加关卡标签</span>
            <span class="tag-edit-icon" aria-hidden="true">✎</span>
          </button>
        </div>

        <div class="info-block">
          <div class="section-label">✦ 展示图片</div>
          <div class="gallery">
            <div
              v-for="image in galleryImages"
              :key="image.key"
              class="gallery-item"
              :title="image.error"
            >
              <img
                :src="image.previewUrl"
                alt="关卡展示图片"
              />
              <span v-if="image.status === 'uploading'" class="gallery-status">
                正在上传…
              </span>
              <span v-else-if="image.status === 'error'" class="gallery-status error">
                上传失败
              </span>
              <div class="gallery-actions">
                <button
                  type="button"
                  @click="previewImageUrl = image.previewUrl"
                >
                  放大
                </button>
                <button type="button" @click="removeDisplayImage(image)">
                  删除
                </button>
              </div>
            </div>
            <button
              v-if="galleryImages.length < MAX_DISPLAY_IMAGES"
              class="gallery-add"
              type="button"
              :disabled="displayUploading"
              aria-label="添加展示图片"
              @click="openDisplayPicker"
            >
              <span>＋</span>
              <small>{{ displayUploading ? "上传中" : "添加图片" }}</small>
            </button>
          </div>
          <input
            ref="displayInput"
            class="file-input"
            type="file"
            accept="image/png,image/jpeg,.jpg,.jpeg,.png"
            multiple
            @change="handleDisplayChange"
          />
          <p class="cover-hint">最多 4 张；支持 PNG、JPG、JPEG，单张不超过 5 MiB</p>
          <p v-if="localDisplayError || displayUploadError" class="cover-error">
            {{ localDisplayError || displayUploadError }}
          </p>
        </div>

        <div class="info-block">
          <div class="section-label">✦ 展示视频</div>
          <div v-if="displayVideo" class="video-upload-item">
            <video
              :src="displayVideo.src"
              :poster="displayVideo.poster || undefined"
              controls
              preload="metadata"
            />
            <div>
              <strong>{{ displayVideo.title }}</strong>
              <span :class="['video-status', displayVideo.status]">
                {{ displayVideo.statusLabel }}
              </span>
              <button type="button" @click="removeDisplayedVideo">删除</button>
            </div>
          </div>
          <button
            v-else
            class="video-picker"
            type="button"
            :disabled="videoUploading"
            @click="openVideoPicker"
          >
            选择 MP4 视频
          </button>
          <input
            ref="videoInput"
            class="file-input"
            type="file"
            accept="video/mp4,.mp4"
            @change="handleVideoChange"
          />
          <p class="cover-hint">仅支持单个 MP4 视频</p>
          <p v-if="localVideoError || videoUploadError" class="cover-error">
            {{ localVideoError || videoUploadError }}
          </p>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="tagEditorOpen"
        class="tag-modal-backdrop"
        role="presentation"
        @click.self="closeTagEditor"
        @keydown.esc="closeTagEditor"
      >
        <form
          class="tag-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-modal-title"
          @submit.prevent="confirmTagDraft"
        >
          <header class="tag-modal-header">
            <h2 id="tag-modal-title">关卡标签</h2>
            <button
              class="tag-modal-close"
              type="button"
              aria-label="关闭关卡标签弹窗"
              @click="closeTagEditor"
            >
              ×
            </button>
          </header>

          <div class="tag-modal-content">
            <fieldset class="tag-fieldset">
              <legend>
                ✦ 游玩分类 <span aria-hidden="true">*</span>
                <small v-if="!canEditPlayCategory">首次发布后不可修改</small>
              </legend>
              <div class="tag-option-grid">
                <label
                  v-for="category in playCategoryOptions"
                  :key="category.play_cate"
                  :class="[
                    'tag-option',
                    { selected: editPlayCategory === category.play_cate, disabled: !canEditPlayCategory },
                  ]"
                >
                  <input
                    v-model="editPlayCategory"
                    type="radio"
                    name="play-category"
                    :value="category.play_cate"
                    :disabled="!canEditPlayCategory"
                  />
                  <span>{{ category.tag_name }}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="tag-fieldset">
              <legend>✦ 控制设备 <span aria-hidden="true">*</span></legend>
              <div class="tag-option-grid">
                <label
                  v-for="device in deviceOptions"
                  :key="device.tag_id"
                  :class="['tag-option', { selected: editDeviceIds.includes(device.tag_id) }]"
                >
                  <input
                    type="checkbox"
                    :checked="editDeviceIds.includes(device.tag_id)"
                    @change="toggleDevice(device.tag_id)"
                  />
                  <span>{{ device.tag_name }}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="tag-fieldset">
              <legend>✦ 玩法类型 <span aria-hidden="true">*</span></legend>
              <div class="tag-option-grid">
                <label
                  v-for="playType in playTypeOptions"
                  :key="playType.tag_id"
                  :class="['tag-option', { selected: editPlayTypeId === playType.tag_id }]"
                >
                  <input
                    v-model="editPlayTypeId"
                    type="radio"
                    name="play-type"
                    :value="playType.tag_id"
                  />
                  <span>{{ playType.tag_name }}</span>
                </label>
              </div>
            </fieldset>

            <fieldset class="tag-fieldset">
              <legend>✦ 更多标签（{{ editTagIds.length }}/6）</legend>
              <div class="tag-option-grid">
                <label
                  v-for="tag in tagOptions"
                  :key="tag.tag_id"
                  :class="['tag-option', { selected: editTagIds.includes(tag.tag_id) }]"
                >
                  <input
                    type="checkbox"
                    :checked="editTagIds.includes(tag.tag_id)"
                    @change="toggleExtraTag(tag.tag_id)"
                  />
                  <span>{{ tag.tag_name }}</span>
                </label>
              </div>
            </fieldset>
          </div>

          <footer class="tag-modal-footer">
            <p v-if="tagEditorError" class="tag-modal-error" role="alert">
              {{ tagEditorError }}
            </p>
            <button class="tag-confirm-button" type="submit">确认</button>
          </footer>
        </form>
      </div>

      <div
        v-if="previewImageUrl"
        class="image-preview"
        role="dialog"
        aria-modal="true"
        aria-label="展示图片预览"
        @click.self="previewImageUrl = ''"
      >
        <button type="button" aria-label="关闭预览" @click="previewImageUrl = ''">
          ×
        </button>
        <img :src="previewImageUrl" alt="展示图片大图预览" />
      </div>
    </Teleport>

    <section class="language-editor">
      <div class="editor-heading">
        <div>
          <span class="eyebrow">MULTI-LANGUAGE EDITOR</span>
          <h3>十五语内容编辑</h3>
        </div>
        <div class="editor-heading-actions">
          <span class="selected-count">
            已选择 {{ selectedLanguages.length }} 种语言
          </span>
          <div class="csv-actions">
            <button class="csv-button" type="button" @click="downloadLanguageCsv">
              下载 CSV
            </button>
            <button class="csv-button" type="button" @click="openCsvUpload">
              上传 CSV
            </button>
          </div>
        </div>
      </div>
      <input
        ref="csvInput"
        class="file-input"
        type="file"
        accept=".csv,text/csv"
        @change="handleCsvUpload"
      />
      <p v-if="csvMessage" :class="['csv-message', csvMessageKind]" role="status">
        {{ csvMessage }}
      </p>

      <div class="primary-language-row">
        <label for="primary-language">主要语言</label>
        <select
          id="primary-language"
          v-model="primaryLanguage"
          :disabled="!selectedLanguages.length"
        >
          <option
            v-for="code in selectedLanguages"
            :key="code"
            :value="code"
          >
            {{ languageDisplayLabel(code) }}
          </option>
        </select>
        <span>标题、玩法说明、关卡详情及最终上传均以此语言为准</span>
      </div>
      <p v-if="languageSelectionError" class="language-selection-error" role="alert">
        {{ languageSelectionError }}
      </p>

      <div class="editor-layout">
        <aside class="language-list">
          <label
            v-for="language in languageOptions"
            :key="language.code"
            :class="{ active: activeLanguage === language.code }"
          >
            <input
              type="checkbox"
              :checked="selectedLanguages.includes(language.code)"
              @change="toggleLanguage(language.code, $event)"
            />
            <button type="button" @click="selectLanguage(language.code)">
              <span>{{ languageDisplayLabel(language.code) }}</span>
            </button>
          </label>
        </aside>

        <div v-if="activeDraft" class="language-fields">
          <div class="active-language">
            <strong>{{ languageDisplayLabel(activeLanguage) }}</strong>
            <span v-if="activeLanguage === primaryLanguage">主要语言</span>
          </div>

          <label
            :class="{
              'field-over-limit': isFieldOverLimit('level_name', activeDraft.level_name),
            }"
          >
            <span class="field-label-row">
              <span>关卡名称</span>
              <span class="char-count">
                {{ activeDraft.level_name.length }}/{{ fieldLimit('level_name') }}
              </span>
            </span>
            <input v-model="activeDraft.level_name" type="text" />
            <span
              v-if="isFieldOverLimit('level_name', activeDraft.level_name)"
              class="field-error-msg"
              role="alert"
            >
              标题最多 {{ fieldLimit('level_name') }} 个字符
            </span>
          </label>

          <label
            :class="{
              'field-over-limit': isFieldOverLimit('level_intro', activeDraft.level_intro),
            }"
          >
            <span class="field-label-row">
              <span>玩法说明</span>
              <span class="char-count">
                {{ activeDraft.level_intro.length }}/{{ fieldLimit('level_intro') }}
              </span>
            </span>
            <textarea
              v-model="activeDraft.level_intro"
              rows="5"
              placeholder="请输入该语言的玩法说明"
            />
            <span
              v-if="isFieldOverLimit('level_intro', activeDraft.level_intro)"
              class="field-error-msg"
              role="alert"
            >
              玩法说明最多 {{ fieldLimit('level_intro') }} 个字符
            </span>
          </label>

          <label
            :class="{
              'field-over-limit': isFieldOverLimit('desc', activeDraft.desc),
            }"
          >
            <span class="field-label-row">
              <span>关卡详情</span>
              <span class="char-count">
                {{ activeDraft.desc.length }}/{{ fieldLimit('desc') }}
              </span>
            </span>
            <textarea
              v-model="activeDraft.desc"
              rows="10"
              placeholder="请输入该语言的关卡详情"
            />
            <span
              v-if="isFieldOverLimit('desc', activeDraft.desc)"
              class="field-error-msg"
              role="alert"
            >
              关卡详情最多 {{ fieldLimit('desc') }} 个字符
            </span>
          </label>
        </div>

        <div v-else class="empty-editor">
          请从左侧勾选并选择一种语言开始编辑。
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  buildLanguageCsv,
  collectLanguageValidationIssues,
  formatLanguageValidationMessage,
  getLanguageFieldLimit,
  isLanguageFieldOverLimit,
  languageDisplayLabel,
  LANGUAGE_NATIVE_NAMES,
  parseLanguageCsv,
  type LanguageCsvField,
} from "./csvHelpers";
import { isObjectUrl } from "./zipHelpers";
import type {
  LevelDetailData,
  LevelImageInfo,
  LevelInfoData,
} from "./levelApiTypes";
import type {
  EditorDraftState,
  EditorExportState,
  LanguageDraft,
  TagDraft,
  TagItem,
} from "./zipTypes";

interface ConfigData {
  play_type?: TagItem[];
  play_cate?: Array<{
    play_cate: string;
    tag_name: string;
  }>;
  langs?: string[];
  devices_control?: TagItem[];
  tags?: TagItem[];
}

interface DisplayUploadItem {
  img_id: string;
  previewUrl: string;
  uploadedUrl: string;
  status: "uploading" | "success" | "error";
  error: string;
  file?: File;
  sourceId?: string;
  objectKey?: string;
  md5?: string;
}

interface VideoUploadItem {
  id: string;
  fileName: string;
  previewUrl: string;
  status: "uploading" | "success" | "error";
  error: string;
  file?: File;
  url?: string;
  sourceId?: string;
  objectKey?: string;
  md5?: string;
}

interface OriginalDisplayItem extends LevelImageInfo {
  key: string;
}

interface GalleryImageItem {
  key: string;
  img_id: string;
  previewUrl: string;
  status: "original" | DisplayUploadItem["status"];
  error: string;
  source: "original" | "upload";
}

const props = defineProps<{
  config?: unknown;
  detail: LevelDetailData;
  coverUploading?: boolean;
  coverUploadError?: string;
  uploadedCoverUrl?: string;
  uploadedCoverRemoteUrl?: string;
  coverFile?: File | null;
  displayUploads?: DisplayUploadItem[];
  displayUploading?: boolean;
  displayUploadError?: string;
  videoUpload?: VideoUploadItem | null;
  videoUploading?: boolean;
  videoUploadError?: string;
}>();

const emit = defineEmits<{
  (event: "cover-selected", file: File): void;
  (event: "display-images-selected", files: File[]): void;
  (event: "display-image-removed", id: string): void;
  (event: "video-selected", file: File): void;
  (event: "video-removed"): void;
  (event: "tag-draft-change", draft: TagDraft): void;
}>();

const MAX_COVER_SIZE = 5 * 1024 * 1024;
const ALLOWED_COVER_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_DISPLAY_IMAGES = 4;
const DEFAULT_DEVICE_TAG_ID = "80001";

const selectedLanguages = ref<string[]>([]);
const activeLanguage = ref("");
const primaryLanguage = ref("");
const languageSelectionError = ref("");
const languageDrafts = ref<Record<string, LanguageDraft>>({});
const coverInput = ref<HTMLInputElement | null>(null);
const coverPreviewUrl = ref("");
const localCoverFile = ref<File | null>(null);
const hideOriginalCover = ref(false);
const localCoverError = ref("");
const displayInput = ref<HTMLInputElement | null>(null);
const localDisplayError = ref("");
const videoInput = ref<HTMLInputElement | null>(null);
const localVideoError = ref("");
const previewImageUrl = ref("");
const originalDisplayImages = ref<OriginalDisplayItem[]>([]);
const originalVideoUrl = ref("");
const originalVideoCover = ref("");
const originalVideoId = ref("");
const tagEditorOpen = ref(false);
const tagEditorError = ref("");
const tagDraft = ref<TagDraft>({
  play_cate: "",
  devices_control: [],
  play_type: null,
  tags: [],
});
const editPlayCategory = ref("");
const editDeviceIds = ref<string[]>([]);
const editPlayTypeId = ref("");
const editTagIds = ref<string[]>([]);
const csvInput = ref<HTMLInputElement | null>(null);
const csvMessage = ref("");
const csvMessageKind = ref<"success" | "error" | "info">("info");

const detailData = computed(() => props.detail);
const configData = computed(() => (props.config || {}) as ConfigData);
const info = computed<LevelInfoData>(() => detailData.value.info_data || {});
const meta = computed(() => detailData.value.meta_data || {});
const playCategoryOptions = computed(() => configData.value.play_cate || []);
const deviceOptions = computed(() => configData.value.devices_control || []);
const playTypeOptions = computed(() => configData.value.play_type || []);
const tagOptions = computed(() => configData.value.tags || []);
const languageOptions = computed(() =>
  (configData.value.langs || []).map((code) => ({
    code,
    nativeName: languageLabel(code),
  })),
);
const canEditPlayCategory = computed(() => {
  const explicit = detailData.value.op_info?.allow_edit_play_cate;
  return explicit === undefined ? !meta.value.has_online_once : explicit;
});

const devices = computed(
  () => tagDraft.value.devices_control,
);

const displayUploads = computed(() => props.displayUploads || []);
const galleryImages = computed<GalleryImageItem[]>(() => [
  ...originalDisplayImages.value.map((image) => ({
    key: image.key,
    img_id: image.img_id,
    previewUrl: image.img_url,
    status: "original" as const,
    error: "",
    source: "original" as const,
  })),
  ...displayUploads.value.map((image) => ({
    key: `upload:${image.img_id}`,
    img_id: image.img_id,
    previewUrl: image.previewUrl,
    status: image.status,
    error: image.error,
    source: "upload" as const,
  })),
]);
const videoUpload = computed(() => props.videoUpload || null);
const videoStatusLabel = computed(() => {
  if (videoUpload.value?.status === "uploading") return "上传中";
  if (videoUpload.value?.status === "success") return "上传成功";
  return videoUpload.value?.error || "上传失败";
});
const displayVideo = computed(() => {
  if (videoUpload.value) {
    return {
      src: videoUpload.value.previewUrl,
      poster: "",
      title: videoUpload.value.fileName,
      status: videoUpload.value.status,
      statusLabel: videoStatusLabel.value,
      source: "upload" as const,
    };
  }

  if (!originalVideoUrl.value) return null;
  return {
    src: originalVideoUrl.value,
    poster: originalVideoCover.value,
    title: "原展示视频",
    status: "original",
    statusLabel: "原视频",
    source: "original" as const,
  };
});
const displayCoverUrl = computed(
  () =>
    coverPreviewUrl.value ||
    props.uploadedCoverUrl ||
    (!hideOriginalCover.value ? info.value.cover_img?.img_url : "") ||
    "",
);

const playTypeName = computed(() => {
  const current = tagDraft.value.play_type;
  return (
    configData.value.play_type?.find(
      (item) => item.tag_id === current?.tag_id,
    )?.tag_name ||
    current?.tag_name ||
    "—"
  );
});

const playCategoryName = computed(
  () =>
    configData.value.play_cate?.find(
      (item) => item.play_cate === tagDraft.value.play_cate,
    )?.tag_name ||
    tagDraft.value.play_cate ||
    "—",
);

const tagSummary = computed(() => {
  const items: Array<{ key: string; name: string; primary: boolean }> = [];
  if (tagDraft.value.play_cate) {
    items.push({
      key: `category:${tagDraft.value.play_cate}`,
      name: playCategoryName.value,
      primary: true,
    });
  }
  for (const device of tagDraft.value.devices_control) {
    items.push({ key: `device:${device.tag_id}`, name: device.tag_name, primary: false });
  }
  if (tagDraft.value.play_type) {
    items.push({
      key: `type:${tagDraft.value.play_type.tag_id}`,
      name: playTypeName.value,
      primary: true,
    });
  }
  for (const tag of tagDraft.value.tags) {
    items.push({ key: `tag:${tag.tag_id}`, name: tag.tag_name, primary: false });
  }
  return items;
});

const playerCount = computed(() => {
  const raw = meta.value.player_count;
  if (!raw) return "—";

  const [minimum, maximum] = raw.split(",");
  return minimum === maximum || !maximum
    ? `${minimum} 人`
    : `${minimum}–${maximum} 人`;
});

const averageDuration = computed(() => {
  const seconds = Number(meta.value.pass_time);
  if (!Number.isFinite(seconds) || seconds < 0) return "—";

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}分${remainingSeconds.toString().padStart(2, "0")}秒`;
});

const performanceName = computed(() => {
  const names: Record<string, string> = {
    DEVICE_PERFORMANCE_LOW: "低",
    DEVICE_PERFORMANCE_MIDDLE: "中",
    DEVICE_PERFORMANCE_HIGH: "高",
  };
  return names[meta.value.device_performance || ""] || "—";
});

const activeDraft = computed(() =>
  activeLanguage.value
    ? languageDrafts.value[activeLanguage.value]
    : undefined,
);
const primaryDraft = computed(() =>
  primaryLanguage.value
    ? languageDrafts.value[primaryLanguage.value]
    : undefined,
);

watch(
  [() => props.detail, () => props.config],
  () => {
    clearCoverPreview();
    localCoverFile.value = null;
    hideOriginalCover.value = false;
    localCoverError.value = "";
    const source = detailData.value.info_data;
    originalDisplayImages.value = (source?.images || [])
      .filter((image) => Boolean(image.img_url))
      .slice(0, MAX_DISPLAY_IMAGES)
      .map((image, index) => ({
        ...image,
        key: `original:${image.img_id}:${index}`,
      }));
    originalVideoUrl.value = source?.video_info?.video_url || "";
    originalVideoCover.value = source?.video_info?.video_cover || "";
    originalVideoId.value = source?.video_info?.video_id || "";
    const online = detailData.value.online_data;
    const detailDevices =
      online?.online_devices_control ?? source?.devices_control ?? [];
    tagDraft.value = {
      play_cate: online?.online_play_cate ?? source?.play_cate ?? "",
      devices_control: detailDevices.length
        ? cloneTags(detailDevices)
        : cloneTags([
            deviceOptions.value.find(
              (item) => item.tag_id === DEFAULT_DEVICE_TAG_ID,
            ) || deviceOptions.value[0],
          ].filter((item): item is TagItem => Boolean(item))),
      play_type: cloneTag(online?.online_play_type ?? source?.play_type),
      tags: cloneTags(online?.online_tags ?? source?.tags ?? []),
    };
    emit("tag-draft-change", cloneTagDraft(tagDraft.value));
    if (!source) return;

    const drafts: Record<string, LanguageDraft> = {};
    for (const language of languageOptions.value) {
      const localized = source.multi_lang_info?.[language.code];
      const isDefault = language.code === source.default_lang;
      drafts[language.code] = {
        level_name:
          localized?.level_name || (isDefault ? source.level_name : "") || "",
        level_intro:
          localized?.level_intro || (isDefault ? source.level_intro : "") || "",
        desc: localized?.desc || (isDefault ? source.desc : "") || "",
        changelog: cloneChangelog(
          localized?.changelog ||
            (isDefault ? source.changelog : undefined) ||
            [],
        ),
        early_access_desc:
          localized?.early_access_desc ||
          (isDefault ? source.early_access_desc : "") ||
          "",
      };
    }

    languageDrafts.value = drafts;
    const configuredCodes = new Set(
      languageOptions.value.map((language) => language.code),
    );
    const savedLanguages = Object.keys(source.multi_lang_info || {}).filter(
      (code) => configuredCodes.has(code),
    );
    if (
      !savedLanguages.length &&
      source.default_lang &&
      configuredCodes.has(source.default_lang)
    ) {
      savedLanguages.push(source.default_lang);
    } else if (
      source.default_lang &&
      configuredCodes.has(source.default_lang) &&
      !savedLanguages.includes(source.default_lang)
    ) {
      savedLanguages.push(source.default_lang);
    }
    selectedLanguages.value = savedLanguages;
    primaryLanguage.value =
      source.default_lang && selectedLanguages.value.includes(source.default_lang)
        ? source.default_lang
        : selectedLanguages.value[0] || "";
    activeLanguage.value =
      primaryLanguage.value || selectedLanguages.value[0] || "";
    languageSelectionError.value = "";
  },
  { immediate: true },
);

watch(
  selectedLanguages,
  (languages) => {
    if (!languages.includes(activeLanguage.value)) {
      activeLanguage.value = languages[0] || "";
    }
    if (!languages.includes(primaryLanguage.value)) {
      primaryLanguage.value = languages[0] || "";
    }
  },
  { deep: true },
);

watch(primaryLanguage, (language) => {
  if (language && selectedLanguages.value.includes(language)) {
    activeLanguage.value = language;
  }
});

watch(
  () => props.coverUploadError,
  (error) => {
    if (error) clearCoverPreview();
  },
);

onBeforeUnmount(clearCoverPreview);

function openCoverPicker() {
  localCoverError.value = "";
  coverInput.value?.click();
}

function handleCoverChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";

  if (!file) return;

  if (!ALLOWED_COVER_TYPES.has(file.type)) {
    localCoverError.value = "仅支持 PNG、JPG 或 JPEG 图片。";
    return;
  }

  if (file.size > MAX_COVER_SIZE) {
    localCoverError.value = "封面图片不能超过 5 MiB。";
    return;
  }

  clearCoverPreview();
  localCoverError.value = "";
  localCoverFile.value = file;
  coverPreviewUrl.value = URL.createObjectURL(file);
  emit("cover-selected", file);
}

function openDisplayPicker() {
  localDisplayError.value = "";
  displayInput.value?.click();
}

function handleDisplayChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const selectedFiles = Array.from(input.files || []);
  input.value = "";
  localDisplayError.value = "";

  if (!selectedFiles.length) return;

  const slots = MAX_DISPLAY_IMAGES - galleryImages.value.length;
  if (selectedFiles.length > slots) {
    localDisplayError.value = `最多只能上传 ${MAX_DISPLAY_IMAGES} 张展示图片，本次仅处理前 ${slots} 张。`;
  }

  const files = selectedFiles.slice(0, slots);
  const invalidType = files.find((file) => !ALLOWED_COVER_TYPES.has(file.type));
  if (invalidType) {
    localDisplayError.value = `${invalidType.name}：仅支持 PNG、JPG 或 JPEG 图片。`;
    return;
  }

  const oversized = files.find((file) => file.size > MAX_COVER_SIZE);
  if (oversized) {
    localDisplayError.value = `${oversized.name}：图片不能超过 5 MiB。`;
    return;
  }

  emit("display-images-selected", files);
}

function removeDisplayImage(image: GalleryImageItem) {
  if (previewImageUrl.value === image.previewUrl) {
    previewImageUrl.value = "";
  }

  if (image.source === "original") {
    originalDisplayImages.value = originalDisplayImages.value.filter(
      (original) => original.key !== image.key,
    );
    localDisplayError.value = "";
    return;
  }

  emit("display-image-removed", image.img_id);
}

function openVideoPicker() {
  localVideoError.value = "";
  videoInput.value?.click();
}

function handleVideoChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  localVideoError.value = "";

  if (!file) return;
  if (file.type !== "video/mp4") {
    localVideoError.value = "仅支持 MP4 视频。";
    return;
  }

  emit("video-selected", file);
}

function removeDisplayedVideo() {
  localVideoError.value = "";
  if (displayVideo.value?.source === "upload") {
    emit("video-removed");
    return;
  }

  originalVideoUrl.value = "";
  originalVideoCover.value = "";
  originalVideoId.value = "";
}

function clearCoverPreview() {
  if (coverPreviewUrl.value) {
    URL.revokeObjectURL(coverPreviewUrl.value);
    coverPreviewUrl.value = "";
  }
}

function selectLanguage(code: string) {
  if (!selectedLanguages.value.includes(code)) {
    selectedLanguages.value.push(code);
  }
  languageSelectionError.value = "";
  activeLanguage.value = code;
}

function toggleLanguage(code: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  if (checked) {
    if (!selectedLanguages.value.includes(code)) {
      selectedLanguages.value.push(code);
    }
    if (!primaryLanguage.value) primaryLanguage.value = code;
    activeLanguage.value = code;
    languageSelectionError.value = "";
    return;
  }
  if (code === primaryLanguage.value) {
    (event.target as HTMLInputElement).checked = true;
    languageSelectionError.value = "请先切换主要语言，再取消该语言。";
    return;
  }
  selectedLanguages.value = selectedLanguages.value.filter(
    (language) => language !== code,
  );
  languageSelectionError.value = "";
}

function languageLabel(code: string) {
  return LANGUAGE_NATIVE_NAMES[code] || code;
}

function fieldLimit(field: LanguageCsvField) {
  return getLanguageFieldLimit(field);
}

function isFieldOverLimit(field: LanguageCsvField, value: string) {
  return isLanguageFieldOverLimit(field, value);
}

function validateLanguageDraftLimits(languages = selectedLanguages.value) {
  return collectLanguageValidationIssues(languages, languageDrafts.value);
}

function openCsvUpload() {
  csvMessage.value = "";
  csvInput.value?.click();
}

function downloadLanguageCsv() {
  csvMessage.value = "";
  const languages = languageOptions.value.map((language) => language.code);
  if (!languages.length) {
    csvMessageKind.value = "error";
    csvMessage.value = "当前配置未提供可用语言列表。";
    return;
  }

  const drafts: Record<string, LanguageDraft> = {};
  for (const code of languages) {
    drafts[code] = languageDrafts.value[code]
      ? {
          ...languageDrafts.value[code],
          changelog: cloneChangelog(languageDrafts.value[code].changelog || []),
        }
      : {
          level_name: "",
          level_intro: "",
          desc: "",
          changelog: [],
          early_access_desc: "",
        };
  }

  const csv = buildLanguageCsv(languages, drafts, languageDisplayLabel);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const levelId = detailData.value.level_id || "level";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = `oversea-i18n-${levelId}-${timestamp}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  csvMessageKind.value = "success";
  csvMessage.value = `已导出 ${languages.length} 种语言的 CSV 草稿。`;
}

async function handleCsvUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  csvMessage.value = "";

  if (!file) return;

  try {
    const text = await file.text();
    const knownLanguages = languageOptions.value.map((language) => language.code);
    if (!knownLanguages.length) {
      throw new Error("当前配置未提供可用语言列表。");
    }

    const drafts: Record<string, LanguageDraft> = {};
    for (const code of knownLanguages) {
      const existing = languageDrafts.value[code];
      drafts[code] = existing
        ? {
            ...existing,
            changelog: cloneChangelog(existing.changelog || []),
          }
        : {
            level_name: "",
            level_intro: "",
            desc: "",
            changelog: [],
            early_access_desc: "",
          };
    }

    const result = parseLanguageCsv(
      text,
      knownLanguages,
      languageDisplayLabel,
      drafts,
    );
    languageDrafts.value = drafts;

    for (const code of result.appliedLanguages) {
      if (!selectedLanguages.value.includes(code)) {
        selectedLanguages.value.push(code);
      }
    }
    if (!primaryLanguage.value && selectedLanguages.value.length) {
      primaryLanguage.value = selectedLanguages.value[0];
    }
    if (
      activeLanguage.value &&
      !result.appliedLanguages.includes(activeLanguage.value) &&
      result.appliedLanguages.length
    ) {
      activeLanguage.value = result.appliedLanguages[0];
    }
    languageSelectionError.value = "";

    const parts = [
      `已应用 ${result.appliedLanguages.length} 种语言。`,
      ...result.warnings,
    ];
    csvMessageKind.value = result.warnings.length ? "info" : "success";
    csvMessage.value = parts.join(" ");
  } catch (error) {
    csvMessageKind.value = "error";
    csvMessage.value =
      error instanceof Error ? error.message : "CSV 导入失败。";
  }
}

function openTagEditor() {
  editPlayCategory.value = tagDraft.value.play_cate;
  editDeviceIds.value = tagDraft.value.devices_control.map((item) => item.tag_id);
  editPlayTypeId.value = tagDraft.value.play_type?.tag_id || "";
  editTagIds.value = tagDraft.value.tags.map((item) => item.tag_id).slice(0, 6);
  tagEditorError.value = "";
  tagEditorOpen.value = true;
}

function closeTagEditor() {
  tagEditorOpen.value = false;
  tagEditorError.value = "";
}

function toggleDevice(id: string) {
  editDeviceIds.value = toggleId(editDeviceIds.value, id);
  tagEditorError.value = "";
}

function toggleExtraTag(id: string) {
  if (editTagIds.value.includes(id)) {
    editTagIds.value = editTagIds.value.filter((item) => item !== id);
    tagEditorError.value = "";
    return;
  }
  if (editTagIds.value.length >= 6) {
    tagEditorError.value = "更多标签最多可选择 6 个。";
    return;
  }
  editTagIds.value = [...editTagIds.value, id];
  tagEditorError.value = "";
}

function confirmTagDraft() {
  const selectedDevices = filterTags(deviceOptions.value, editDeviceIds.value);
  if (!selectedDevices.length) {
    tagEditorError.value = "请至少选择一个控制设备。";
    return;
  }
  if (!editPlayTypeId.value) {
    tagEditorError.value = "请选择一个玩法类型。";
    return;
  }
  if (editTagIds.value.length > 6) {
    tagEditorError.value = "更多标签最多可选择 6 个。";
    return;
  }

  const nextDraft: TagDraft = {
    play_cate: canEditPlayCategory.value
      ? editPlayCategory.value
      : tagDraft.value.play_cate,
    devices_control: selectedDevices,
    play_type:
      cloneTag(
        playTypeOptions.value.find((item) => item.tag_id === editPlayTypeId.value),
      ) || null,
    tags: filterTags(tagOptions.value, editTagIds.value),
  };
  tagDraft.value = nextDraft;
  emit("tag-draft-change", cloneTagDraft(nextDraft));
  closeTagEditor();
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function filterTags(options: TagItem[], ids: string[]) {
  return ids
    .map((id) => options.find((item) => item.tag_id === id))
    .filter((item): item is TagItem => Boolean(item))
    .map((item) => ({ ...item }));
}

function cloneTag(item?: TagItem | null) {
  return item ? { ...item } : null;
}

function cloneTags(items: TagItem[]) {
  return items.map((item) => ({ ...item }));
}

function cloneTagDraft(draft: TagDraft): TagDraft {
  return {
    play_cate: draft.play_cate,
    devices_control: cloneTags(draft.devices_control),
    play_type: cloneTag(draft.play_type),
    tags: cloneTags(draft.tags),
  };
}

function getExportState(): EditorExportState {
  const drafts: Record<string, LanguageDraft> = {};
  for (const language of languageOptions.value) {
    drafts[language.code] = languageDrafts.value[language.code]
      ? {
          ...languageDrafts.value[language.code],
          changelog: cloneChangelog(
            languageDrafts.value[language.code].changelog || [],
          ),
        }
      : {
          level_name: "",
          level_intro: "",
          desc: "",
          changelog: [],
          early_access_desc: "",
        };
  }
  const coverFile = props.coverFile || localCoverFile.value;
  const cover = coverFile
    ? {
        label: "封面",
        file: coverFile,
        fileName: coverFile.name,
        mimeType: coverFile.type,
        remoteUrl: props.uploadedCoverRemoteUrl || undefined,
      }
    : props.uploadedCoverRemoteUrl &&
        !isObjectUrl(props.uploadedCoverRemoteUrl)
      ? {
          label: "封面",
          remoteUrl: props.uploadedCoverRemoteUrl,
          fileName: fileNameFromUrl(props.uploadedCoverRemoteUrl, "cover"),
        }
    : !hideOriginalCover.value &&
        info.value.cover_img?.img_url &&
        !isObjectUrl(info.value.cover_img.img_url)
      ? {
          label: "封面",
          remoteUrl: info.value.cover_img.img_url,
          sourceId: info.value.cover_img.img_id,
          fileName: fileNameFromUrl(info.value.cover_img.img_url, "cover"),
        }
      : null;
  const displayImages = galleryImages.value.map((image, index) => {
    if (image.source === "original") {
      return {
        label: `展示图片 ${index + 1}`,
        remoteUrl: image.previewUrl,
        sourceId: image.img_id,
        fileName: fileNameFromUrl(image.previewUrl, `display-${index + 1}`),
      };
    }
    const upload = displayUploads.value.find((item) => item.img_id === image.img_id);
    return upload?.file
      ? {
          label: `展示图片 ${index + 1}`,
          file: upload.file,
          fileName: upload.file.name,
          mimeType: upload.file.type,
          remoteUrl: upload.uploadedUrl || undefined,
          sourceId: upload.sourceId,
          objectKey: upload.objectKey,
          md5: upload.md5,
        }
      : {
          label: `展示图片 ${index + 1}`,
          remoteUrl: upload?.uploadedUrl || undefined,
          sourceId: upload?.sourceId,
          objectKey: upload?.objectKey,
          md5: upload?.md5,
          fileName: fileNameFromUrl(upload?.uploadedUrl || "", `display-${index + 1}`),
        };
  });
  const currentVideo = videoUpload.value;
  const video = currentVideo?.file
    ? {
        label: "展示视频",
        file: currentVideo.file,
        fileName: currentVideo.file.name,
        mimeType: currentVideo.file.type,
        remoteUrl: currentVideo.url || undefined,
        sourceId: currentVideo.sourceId,
        objectKey: currentVideo.objectKey,
        md5: currentVideo.md5,
      }
    : currentVideo?.url && !isObjectUrl(currentVideo.url)
      ? {
          label: "展示视频",
          remoteUrl: currentVideo.url,
          fileName: currentVideo.fileName,
          mimeType: "video/mp4",
          sourceId: currentVideo.sourceId,
          objectKey: currentVideo.objectKey,
          md5: currentVideo.md5,
        }
      : originalVideoUrl.value
        ? {
            label: "展示视频",
            remoteUrl: originalVideoUrl.value,
            fileName: fileNameFromUrl(originalVideoUrl.value, "video.mp4"),
            mimeType: "video/mp4",
            sourceId: originalVideoId.value || undefined,
          }
        : null;

  return {
    tags: cloneTagDraft(tagDraft.value),
    selectedLanguages: [...selectedLanguages.value],
    defaultLang: primaryLanguage.value,
    drafts,
    cover,
    displayImages,
    video,
  };
}

function applyImportedDrafts(state: EditorDraftState) {
  const importedTags = cloneTagDraft(state.tags);
  if (!canEditPlayCategory.value) {
    importedTags.play_cate = tagDraft.value.play_cate;
  }
  tagDraft.value = importedTags;
  emit("tag-draft-change", cloneTagDraft(tagDraft.value));
  const drafts: Record<string, LanguageDraft> = {};
  for (const language of languageOptions.value) {
    const imported = state.drafts[language.code];
    drafts[language.code] = imported
      ? {
          ...imported,
          changelog: cloneChangelog(imported.changelog || []),
        }
      : {
          level_name: "",
          level_intro: "",
          desc: "",
          changelog: [],
          early_access_desc: "",
        };
  }
  languageDrafts.value = drafts;
  const configuredCodes = new Set(
    languageOptions.value.map((language) => language.code),
  );
  selectedLanguages.value = state.selectedLanguages.filter((code) =>
    configuredCodes.has(code),
  );
  primaryLanguage.value =
    state.defaultLang && selectedLanguages.value.includes(state.defaultLang)
      ? state.defaultLang
      : selectedLanguages.value[0] || "";
  activeLanguage.value = primaryLanguage.value;
  languageSelectionError.value = "";
}

function clearOriginalMediaForImport() {
  clearCoverPreview();
  localCoverFile.value = null;
  hideOriginalCover.value = true;
  originalDisplayImages.value = [];
  originalVideoUrl.value = "";
  originalVideoCover.value = "";
  originalVideoId.value = "";
  previewImageUrl.value = "";
}

function clearOriginalCoverForImport() {
  clearCoverPreview();
  localCoverFile.value = null;
  hideOriginalCover.value = true;
}

function clearOriginalDisplayForImport() {
  originalDisplayImages.value = [];
  previewImageUrl.value = "";
}

function clearOriginalVideoForImport() {
  originalVideoUrl.value = "";
  originalVideoCover.value = "";
  originalVideoId.value = "";
}

function cloneChangelog(
  items: Array<{ version_id?: string; edition?: string; content?: string }>,
) {
  return items.map((item) => ({
    version_id: item.version_id || "",
    edition: item.edition || "",
    content: item.content || "",
  }));
}

function fileNameFromUrl(url: string, fallback: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || fallback);
  } catch {
    return fallback;
  }
}

defineExpose({
  getExportState,
  applyImportedDrafts,
  clearOriginalMediaForImport,
  clearOriginalCoverForImport,
  clearOriginalDisplayForImport,
  clearOriginalVideoForImport,
  validateLanguageDraftLimits,
  formatLanguageValidationMessage: (issues: ReturnType<typeof collectLanguageValidationIssues>) =>
    formatLanguageValidationMessage(issues, languageDisplayLabel),
});
</script>

<style scoped>
.level-editor {
  margin-top: 24px;
  color: #312d42;
}

.level-overview {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.2fr);
  gap: 28px;
  padding: 22px;
  border: 1px solid #dedbe9;
  border-radius: 18px;
  background: #f7f7f8;
}

.level-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.level-title h3,
.editor-heading h3 {
  margin: 0;
  color: #29263b;
  font-size: 1.35rem;
}

.edit-mark {
  color: #6a5acd;
  font-size: 1.25rem;
}

.section-label {
  margin-bottom: 10px;
  padding: 9px 11px;
  border-radius: 7px;
  background: #e8e8eb;
  color: #383447;
  font-size: 0.9rem;
  font-weight: 800;
}

.cover-image,
.cover-placeholder {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 9px;
}

.cover-picker {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.cover-picker:disabled {
  cursor: wait;
}

.cover-image {
  display: block;
  object-fit: cover;
}

.cover-placeholder {
  display: grid;
  place-items: center;
  background: #dddbe5;
  color: #777285;
}

.cover-overlay {
  position: absolute;
  inset: auto 0 0;
  padding: 11px;
  background: rgba(35, 30, 55, 0.72);
  color: white;
  font-size: 0.85rem;
  font-weight: 700;
  opacity: 0;
  transition: opacity 0.2s;
}

.cover-picker:hover .cover-overlay,
.cover-picker:focus-visible .cover-overlay,
.cover-picker:disabled .cover-overlay {
  opacity: 1;
}

.file-input {
  display: none;
}

.cover-hint,
.cover-error,
.cover-success {
  margin: 8px 2px 0;
  font-size: 0.78rem;
}

.cover-hint {
  color: #817b8f;
}

.cover-error {
  color: #b42318;
}

.cover-success {
  color: #217a4b;
}

.facts {
  margin: 22px 0 0;
}

.facts > div {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  gap: 12px;
  padding: 10px 8px;
  border-bottom: 1px solid #dedce5;
}

.facts dt {
  color: #6f6a7e;
}

.facts dd {
  margin: 0;
  text-align: right;
  font-weight: 700;
}

.inline-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.inline-list span:not(:last-child)::after {
  content: " ·";
  color: #a19cac;
}

.overview-right {
  min-width: 0;
}

.info-block + .info-block {
  margin-top: 16px;
}

.multiline {
  max-height: 150px;
  margin: 0;
  overflow: auto;
  padding: 0 8px;
  color: #514c60;
  line-height: 1.65;
  white-space: pre-wrap;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 8px;
}

.tag-editor-trigger {
  display: flex;
  width: 100%;
  min-height: 46px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid #d4d0dc;
  border-radius: 12px;
  background: white;
  color: #514b60;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.tag-editor-trigger:hover,
.tag-editor-trigger:focus-visible {
  border-color: #6a5acd;
  outline: none;
  box-shadow: 0 0 0 3px rgba(106, 90, 205, 0.12);
}

.tag-editor-trigger .chips {
  flex: 1;
  padding: 0;
}

.tag-placeholder {
  color: #aaa5b2;
}

.tag-edit-icon {
  flex: none;
  color: #39364a;
  font-size: 1.25rem;
}

.tag-modal-backdrop {
  position: fixed;
  z-index: 1100;
  inset: 0;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 18px;
  background: rgba(20, 18, 29, 0.7);
}

.tag-modal {
  display: flex;
  width: min(920px, 100%);
  max-height: min(88vh, 820px);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #cfdae7;
  border-radius: 16px;
  background: #f7f7f8;
  box-shadow: 0 24px 70px rgba(20, 18, 29, 0.32);
  color: #312d42;
}

.tag-modal-header {
  position: relative;
  flex: none;
  padding: 20px 64px 15px;
  border-bottom: 1px solid #dce1e9;
  text-align: center;
}

.tag-modal-header h2 {
  margin: 0;
  font-size: 1.55rem;
}

.tag-modal-close {
  position: absolute;
  top: 10px;
  right: 18px;
  border: 0;
  background: transparent;
  color: #383747;
  font: inherit;
  font-size: 2rem;
  line-height: 1;
  cursor: pointer;
}

.tag-modal-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 56px 14px;
}

.tag-fieldset {
  min-width: 0;
  margin: 0 0 24px;
  padding: 0;
  border: 0;
}

.tag-fieldset legend {
  width: 100%;
  margin-bottom: 12px;
  color: #383447;
  font-weight: 800;
}

.tag-fieldset legend > span {
  color: #ef4b3f;
}

.tag-fieldset legend small {
  float: right;
  color: #ef4b3f;
  font-size: 0.78rem;
}

.tag-option-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.tag-option {
  display: flex;
  min-height: 40px;
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  padding: 7px 12px;
  border: 1px solid #d1d1d6;
  border-radius: 999px;
  background: white;
  box-shadow: 0 2px 4px rgba(30, 27, 42, 0.08);
  font-weight: 700;
  cursor: pointer;
}

.tag-option.selected {
  border-color: #4e5675;
  background: #4e5675;
  color: white;
}

.tag-option.disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.tag-option input {
  flex: none;
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: #31b66b;
}

.tag-option span {
  flex: 1;
  text-align: center;
}

.tag-modal-footer {
  flex: none;
  padding: 12px 24px 20px;
  text-align: center;
}

.tag-modal-error {
  margin: 0 0 9px;
  color: #b42318;
  font-size: 0.85rem;
}

.tag-confirm-button {
  min-width: 260px;
  padding: 11px 28px;
  border: 1px solid #3668aa;
  border-radius: 999px;
  background: #302e42;
  color: white;
  font: inherit;
  font-size: 1.05rem;
  font-weight: 800;
  cursor: pointer;
}

.chip {
  padding: 6px 12px;
  border-radius: 999px;
  background: #e7e5ec;
  color: #514b60;
  font-size: 0.82rem;
  font-weight: 700;
}

.chip-primary {
  background: #ffd43b;
  color: #4b3c00;
}

.language-chips {
  max-height: 104px;
  overflow: auto;
}

.language-empty {
  margin: 0;
  padding: 0 8px;
  color: #817b8f;
}

.gallery {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.gallery-item {
  position: relative;
  overflow: hidden;
  border-radius: 7px;
  background: #dddbe5;
}

.gallery-item img {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

.gallery-status {
  position: absolute;
  inset: auto 0 0;
  padding: 5px;
  background: rgba(35, 30, 55, 0.78);
  color: white;
  font-size: 0.7rem;
  text-align: center;
}

.gallery-status.error {
  background: rgba(180, 35, 24, 0.88);
}

.gallery-actions {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: rgba(35, 30, 55, 0.7);
  opacity: 0;
  transition: opacity 0.2s;
}

.gallery-item:hover .gallery-actions,
.gallery-item:focus-within .gallery-actions {
  opacity: 1;
}

.gallery-actions button {
  padding: 5px 8px;
  border: 0;
  border-radius: 5px;
  background: white;
  color: #383447;
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}

.gallery-add {
  display: grid;
  aspect-ratio: 16 / 9;
  place-items: center;
  align-content: center;
  border: 1px dashed #aaa4ba;
  border-radius: 7px;
  background: #f4f3f8;
  color: #6a5acd;
  cursor: pointer;
}

.gallery-add:disabled {
  cursor: wait;
  opacity: 0.65;
}

.gallery-add span {
  font-size: 1.7rem;
  line-height: 1;
}

.gallery-add small {
  color: #777285;
  font-size: 0.68rem;
}

.image-preview {
  position: fixed;
  z-index: 1000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 48px;
  background: rgba(18, 15, 28, 0.88);
}

.image-preview img {
  max-width: min(1100px, 92vw);
  max-height: 88vh;
  border-radius: 10px;
  object-fit: contain;
}

.image-preview button {
  position: absolute;
  top: 18px;
  right: 24px;
  border: 0;
  background: transparent;
  color: white;
  font-size: 2.2rem;
  cursor: pointer;
}

.video-picker {
  width: 100%;
  padding: 13px;
  border: 1px dashed #aaa4ba;
  border-radius: 8px;
  background: #f4f3f8;
  color: #5a4fb1;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.video-picker:disabled {
  cursor: wait;
  opacity: 0.65;
}

.video-upload-item {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid #dedbe9;
  border-radius: 8px;
  background: white;
}

.video-upload-item video,
.video-upload-item img {
  display: block;
  width: 100%;
  max-height: 280px;
  border-radius: 6px;
  background: #242033;
  object-fit: contain;
}

.video-upload-item > div {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.video-upload-item strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-status {
  color: #817b8f;
  font-size: 0.78rem;
}

.video-status.success {
  color: #217a4b;
}

.video-status.error {
  color: #b42318;
}

.video-upload-item button {
  flex: none;
  padding: 7px 11px;
  border: 0;
  border-radius: 6px;
  background: #fbe9e7;
  color: #b42318;
  font: inherit;
  cursor: pointer;
}

.language-editor {
  margin-top: 24px;
  padding: 22px;
  border: 1px solid #dedbe9;
  border-radius: 18px;
  background: white;
}

.editor-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.eyebrow {
  display: block;
  margin-bottom: 5px;
  color: #6a5acd;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.editor-heading-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.selected-count {
  color: #777285;
  font-size: 0.82rem;
}

.csv-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.csv-button {
  padding: 8px 14px;
  border: 1px solid #d4d0dc;
  border-radius: 999px;
  background: white;
  color: #4b4658;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.csv-button:hover,
.csv-button:focus-visible {
  border-color: #6a5acd;
  outline: none;
  box-shadow: 0 0 0 3px rgba(106, 90, 205, 0.12);
}

.csv-message {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 0.84rem;
}

.csv-message.success {
  background: #e8f8ef;
  color: #217a4b;
}

.csv-message.error {
  background: #fff0f0;
  color: #b42318;
}

.csv-message.info {
  background: #eef4ff;
  color: #315b91;
}

.editor-layout {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 20px;
}

.primary-language-row {
  display: grid;
  grid-template-columns: auto minmax(180px, 280px) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.primary-language-row label {
  font-weight: 800;
}

.primary-language-row select {
  height: 40px;
  padding: 0 10px;
  border: 1px solid #d9d5e5;
  border-radius: 8px;
  background: white;
  color: #2f2b3d;
  font: inherit;
}

.primary-language-row span {
  color: #817b8f;
  font-size: 0.8rem;
}

.language-selection-error {
  margin: -6px 0 14px;
  color: #b42318;
  font-size: 0.84rem;
}

.language-list {
  max-height: 540px;
  overflow: auto;
  border: 1px solid #e2dfeb;
  border-radius: 12px;
}

.language-list label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid #eeecf3;
  background: white;
}

.language-list label.active {
  background: #eeecff;
}

.language-list input {
  width: auto;
}

.language-list button {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
  border: 0;
  background: transparent;
  color: #383447;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.language-list small {
  color: #918b9e;
}

.language-fields {
  display: grid;
  align-content: start;
  gap: 16px;
}

.active-language {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid #e4e1ec;
}

.active-language span {
  color: #817b8f;
  font-size: 0.85rem;
}

.language-fields label {
  display: grid;
  gap: 7px;
  color: #4b4658;
  font-size: 0.88rem;
  font-weight: 700;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.char-count {
  color: #817b8f;
  font-size: 0.78rem;
  font-weight: 600;
}

.field-over-limit .char-count,
.field-error-msg {
  color: #b42318;
}

.field-over-limit input,
.field-over-limit textarea {
  border-color: #e07a72;
  background: #fff8f7;
}

.field-error-msg {
  font-size: 0.78rem;
  font-weight: 600;
}

.language-fields input,
.language-fields textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #d9d5e5;
  border-radius: 9px;
  background: #fbfaff;
  color: #2f2b3d;
  font: inherit;
  font-weight: 400;
  line-height: 1.55;
  resize: vertical;
}

.language-fields input {
  height: 44px;
  padding: 0 12px;
}

.language-fields textarea {
  padding: 11px 12px;
}

.empty-editor {
  display: grid;
  min-height: 220px;
  place-items: center;
  border: 1px dashed #ccc8d8;
  border-radius: 12px;
  color: #817b8f;
}

@media (max-width: 760px) {
  .level-overview,
  .editor-layout {
    grid-template-columns: 1fr;
  }

  .primary-language-row {
    grid-template-columns: 1fr;
  }

  .editor-heading {
    flex-direction: column;
    align-items: stretch;
  }

  .editor-heading-actions {
    align-items: stretch;
  }

  .csv-actions {
    justify-content: stretch;
  }

  .csv-button {
    flex: 1;
  }

  .gallery {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .language-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-height: 260px;
  }

  .tag-modal-backdrop {
    align-items: end;
    padding: 0;
  }

  .tag-modal {
    width: 100%;
    max-height: 92vh;
    border-radius: 16px 16px 0 0;
  }

  .tag-modal-content {
    padding: 18px;
  }

  .tag-option-grid {
    grid-template-columns: 1fr;
    gap: 9px;
  }

  .tag-fieldset legend small {
    float: none;
    display: block;
    margin-top: 4px;
  }

  .tag-confirm-button {
    width: 100%;
    min-width: 0;
  }
}
</style>
