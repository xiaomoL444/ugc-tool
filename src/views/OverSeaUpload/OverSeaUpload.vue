<template>
    <div class="upload-page">
        <Transition name="view-switch" mode="out-in">
            <section v-if="!tokenResponse" key="login" class="login-card">
                <div class="card-heading">
                    <span class="eyebrow">HOYOVERSE UGC</span>
                    <h1>获取 UGC Token</h1>
                    <p>
                        先通过 Client 接口获取 Token，再携带 Token Cookie 完成 Web 登录。
                    </p>
                </div>

                <form class="token-form" @submit.prevent="fetchToken">
                    <label for="server">服务器</label>
                    <select id="server" v-model="selectedServer" :disabled="loading">
                        <option v-for="server in servers" :key="server.value" :value="server.value">
                            {{ server.label }}
                        </option>
                    </select>

                    <label for="auth-key">authKey</label>
                    <input id="auth-key" v-model="authKeyInput" type="password" autocomplete="off" placeholder="请输入 authKey"
                        :disabled="loading" required />

                    <label for="login-worker-secret">Worker Secret</label>
                    <input id="login-worker-secret" v-model="workerSecret" type="password" autocomplete="off"
                        placeholder="请输入 PROXY_SECRET" :disabled="loading" required />

                    <button class="submit-button" type="submit" :disabled="loading">
                        {{ loading ? requestStage : "提交并登录" }}
                    </button>
                </form>

                <p v-if="errorMessage" class="message error-message" role="alert">
                    {{ errorMessage }}
                </p>
            </section>

            <div v-else key="workspace" class="workspace-shell">
                <header class="account-topbar">
                    <div class="account-topbar-main">
                        <div class="account-topbar-title">
                            <span class="eyebrow">UGC ACCOUNT</span>
                            <span class="success-badge">已登录</span>
                        </div>

                        <div v-if="tokenResponse.data" class="account-stats">
                            <span v-if="loggedInServerLabel" class="account-chip account-chip-primary">
                                {{ loggedInServerLabel }}
                            </span>
                            <span class="account-chip">
                                <span class="account-chip-label">昵称</span>
                                {{ tokenResponse.data.nickname || "—" }}
                            </span>
                            <span class="account-chip">
                                <span class="account-chip-label">UID</span>
                                {{ tokenResponse.data.uid || "—" }}
                            </span>
                            <span class="account-chip">
                                <span class="account-chip-label">等级</span>
                                {{ tokenResponse.data.level || "—" }}
                            </span>
                            <span class="account-chip">
                                <span class="account-chip-label">区域</span>
                                {{ tokenResponse.data.region || "—" }}
                            </span>
                            <span class="account-chip">
                                <span class="account-chip-label">有效</span>
                                {{ tokenResponse.data.expire || "—" }}s
                            </span>
                        </div>

                        <div class="account-topbar-actions">
                            <button
                                class="topbar-button"
                                type="button"
                                :aria-expanded="accountExpanded"
                                @click="accountExpanded = !accountExpanded"
                            >
                                {{ accountExpanded ? "收起 Token" : "展开 Token" }}
                            </button>
                            <button class="topbar-button topbar-button-muted" type="button" @click="resetLogin">
                                重新登录
                            </button>
                        </div>
                    </div>

                    <Transition name="topbar-expand">
                        <div v-if="accountExpanded && tokenResponse.data" class="account-topbar-detail">
                            <div class="account-token-row">
                                <span class="account-chip-label">UGC Token</span>
                                <code class="account-token-value">{{ tokenResponse.data.ugc_token || "（返回值为空）" }}</code>
                            </div>
                            <details class="account-json-details">
                                <summary>查看完整 JSON</summary>
                                <pre>{{ formattedResponse }}</pre>
                            </details>
                        </div>
                    </Transition>
                </header>

                <div
                    class="workspace"
                    :class="{ 'workspace--with-actions': detailResponse?.data }"
                >
                    <main class="panel-main">
                        <section v-if="tokenResponse.data" class="result-card">
                            <div class="card-heading">
                                <span class="eyebrow">LEVEL DATA</span>
                                <h2>查询关卡数据</h2>
                                <p>输入关卡 ID，通过 Cloudflare Worker 获取玩法配置和关卡详情。</p>
                            </div>

                            <form class="token-form level-query-form" @submit.prevent="fetchLevelData">
                                <label for="level-id">关卡 ID</label>
                                <input id="level-id" v-model="levelIdInput" type="text" inputmode="numeric" autocomplete="off"
                                    placeholder="请输入 level_id" :disabled="levelLoading" required />

                                <button class="submit-button" type="submit" :disabled="levelLoading">
                                    {{ levelLoading ? "正在获取关卡数据…" : "查询关卡" }}
                                </button>
                            </form>

                            <p v-if="levelErrorMessage" class="message error-message" role="alert">
                                {{ levelErrorMessage }}
                            </p>
                        </section>

                        <section v-if="configResponse || detailResponse" class="result-card level-results">
                            <div class="result-heading">
                                <div>
                                    <span class="eyebrow">LEVEL RESULT</span>
                                    <h2>关卡查询结果</h2>
                                </div>
                                <span class="success-badge">查询完成</span>
                            </div>

                            <div v-if="detailResponse?.data" class="online-language-panel">
                                <div>
                                    <h3>简介支持语言</h3>
                                    <div v-if="onlineDetailLanguages.length" class="online-language-chips">
                                        <span v-for="lang in onlineDetailLanguages" :key="`detail-${lang}`" class="chip">
                                            {{ languageDisplayLabel(lang) }}
                                        </span>
                                    </div>
                                    <p v-else class="online-language-empty">暂无</p>
                                </div>
                                <div>
                                    <h3>游戏内支持语言</h3>
                                    <div v-if="onlineLevelLanguages.length" class="online-language-chips">
                                        <span v-for="lang in onlineLevelLanguages" :key="`level-${lang}`" class="chip">
                                            {{ languageDisplayLabel(lang) }}
                                        </span>
                                    </div>
                                    <p v-else class="online-language-empty">暂无</p>
                                </div>
                            </div>

                            <LevelEditor ref="levelEditorRef" v-if="detailResponse?.data" :config="configResponse?.data" :detail="detailResponse.data"
                                :cover-uploading="coverUploading" :cover-upload-error="coverUploadError"
                                :uploaded-cover-url="uploadedCoverUrl" :cover-file="currentCoverFile"
                                :uploaded-cover-remote-url="uploadedCoverRemoteUrl"
                                :display-uploads="uploadedDisplayImages"
                                :display-uploading="displayUploading" :display-upload-error="displayUploadError"
                                :video-upload="uploadedVideo" :video-uploading="videoUploading"
                                :video-upload-error="videoUploadError"
                                @cover-selected="uploadCover" @display-images-selected="uploadDisplayImages"
                                @display-image-removed="removeDisplayImage" @video-selected="uploadVideo"
                                @video-removed="removeVideo" @tag-draft-change="updateTagDraft" />

                            <details v-if="configResponse">
                                <summary>玩法类型数据</summary>
                                <pre>{{ formattedConfigResponse }}</pre>
                            </details>

                            <details v-if="detailResponse">
                                <summary>关卡详细数据</summary>
                                <pre>{{ formattedDetailResponse }}</pre>
                            </details>
                        </section>
                    </main>

                    <Transition name="actions-slide">
                        <aside v-if="detailResponse?.data" class="panel-actions">
                            <section class="result-card action-card zip-card">
                                <div class="card-heading">
                                    <span class="eyebrow">BACKUP</span>
                                    <h2>ZIP 导入导出</h2>
                                    <p>保存或导入媒体、标签与十五语草稿。</p>
                                </div>
                                <div class="zip-actions">
                                    <button class="submit-button" type="button" :disabled="zipBusy || uploadsBusy"
                                        @click="savePageAsZip">
                                        保存为 ZIP
                                    </button>
                                    <button class="submit-button secondary-button" type="button" :disabled="zipBusy || uploadsBusy"
                                        @click="zipInput?.click()">
                                        导入 ZIP
                                    </button>
                                </div>
                                <input ref="zipInput" class="hidden-file-input" type="file" accept=".zip,application/zip"
                                    @change="handleZipImport" />
                                <div v-if="zipBusy || zipProgress" class="zip-progress" aria-live="polite">
                                    <progress v-if="zipBusy" :value="zipPercent" max="100" />
                                    <span>{{ zipProgress }}</span>
                                </div>
                                <p v-if="zipError" class="message error-message" role="alert">{{ zipError }}</p>
                                <p v-else-if="zipSuccess" class="message success-message" role="status">{{ zipSuccess }}</p>
                            </section>

                            <section class="result-card action-card upload-card">
                                <div class="card-heading">
                                    <span class="eyebrow">SUBMIT</span>
                                    <h2>上传关卡信息</h2>
                                    <p>提交标签、十五语与媒体引用，成功后保留编辑内容。</p>
                                </div>
                                <button class="submit-button upload-level-button" type="button"
                                    :disabled="uploadDisabled" @click="uploadLevelInfo">
                                    {{ uploadButtonLabel }}
                                </button>
                                <p v-if="uploadDisabledReason && !uploadingLevel" class="upload-disabled-hint">
                                    {{ uploadDisabledReason }}
                                </p>
                                <p v-if="uploadMessage" :class="['message', uploadMessageKind === 'error'
                                    ? 'error-message' : uploadMessageKind === 'success'
                                        ? 'success-message' : 'info-message']"
                                    :role="uploadMessageKind === 'error' ? 'alert' : 'status'">
                                    {{ uploadMessage }}
                                </p>
                                <details v-if="uploadResponse">
                                    <summary>查看上传返回 JSON</summary>
                                    <pre>{{ formattedUploadResponse }}</pre>
                                </details>
                            </section>
                        </aside>
                    </Transition>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup lang="ts">
import axios from "axios";
import SparkMD5 from "spark-md5";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import LevelEditor from "./LevelEditor.vue";
import {
  collectLanguageValidationIssues,
  formatLanguageValidationMessage,
  languageDisplayLabel,
} from "./csvHelpers";
import type {
    LevelChangelogItem,
    LevelDetailData,
    LevelLanguageContent,
    LevelUploadPayload,
    LevelUploadResponse,
} from "./levelApiTypes";
import {
    createExportZip,
    isObjectUrl,
    MAX_IMAGE_SIZE,
    readImportZip,
} from "./zipHelpers";
import type { ResolvedMedia } from "./zipHelpers";
import type {
    EditorExportState,
    EditorMediaSource,
    ImportedZip,
    TagDraft,
    ZipMediaEntry,
} from "./zipTypes";

type ServerValue = "cht" | "asia" | "eu" | "us";

interface TokenData {
    ugc_token: string;
    expire: string;
    nickname: string;
    level: string;
    uid: string;
    region: string;
}

interface TokenResponse {
    retcode: number;
    message: string;
    data?: TokenData;
}

interface LevelResponse<T = unknown> {
    retcode: number;
    message: string;
    data?: T;
}

interface OssUploadParams {
    file_name: string;
    oss: {
        accessid: string;
        callback: string;
        callback_var?: Record<string, string>;
        content_disposition?: string;
        extra_form_data?: unknown;
        host: string;
        key?: string;
        name: string;
        object_acl: string;
        policy: string;
        signature: string;
        x_oss_content_type: string;
    };
    max_file_size?: number;
}

interface UploadParamsResponse {
    retcode: number;
    message: string;
    data?: OssUploadParams;
}

interface ProxyOptions {
    method?: "GET" | "POST";
    data?: Record<string, unknown>;
    responseType?: "json" | "blob";
}

interface ResourceUploadResult {
    url: string;
    secretUrl: string;
    object: string;
    result: {
        md5: string;
        ext: "png" | "jpg" | "mp4";
        biz: string;
        fileName: string;
        params: OssUploadParams;
        callback: unknown;
        callbackData: OssCallbackData;
    };
}

interface OssCallbackData {
    url: string;
    secret_url: string;
    object: string;
}

interface DisplayUploadItem {
    img_id: string;
    previewUrl: string;
    uploadedUrl: string;
    status: "uploading" | "success" | "error";
    error: string;
    result: ResourceUploadResult["result"] | null;
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
    url: string;
    secretUrl: string;
    object: string;
    result: ResourceUploadResult["result"] | null;
    file?: File;
    sourceId?: string;
    objectKey?: string;
    md5?: string;
}

const WORKER_URL = "https://ugc-tool.2802273114.workers.dev/";
const WORKER_SECRET_STORAGE_KEY = "oversea-upload-worker-secret";
const GAME_USER_AGENT =
    "Mozilla/5.0 (Windows NT 6.1; Unity 3D; ZFBrowser 2.1.0; " +
    "Genshin Impact 6.7.0_45486583_45768959) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/100.0.4896.0 Safari/537.36 " +
    "hoyoverse/hk4e/os_cht/zh-cn/6.7.0";

const servers: Array<{ value: ServerValue; label: string }> = [
    { value: "cht", label: "港澳台服" },
    { value: "asia", label: "亚服" },
    { value: "eu", label: "欧服" },
    { value: "us", label: "美服" },
];

const selectedServer = ref<ServerValue>("cht");
const authKeyInput = ref("");
const storedAuthKey = ref("");
const loading = ref(false);
const requestStage = ref("正在获取 Token…");
const errorMessage = ref("");
const tokenResponse = ref<TokenResponse | null>(null);
const loggedInServer = ref<ServerValue | null>(null);
const sessionToken = ref("");
const levelIdInput = ref("");
const storedLevelId = ref("");
const workerSecret = ref("");
const accountExpanded = ref(false);
const levelLoading = ref(false);
const levelErrorMessage = ref("");
const configResponse = ref<LevelResponse | null>(null);
const detailResponse = ref<LevelResponse<LevelDetailData> | null>(null);
const coverUploading = ref(false);
const coverUploadError = ref("");
const uploadedCoverUrl = ref("");
const uploadedCoverRemoteUrl = ref("");
const uploadedCoverResult = ref<Partial<ResourceUploadResult["result"]> | null>(null);
const uploadedDisplayImages = ref<DisplayUploadItem[]>([]);
const displayUploading = computed(() =>
    uploadedDisplayImages.value.some((image) => image.status === "uploading"),
);
const displayUploadError = ref("");
const uploadedVideo = ref<VideoUploadItem | null>(null);
const videoUploading = computed(
    () => uploadedVideo.value?.status === "uploading",
);
const videoUploadError = ref("");
const levelTagDraft = ref<TagDraft | null>(null);
const currentCoverFile = ref<File | null>(null);
const levelEditorRef = ref<{
    getExportState: () => EditorExportState;
    applyImportedDrafts: (state: ImportedZip["manifest"]["editor"]) => void;
    clearOriginalMediaForImport: () => void;
    clearOriginalCoverForImport: () => void;
    clearOriginalDisplayForImport: () => void;
    clearOriginalVideoForImport: () => void;
} | null>(null);
const zipInput = ref<HTMLInputElement | null>(null);
const zipBusy = ref(false);
const zipPercent = ref(0);
const zipProgress = ref("");
const zipError = ref("");
const zipSuccess = ref("");
const uploadingLevel = ref(false);
const uploadMessage = ref("");
const uploadMessageKind = ref<"success" | "info" | "error">("info");
const uploadResponse = ref<LevelUploadResponse | null>(null);
const uploadCooldown = ref(0);
let uploadCooldownTimer: ReturnType<typeof setInterval> | null = null;
const uploadsBusy = computed(
    () => coverUploading.value || displayUploading.value || videoUploading.value,
);
const uploadDisabledReason = computed(() => {
    if (!tokenResponse.value?.data || !loggedInServer.value || !sessionToken.value) {
        return "请先完成登录。";
    }
    if (!detailResponse.value?.data || !storedLevelId.value) {
        return "请先查询关卡。";
    }
    if (!workerSecret.value.trim()) return "请填写 Worker Secret。";
    if (uploadsBusy.value) return "媒体仍在上传，请等待全部上传完成。";
    if (uploadCooldown.value > 0) {
        return `提交冷却中，还需等待 ${uploadCooldown.value} 秒。`;
    }
    return "";
});
const uploadDisabled = computed(
    () => uploadingLevel.value || Boolean(uploadDisabledReason.value),
);
const uploadButtonLabel = computed(() => {
    if (uploadingLevel.value) return "正在上传关卡信息…";
    if (uploadCooldown.value > 0) return `请等待 ${uploadCooldown.value} 秒`;
    return "上传关卡信息";
});

const formattedResponse = computed(() =>
    tokenResponse.value ? JSON.stringify(tokenResponse.value, null, 2) : "",
);
const formattedConfigResponse = computed(() =>
    configResponse.value ? JSON.stringify(configResponse.value, null, 2) : "",
);
const formattedDetailResponse = computed(() =>
    detailResponse.value ? JSON.stringify(detailResponse.value, null, 2) : "",
);
const formattedUploadResponse = computed(() =>
    uploadResponse.value ? JSON.stringify(uploadResponse.value, null, 2) : "",
);
const onlineDetailLanguages = computed(
    () => detailResponse.value?.data?.online_data?.online_detail_langs || [],
);
const onlineLevelLanguages = computed(
    () => detailResponse.value?.data?.online_data?.online_level_langs || [],
);
const loggedInServerLabel = computed(() => {
    if (!loggedInServer.value) return "";
    return servers.find((server) => server.value === loggedInServer.value)?.label || loggedInServer.value;
});

onMounted(() => {
    loadWorkerSecret();
});

onBeforeUnmount(() => {
    clearCoverUpload();
    clearDisplayUploads();
    removeVideo();
    if (uploadCooldownTimer) clearInterval(uploadCooldownTimer);
});

function resetLogin() {
    accountExpanded.value = false;
    tokenResponse.value = null;
    loggedInServer.value = null;
    sessionToken.value = "";
    errorMessage.value = "";
    levelIdInput.value = "";
    storedLevelId.value = "";
    levelErrorMessage.value = "";
    configResponse.value = null;
    detailResponse.value = null;
    resetUploadResult();
    coverUploadError.value = "";
    clearCoverUpload();
    levelTagDraft.value = null;
    clearDisplayUploads();
    removeVideo();
    zipError.value = "";
    zipSuccess.value = "";
    zipProgress.value = "";
}

async function fetchToken() {
    const normalizedAuthKey = authKeyInput.value.trim();

    if (!normalizedAuthKey) {
        errorMessage.value = "请输入 authKey。";
        return;
    }

    if (!workerSecret.value) {
        errorMessage.value = "请输入 Worker Secret。";
        return;
    }

    storedAuthKey.value = normalizedAuthKey;
    loading.value = true;
    requestStage.value = "正在获取 Token…";
    errorMessage.value = "";
    tokenResponse.value = null;
    loggedInServer.value = null;
    sessionToken.value = "";
    configResponse.value = null;
    detailResponse.value = null;
    resetUploadResult();
    coverUploadError.value = "";
    clearCoverUpload();
    levelTagDraft.value = null;
    clearDisplayUploads();
    removeVideo();

    try {
        const clientParams = new URLSearchParams({
            sign_type: "2",
            auth_appid: "ugc_login",
            authkey_ver: "1",
            authkey: storedAuthKey.value,
            lang: "zh-cn",
        });
        const clientUrl =
            `https://${selectedServer.value}-ugc-api.hoyoverse.com` +
            `/ugc_login/v1/client/ugc_token?${clientParams.toString()}`;
        const response = await proxyRequest<TokenResponse>(
            clientUrl,
            buildCookie(""),
        );

        if (response.retcode !== 0) {
            errorMessage.value = `获取 Token 失败（${response.retcode}）：${response.message}`;
            return;
        }

        const clientData = response.data;

        if (!clientData?.ugc_token) {
            errorMessage.value = "Client 登录成功，但没有返回 ugc_token。";
            return;
        }

        sessionToken.value = clientData.ugc_token;
        requestStage.value = "正在完成 Web 登录…";

        const webParams = new URLSearchParams({
            authkey: storedAuthKey.value,
            auth_appid: "ugc_login",
            authkey_ver: "1",
            sign_type: "2",
            lang: "zh-cn",
            server_version: "1",
        });
        const webUrl =
            `https://${selectedServer.value}-ugc-api.hoyoverse.com` +
            `/ugc_login/v1/web/ugc_token?${webParams.toString()}`;
        const webResponse = await proxyRequest<TokenResponse>(
            webUrl,
            buildCookie(sessionToken.value),
        );

        if (webResponse.retcode !== 0) {
            errorMessage.value = `Web 登录失败（${webResponse.retcode}）：${webResponse.message}`;
            return;
        }

        if (!webResponse.data?.ugc_token) {
            errorMessage.value = "Web 登录成功，但没有返回新的 ugc_token。";
            return;
        }

        sessionToken.value = webResponse.data.ugc_token;
        tokenResponse.value = webResponse;
        loggedInServer.value = selectedServer.value;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const apiData = error.response?.data as
                | (Partial<TokenResponse> & { error?: string })
                | undefined;
            errorMessage.value =
                apiData?.error ||
                apiData?.message ||
                (error.response
                    ? `Worker 请求失败，HTTP 状态码：${error.response.status}`
                    : "无法连接 Cloudflare Worker。");
        } else {
            errorMessage.value = "发生未知错误，请稍后重试。";
        }
    } finally {
        loading.value = false;
    }
}

async function fetchLevelData() {
    const loginData = tokenResponse.value?.data;
    const server = loggedInServer.value;
    const normalizedLevelId = levelIdInput.value.trim();

    if (!loginData || !server) {
        levelErrorMessage.value = "请先完成登录。";
        return;
    }

    if (!sessionToken.value || !loginData.uid || !loginData.region) {
        levelErrorMessage.value = "登录结果缺少 Token、UID 或区域信息。";
        return;
    }

    if (!normalizedLevelId) {
        levelErrorMessage.value = "请输入关卡 ID。";
        return;
    }

    if (!workerSecret.value) {
        levelErrorMessage.value = "请输入 Worker Secret。";
        return;
    }

    storedLevelId.value = normalizedLevelId;
    levelLoading.value = true;
    levelErrorMessage.value = "";
    configResponse.value = null;
    detailResponse.value = null;
    resetUploadResult();
    coverUploadError.value = "";
    clearCoverUpload();
    levelTagDraft.value = null;
    clearDisplayUploads();
    removeVideo();

    const baseUrl = `https://${server}-ugc-api.hoyoverse.com`;
    const commonParams = new URLSearchParams({
        level_id: storedLevelId.value,
        lang: "zh-cn",
        ugc_login_uid: loginData.uid,
        ugc_login_region: loginData.region,
        server_version: "1",
    });
    const cookie = buildCookie(sessionToken.value);

    try {
        const [configResult, detailResult] = await Promise.all([
            proxyRequest<LevelResponse>(
                `${baseUrl}/ugc_gateway/v1/levels/info/config?${commonParams.toString()}`,
                cookie,
            ),
            proxyRequest<LevelResponse<LevelDetailData>>(
                `${baseUrl}/ugc_gateway/v1/levels/info/detail?${commonParams.toString()}`,
                cookie,
            ),
        ]);

        configResponse.value = configResult;
        detailResponse.value = detailResult;

        const failedResponse = [configResult, detailResult].find(
            (response) => response.retcode !== 0,
        );

        if (failedResponse) {
            levelErrorMessage.value = `关卡接口返回错误（${failedResponse.retcode}）：${failedResponse.message}`;
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const workerError = error.response?.data as { error?: string } | undefined;
            levelErrorMessage.value =
                workerError?.error ||
                (error.response
                    ? `Worker 请求失败，HTTP 状态码：${error.response.status}`
                    : "无法连接 Cloudflare Worker。");
        } else {
            levelErrorMessage.value = "获取关卡数据时发生未知错误。";
        }
    } finally {
        levelLoading.value = false;
    }
}

async function uploadLevelInfo() {
    if (uploadDisabledReason.value) {
        uploadMessageKind.value = "error";
        uploadMessage.value = uploadDisabledReason.value;
        return;
    }
    const editor = levelEditorRef.value;
    const loginData = tokenResponse.value?.data;
    const server = loggedInServer.value;
    if (!editor || !loginData || !server) {
        uploadMessageKind.value = "error";
        uploadMessage.value = "登录或关卡编辑器尚未就绪。";
        return;
    }

    let payload: LevelUploadPayload;
    try {
        payload = buildLevelUploadPayload(editor.getExportState());
    } catch (error) {
        uploadMessageKind.value = "error";
        uploadMessage.value =
            error instanceof Error ? error.message : "关卡信息校验失败。";
        return;
    }

    if (!window.confirm("即将上传当前关卡信息。请确认标签、多语言内容和媒体均已检查无误，是否继续？")) {
        uploadMessageKind.value = "info";
        uploadMessage.value = "已取消上传，编辑内容未发生变化。";
        return;
    }

    uploadingLevel.value = true;
    uploadMessage.value = "";
    uploadResponse.value = null;
    const query = new URLSearchParams({
        lang: "zh-cn",
        ugc_login_uid: loginData.uid,
        ugc_login_region: loginData.region,
        server_version: "1",
    });
    const url =
        `https://${server}-ugc-api.hoyoverse.com` +
        `/ugc_gateway/v1/levels/info/upload?${query.toString()}`;

    try {
        const result = await proxyRequest<LevelUploadResponse>(
            url,
            buildCookie(sessionToken.value),
            { method: "POST", data: payload as unknown as Record<string, unknown> },
        );
        uploadResponse.value = result;
        if (result.retcode === 0) {
            uploadMessageKind.value = "success";
            uploadMessage.value = "关卡信息上传成功。当前编辑内容已保留。";
        } else if (result.retcode === -2000438) {
            uploadMessageKind.value = "info";
            uploadMessage.value = result.message || "信息页未发生变化。";
        } else if (result.retcode === -2000448) {
            uploadMessageKind.value = "error";
            uploadMessage.value = result.message || "信息页提交过于频繁，请稍后重试。";
            startUploadCooldown(30);
        } else {
            uploadMessageKind.value = "error";
            uploadMessage.value = `上传失败（${result.retcode}）：${result.message || "未知错误"}`;
        }
    } catch (error) {
        uploadMessageKind.value = "error";
        if (axios.isAxiosError(error)) {
            const workerError = error.response?.data as
                | { error?: string; message?: string }
                | undefined;
            uploadMessage.value =
                workerError?.error ||
                workerError?.message ||
                (error.response
                    ? `Worker 请求失败，HTTP 状态码：${error.response.status}`
                    : "无法连接 Cloudflare Worker。");
        } else {
            uploadMessage.value = "上传关卡信息时发生未知错误。";
        }
    } finally {
        uploadingLevel.value = false;
    }
}

function buildLevelUploadPayload(state: EditorExportState): LevelUploadPayload {
    const detail = detailResponse.value?.data;
    const source = detail?.info_data;
    if (!detail || !source) throw new Error("关卡详情数据不完整，请重新查询。");
    if (uploadsBusy.value) throw new Error("媒体仍在上传，请稍后再提交。");

    const levelId = storedLevelId.value || detail.level_id || levelIdInput.value.trim();
    if (!levelId) throw new Error("缺少关卡 ID。");
    const defaultLang = state.defaultLang;
    if (!defaultLang || !state.selectedLanguages.includes(defaultLang)) {
        throw new Error("默认语言必须包含在已选择语言中。");
    }
    const defaultDraft = state.drafts[defaultLang];
    if (
        !defaultDraft?.level_name.trim() ||
        !defaultDraft.level_intro.trim() ||
        !defaultDraft.desc.trim()
    ) {
        throw new Error("默认语言的关卡名称、玩法说明和关卡详情均不能为空。");
    }
    if (!state.tags.devices_control.length) throw new Error("请至少选择一个控制设备。");
    if (!state.tags.play_type?.tag_id) throw new Error("请选择玩法类型。");
    if (state.tags.tags.length > 6) throw new Error("更多标签最多可选择 6 个。");
    if (!state.tags.play_cate) throw new Error("缺少玩法分类。");

    const lengthIssues = collectLanguageValidationIssues(
        state.selectedLanguages,
        state.drafts,
    );
    if (lengthIssues.length) {
        throw new Error(
            formatLanguageValidationMessage(lengthIssues, languageDisplayLabel),
        );
    }

    const coverUrl = requireRemoteMediaUrl(state.cover, "封面");
    const images = state.displayImages.slice(0, 4).map((image, index) =>
        requireRemoteMediaUrl(image, `展示图片 ${index + 1}`),
    );
    const multiLangInfo: Record<string, LevelLanguageContent> = {};
    for (const lang of state.selectedLanguages) {
        const draft = state.drafts[lang];
        if (!draft) throw new Error(`语言 ${lang} 的草稿缺失。`);
        multiLangInfo[lang] = {
            lang,
            level_name: String(draft.level_name ?? ""),
            level_intro: String(draft.level_intro ?? ""),
            desc: String(draft.desc ?? ""),
            changelog: resolveChangelog(
                draft.changelog,
                source.multi_lang_info?.[lang]?.changelog,
                lang === defaultLang ? source.changelog : undefined,
            ),
            early_access_desc:
                draft.early_access_desc ??
                source.multi_lang_info?.[lang]?.early_access_desc ??
                (lang === defaultLang ? source.early_access_desc : "") ??
                "",
        };
    }

    const defaultContent = multiLangInfo[defaultLang];
    const videoUrl = state.video
        ? requireRemoteMediaUrl(state.video, "展示视频")
        : "";
    const videoId = state.video ? resolveVideoId(state.video) : "";
    if (videoUrl && !videoId) {
        throw new Error("展示视频缺少可用的 video_id，请重新上传视频。");
    }

    return {
        level_id: levelId,
        early_access_status:
            source.early_access_status || "EARLY_ACCESS_STATUS_NORMAL",
        early_access_desc:
            defaultContent.early_access_desc || source.early_access_desc || "",
        level_name: defaultContent.level_name,
        level_intro: defaultContent.level_intro,
        desc: defaultContent.desc,
        devices_control: state.tags.devices_control.map((item) => item.tag_id),
        tags: state.tags.tags.map((item) => item.tag_id),
        play_type: state.tags.play_type.tag_id,
        play_cate: state.tags.play_cate,
        cover_img: coverUrl,
        images,
        video_info: videoUrl ? { video_url: videoUrl, video_id: videoId } : {},
        changelog: defaultContent.changelog,
        default_lang: defaultLang,
        multi_lang_info: multiLangInfo,
    };
}

function requireRemoteMediaUrl(
    media: EditorMediaSource | null,
    label: string,
) {
    const raw = media?.remoteUrl?.trim() || "";
    if (!raw) {
        throw new Error(`${label}缺少 OSS 上传回调地址，请等待上传完成或重新上传。`);
    }
    if (isObjectUrl(raw)) throw new Error(`${label}仍是本地 blob 地址，禁止提交。`);

    const server = loggedInServer.value;
    const url = server
        ? resolveHoyoverseMediaUrl(raw, server, media?.objectKey)
        : raw;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") throw new Error();
    } catch {
        throw new Error(
            `${label}的远端地址无效：${raw}${url !== raw ? `（规范化后：${url}）` : ""}`,
        );
    }
    return url;
}

/** OSS 回调常返回相对路径 `/ugcprod…`，提交时需补全为 ugc-upload CDN。 */
function resolveHoyoverseMediaUrl(
    raw: string,
    server: ServerValue,
    objectKey?: string,
) {
    const candidate = raw.trim();
    if (!candidate) {
        return objectKey
            ? resolveHoyoverseMediaUrl(objectKey, server)
            : "";
    }
    if (isObjectUrl(candidate)) return candidate;

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol === "http:") {
            parsed.protocol = "https:";
            return parsed.toString();
        }
        if (parsed.protocol === "https:") return parsed.toString();
    } catch {
        // Relative path — resolve against the regional upload CDN.
    }

    const path = candidate.replace(/^\/+/, "");
    if (!path) return "";
    return `https://${server}-ugc-upload.hoyoverse.com/${path}`;
}

function resolveVideoId(media: EditorMediaSource) {
    const explicitId = media.sourceId?.trim() || "";
    if (explicitId && !explicitId.includes("/") && !explicitId.includes("\\")) {
        return explicitId.replace(/\.mp4$/i, "");
    }
    const object = explicitId || media.objectKey?.trim() || "";
    if (!object) return "";
    const fileName = object.split(/[\\/]/).pop() || "";
    return fileName.replace(/\.[^.]+$/, "");
}

function resolveChangelog(
    ...sources: Array<LevelChangelogItem[] | undefined>
): LevelChangelogItem[] {
    const existing = sources.find((items) => items?.length);
    if (existing) {
        return existing.map((item) => ({
            version_id: String(item.version_id ?? ""),
            edition: String(item.edition ?? ""),
            content: String(item.content ?? ""),
        }));
    }
    return [{ version_id: "", edition: "0.01", content: "" }];
}

function startUploadCooldown(seconds: number) {
    if (uploadCooldownTimer) clearInterval(uploadCooldownTimer);
    uploadCooldown.value = seconds;
    uploadCooldownTimer = setInterval(() => {
        uploadCooldown.value = Math.max(0, uploadCooldown.value - 1);
        if (uploadCooldown.value === 0 && uploadCooldownTimer) {
            clearInterval(uploadCooldownTimer);
            uploadCooldownTimer = null;
        }
    }, 1000);
}

function resetUploadResult() {
    uploadMessage.value = "";
    uploadResponse.value = null;
    uploadCooldown.value = 0;
    if (uploadCooldownTimer) {
        clearInterval(uploadCooldownTimer);
        uploadCooldownTimer = null;
    }
}

async function uploadCover(file: File, rethrow = false) {
    coverUploading.value = true;
    coverUploadError.value = "";
    clearCoverUpload();
    currentCoverFile.value = file;
    uploadedCoverUrl.value = URL.createObjectURL(file);
    uploadedCoverResult.value = null;

    try {
        const uploaded = await uploadResourceToOss(file, getImageUploadOptions(file));
        uploadedCoverRemoteUrl.value = uploaded.url;
        uploadedCoverResult.value = uploaded.result;
    } catch (error) {
        coverUploadError.value = formatUploadError(error, "封面");
        if (rethrow) throw new Error(coverUploadError.value);
    } finally {
        coverUploading.value = false;
    }
}

async function uploadDisplayImages(files: File[]) {
    const slots = 4 - uploadedDisplayImages.value.length;
    const acceptedFiles = files.slice(0, slots);
    displayUploadError.value =
        files.length > slots ? "展示图片总数最多为 4 张。" : "";

    const items = acceptedFiles.map<DisplayUploadItem>((file, index) => ({
        img_id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
        previewUrl: URL.createObjectURL(file),
        uploadedUrl: "",
        status: "uploading",
        error: "",
        result: null,
        file,
    }));
    uploadedDisplayImages.value.push(...items);

    await Promise.all(
        items.map((item) => finishDisplayUpload(item)),
    );
}

async function uploadImportedDisplayImage(file: File) {
    const item: DisplayUploadItem = {
        img_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        previewUrl: URL.createObjectURL(file),
        uploadedUrl: "",
        status: "uploading",
        error: "",
        result: null,
        file,
    };
    uploadedDisplayImages.value.push(item);
    await finishDisplayUpload(item, true);
}

async function finishDisplayUpload(item: DisplayUploadItem, rethrow = false) {
    try {
        if (!item.file) throw new Error("展示图片缺少本地文件。");
        const uploaded = await uploadResourceToOss(
            item.file,
            getImageUploadOptions(item.file),
        );
        const current = uploadedDisplayImages.value.find(
            (image) => image.img_id === item.img_id,
        );
        if (!current) return;
        current.uploadedUrl = uploaded.url;
        current.result = uploaded.result;
        current.sourceId = uploaded.object || undefined;
        current.objectKey =
            stableObjectKey(uploaded.url) || uploaded.object || undefined;
        current.md5 = uploaded.result.md5;
        current.status = "success";
    } catch (error) {
        const message = formatUploadError(error, "展示图片");
        const current = uploadedDisplayImages.value.find(
            (image) => image.img_id === item.img_id,
        );
        if (current) {
            current.status = "error";
            current.error = message;
        }
        displayUploadError.value = message;
        if (rethrow) throw new Error(message);
    }
}

function removeDisplayImage(id: string) {
    const index = uploadedDisplayImages.value.findIndex(
        (image) => image.img_id === id,
    );
    if (index < 0) return;

    URL.revokeObjectURL(uploadedDisplayImages.value[index].previewUrl);
    uploadedDisplayImages.value.splice(index, 1);
    displayUploadError.value = "";
}

function clearDisplayUploads() {
    for (const image of uploadedDisplayImages.value) {
        URL.revokeObjectURL(image.previewUrl);
    }
    uploadedDisplayImages.value = [];
    displayUploadError.value = "";
}

async function uploadVideo(file: File, rethrow = false) {
    videoUploadError.value = "";
    if (file.type !== "video/mp4") {
        videoUploadError.value = "仅支持 MP4 视频。";
        return;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    uploadedVideo.value = {
        id,
        fileName: file.name,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        error: "",
        url: "",
        secretUrl: "",
        object: "",
        result: null,
        file,
    };

    try {
        const uploaded = await uploadResourceToOss(file, {
            ext: "mp4",
            allowedTypes: new Set(["video/mp4"]),
        });
        if (uploadedVideo.value?.id !== id) return;

        uploadedVideo.value.status = "success";
        uploadedVideo.value.url = uploaded.url;
        uploadedVideo.value.secretUrl = uploaded.secretUrl;
        uploadedVideo.value.object = uploaded.object;
        uploadedVideo.value.result = uploaded.result;
        uploadedVideo.value.sourceId = uploaded.object || undefined;
        uploadedVideo.value.objectKey =
            stableObjectKey(uploaded.url) || uploaded.object || undefined;
        uploadedVideo.value.md5 = uploaded.result.md5;
    } catch (error) {
        if (uploadedVideo.value?.id !== id) return;

        const message = formatUploadError(error, "视频");
        uploadedVideo.value.status = "error";
        uploadedVideo.value.error = message;
        videoUploadError.value = message;
        if (rethrow) throw new Error(message);
    }
}

function removeVideo() {
    if (uploadedVideo.value?.previewUrl) {
        URL.revokeObjectURL(uploadedVideo.value.previewUrl);
    }
    uploadedVideo.value = null;
    videoUploadError.value = "";
}

function updateTagDraft(draft: TagDraft) {
    levelTagDraft.value = draft;
}

function clearCoverUpload() {
    if (uploadedCoverUrl.value.startsWith("blob:")) {
        URL.revokeObjectURL(uploadedCoverUrl.value);
    }
    uploadedCoverUrl.value = "";
    uploadedCoverRemoteUrl.value = "";
    uploadedCoverResult.value = null;
    currentCoverFile.value = null;
    coverUploadError.value = "";
}

async function savePageAsZip() {
    const editor = levelEditorRef.value;
    if (!editor) {
        zipError.value = "关卡编辑器尚未就绪。";
        return;
    }
    if (!tokenResponse.value?.data || !sessionToken.value) {
        zipError.value = "请先登录后再保存 ZIP。";
        return;
    }
    if (!workerSecret.value.trim()) {
        zipError.value = "请先填写 Worker Secret。";
        return;
    }

    zipBusy.value = true;
    zipPercent.value = 0;
    zipError.value = "";
    zipSuccess.value = "";
    try {
        const state = editor.getExportState();
        zipProgress.value = "正在收集封面…";
        const cover = state.cover
            ? await resolveExportMedia(state.cover, "image")
            : null;
        const displayImages = [];
        for (const [index, media] of state.displayImages.entries()) {
            zipProgress.value = `正在收集展示图片 ${index + 1}/${state.displayImages.length}…`;
            displayImages.push(await resolveExportMedia(media, "image"));
        }
        zipProgress.value = "正在收集展示视频…";
        const video = state.video
            ? await resolveExportMedia(state.video, "video")
            : null;
        zipProgress.value = "正在生成 ZIP…";
        const archive = await createExportZip(
            {
                levelId: storedLevelId.value || levelIdInput.value.trim(),
                editor: {
                    tags: state.tags,
                    selectedLanguages: state.selectedLanguages,
                    defaultLang: state.defaultLang,
                    drafts: state.drafts,
                },
                cover,
                displayImages,
                video,
            },
            (percent) => {
                zipPercent.value = percent;
                zipProgress.value = `正在生成 ZIP… ${percent}%`;
            },
        );
        downloadBlob(archive, buildZipFileName());
        zipPercent.value = 100;
        zipProgress.value = "ZIP 已生成。";
        zipSuccess.value = "页面内容已完整保存为 ZIP。";
    } catch (error) {
        zipProgress.value = "";
        zipError.value = error instanceof Error ? error.message : "生成 ZIP 失败。";
    } finally {
        zipBusy.value = false;
    }
}

async function handleZipImport(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    zipBusy.value = true;
    zipPercent.value = 0;
    zipError.value = "";
    zipSuccess.value = "";
    let imported: ImportedZip;
    try {
        zipProgress.value = "正在校验 ZIP 与 manifest…";
        imported = await readImportZip(file);
        const editor = levelEditorRef.value;
        if (!editor) throw new Error("关卡编辑器尚未就绪。");
        zipProgress.value = "正在比较页面与 ZIP 媒体…";
        const plan = await buildImportPlan(imported, editor.getExportState());
        if (plan.uploadCount > 0) {
            if (
                !tokenResponse.value?.data ||
                !loggedInServer.value ||
                !sessionToken.value
            ) {
                throw new Error("导入的新媒体需要上传，请先完成登录。");
            }
            if (!workerSecret.value.trim()) {
                throw new Error("导入的新媒体需要上传，请填写 Worker Secret。");
            }
        }
        const mediaSummary = [
            imported.cover ? "1 个封面" : "无封面",
            `${imported.displayImages.length} 张展示图`,
            imported.video ? "1 个视频" : "无视频",
        ].join("、");
        if (
            !window.confirm(
                `ZIP 校验通过（${mediaSummary}，需重新上传 ${plan.uploadCount} 个媒体）。继续后将应用标签与十五语草稿，并从 ZIP 内文件重新上传到 OSS（不使用任何链接）。是否继续？`,
            )
        ) {
            zipProgress.value = "已取消导入，未修改页面。";
            return;
        }
        const skipped = await applyImportedZip(imported, plan);
        zipPercent.value = 100;
        zipProgress.value = "导入完成。";
        zipSuccess.value = [
            "标签和十五语草稿已应用。",
            ...skipped,
            plan.uploadCount
                ? `已重新上传 ${plan.uploadCount} 个媒体到 OSS。`
                : "没有需要上传的媒体。",
        ].join(" ");
    } catch (error) {
        zipProgress.value = "";
        zipError.value = error instanceof Error ? error.message : "导入 ZIP 失败。";
    } finally {
        zipBusy.value = false;
    }
}

interface ImportMedia {
    entry: ZipMediaEntry;
    file: File;
}

interface ImportPlan {
    coverUnchanged: boolean;
    displayUnchanged: boolean;
    videoUnchanged: boolean;
    displaySources: Array<EditorMediaSource | ImportMedia>;
    coverSource: EditorMediaSource | ImportMedia | null;
    videoSource: EditorMediaSource | ImportMedia | null;
    displayReusedCount: number;
    uploadCount: number;
}

async function applyImportedZip(imported: ImportedZip, plan: ImportPlan) {
    const editor = levelEditorRef.value;
    if (!editor) throw new Error("应用草稿阶段：关卡编辑器尚未就绪。");
    const skipped: string[] = [];
    zipProgress.value = "正在应用标签与十五语草稿…";
    editor.applyImportedDrafts(imported.manifest.editor);
    if (plan.coverUnchanged) {
        skipped.push("已跳过未改动的封面。");
    } else {
        editor.clearOriginalCoverForImport();
        clearCoverUpload();
        if (plan.coverSource) {
            if (isImportMedia(plan.coverSource)) {
                zipProgress.value = `正在上传封面：${plan.coverSource.file.name}`;
                try {
                    await uploadCover(plan.coverSource.file, true);
                } catch (error) {
                    throw importUploadError("封面上传阶段", plan.coverSource.file.name, error);
                }
            } else {
                applyReusedCover(plan.coverSource);
            }
        }
    }

    if (plan.displayUnchanged) {
        skipped.push("已跳过未改动的图片。");
    } else {
        editor.clearOriginalDisplayForImport();
        clearDisplayUploads();
        for (const [index, source] of plan.displaySources.entries()) {
            if (isImportMedia(source)) {
                zipProgress.value =
                    `正在上传展示图片 ${index + 1}/${plan.displaySources.length}：${source.file.name}`;
                try {
                    await uploadImportedDisplayImage(source.file);
                } catch (error) {
                    throw importUploadError("展示图片上传阶段", source.file.name, error);
                }
            } else {
                appendReusedDisplay(source);
            }
        }
        if (plan.displayReusedCount > 0) {
            skipped.push(
                `已跳过未改动的图片（${plan.displayReusedCount} 张）。`,
            );
        }
    }

    if (plan.videoUnchanged) {
        skipped.push("已跳过未改动的视频。");
    } else {
        editor.clearOriginalVideoForImport();
        removeVideo();
        if (plan.videoSource) {
            if (isImportMedia(plan.videoSource)) {
                zipProgress.value = `正在上传视频：${plan.videoSource.file.name}`;
                try {
                    await uploadVideo(plan.videoSource.file, true);
                } catch (error) {
                    throw importUploadError("视频上传阶段", plan.videoSource.file.name, error);
                }
            } else {
                applyReusedVideo(plan.videoSource);
            }
        }
    }
    return skipped;
}

async function buildImportPlan(
    imported: ImportedZip,
    current: EditorExportState,
): Promise<ImportPlan> {
    const cover = imported.manifest.media.cover && imported.cover
        ? { entry: imported.manifest.media.cover, file: imported.cover }
        : null;
    const video = imported.manifest.media.video && imported.video
        ? { entry: imported.manifest.media.video, file: imported.video }
        : null;
    const display = imported.manifest.media.displayImages.map((entry, index) => ({
        entry,
        file: imported.displayImages[index],
    }));

    const coverUnchanged = await optionalMediaMatches(cover, current.cover);
    const videoUnchanged = await optionalMediaMatches(video, current.video);
    const displayUnchanged =
        display.length === current.displayImages.length &&
        (await Promise.all(
            display.map((media, index) =>
                mediaMatches(media, current.displayImages[index]),
            ),
        )).every(Boolean);

    const usedCurrent = new Set<number>();
    const displaySources: Array<EditorMediaSource | ImportMedia> = [];
    let displayReusedCount = 0;
    for (const media of display) {
        let matchedIndex = -1;
        for (let index = 0; index < current.displayImages.length; index += 1) {
            if (
                !usedCurrent.has(index) &&
                (await mediaMatches(media, current.displayImages[index]))
            ) {
                matchedIndex = index;
                break;
            }
        }
        if (matchedIndex >= 0) {
            usedCurrent.add(matchedIndex);
            displayReusedCount += 1;
            displaySources.push(current.displayImages[matchedIndex]);
        } else {
            displaySources.push(media);
        }
    }

    const coverSource = coverUnchanged
        ? current.cover
        : cover;
    const videoSource = videoUnchanged
        ? current.video
        : video;
    const uploadCount = [
        ...(!coverUnchanged && coverSource && isImportMedia(coverSource)
            ? [coverSource]
            : []),
        ...(!displayUnchanged
            ? displaySources.filter(isImportMedia)
            : []),
        ...(!videoUnchanged && videoSource && isImportMedia(videoSource)
            ? [videoSource]
            : []),
    ].length;
    return {
        coverUnchanged,
        displayUnchanged,
        videoUnchanged,
        displaySources,
        coverSource,
        videoSource,
        displayReusedCount,
        uploadCount,
    };
}

async function optionalMediaMatches(
    imported: ImportMedia | null,
    current: EditorMediaSource | null,
) {
    if (!imported || !current) return imported === null && current === null;
    return mediaMatches(imported, current);
}

async function mediaMatches(imported: ImportMedia, current?: EditorMediaSource) {
    if (!current) return false;
    // 只按文件内容 MD5 判断是否与当前页一致；ZIP 不再保存 URL，禁止用链接匹配。
    const importedMd5 =
        imported.entry.md5?.toLowerCase() || (await md5Blob(imported.file));
    const currentMd5 =
        current.md5?.toLowerCase() ||
        (current.file ? await md5Blob(current.file) : "");
    return Boolean(importedMd5 && currentMd5 && importedMd5 === currentMd5);
}

function isImportMedia(
    source: EditorMediaSource | ImportMedia,
): source is ImportMedia {
    return "entry" in source && "file" in source;
}

const md5Cache = new WeakMap<Blob, Promise<string>>();
function md5Blob(blob: Blob) {
    let digest = md5Cache.get(blob);
    if (!digest) {
        digest = blob.arrayBuffer().then((buffer) =>
            SparkMD5.ArrayBuffer.hash(buffer).toLowerCase(),
        );
        md5Cache.set(blob, digest);
    }
    return digest;
}

function stableObjectKey(url?: string) {
    if (!url || isObjectUrl(url)) return "";
    try {
        return decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
    } catch {
        return "";
    }
}

function applyReusedCover(source: EditorMediaSource) {
    coverUploadError.value = "";
    const file = source.file ? asFile(source.file, source.fileName, source.mimeType) : null;
    const remoteUrl = normalizeImportedRemoteUrl(source.remoteUrl, source.objectKey);
    currentCoverFile.value = file;
    uploadedCoverRemoteUrl.value = remoteUrl;
    uploadedCoverUrl.value = file
        ? URL.createObjectURL(file)
        : remoteUrl;
    uploadedCoverResult.value = source.md5 ? { md5: source.md5 } : null;
}

function appendReusedDisplay(source: EditorMediaSource) {
    const file = source.file ? asFile(source.file, source.fileName, source.mimeType) : undefined;
    const remoteUrl = normalizeImportedRemoteUrl(source.remoteUrl, source.objectKey);
    uploadedDisplayImages.value.push({
        img_id: source.sourceId || `reused-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        previewUrl: file ? URL.createObjectURL(file) : remoteUrl,
        uploadedUrl: remoteUrl,
        status: "success",
        error: "",
        result: null,
        file,
        sourceId: source.sourceId,
        objectKey: source.objectKey || stableObjectKey(remoteUrl),
        md5: source.md5,
    });
}

function applyReusedVideo(source: EditorMediaSource) {
    const file = source.file ? asFile(source.file, source.fileName, source.mimeType) : undefined;
    const remoteUrl = normalizeImportedRemoteUrl(source.remoteUrl, source.objectKey);
    uploadedVideo.value = {
        id: source.sourceId || `reused-${Date.now()}`,
        fileName: source.fileName || "video.mp4",
        previewUrl: file ? URL.createObjectURL(file) : remoteUrl,
        status: "success",
        error: "",
        url: remoteUrl,
        secretUrl: "",
        object: source.objectKey || stableObjectKey(remoteUrl),
        result: null,
        file,
        sourceId: source.sourceId,
        objectKey: source.objectKey || stableObjectKey(remoteUrl),
        md5: source.md5,
    };
}

function normalizeImportedRemoteUrl(url?: string, objectKey?: string) {
    const raw = url?.trim() || "";
    if (!raw || isObjectUrl(raw)) return "";
    const server = loggedInServer.value;
    if (!server) return raw;
    try {
        const resolved = resolveHoyoverseMediaUrl(raw, server, objectKey);
        return new URL(resolved).protocol === "https:" ? resolved : "";
    } catch {
        return "";
    }
}

function asFile(blob: Blob, name?: string, type?: string) {
    return blob instanceof File
        ? blob
        : new File([blob], name || "media", { type: type || blob.type });
}

async function resolveExportMedia(
    source: EditorMediaSource,
    expectedKind: "image" | "video",
): Promise<ResolvedMedia> {
    let blob: Blob;
    if (source.file) {
        blob = source.file;
    } else if (source.remoteUrl) {
        try {
            blob = await downloadBinaryViaWorker(source.remoteUrl);
        } catch (error) {
            const reason = error instanceof Error ? error.message : "下载失败";
            throw new Error(`${source.label}下载失败：${reason}。远端签名可能已过期，ZIP 未生成。`);
        }
    } else {
        throw new Error(`${source.label}缺少可导出的二进制来源。`);
    }
    const mimeType = await detectMediaType(blob);
    if (!mimeType) {
        throw new Error(
            source.file
                ? `${source.label}媒体类型无效。`
                : `${source.label}下载内容不是受支持的媒体，远端签名可能已过期。`,
        );
    }
    if (
        (expectedKind === "image" &&
            mimeType !== "image/png" &&
            mimeType !== "image/jpeg") ||
        (expectedKind === "video" && mimeType !== "video/mp4")
    ) {
        throw new Error(`${source.label}媒体类型无效：${mimeType}。`);
    }
    if (expectedKind === "image" && blob.size > MAX_IMAGE_SIZE) {
        throw new Error(`${source.label}超过 5 MiB，无法导出。`);
    }
    return {
        blob: blob.type === mimeType ? blob : blob.slice(0, blob.size, mimeType),
        fileName: source.fileName || fallbackMediaName(source.label, mimeType),
        mimeType,
        source: { kind: "local" },
    };
}

async function downloadBinaryViaWorker(url: string): Promise<Blob> {
    return proxyRequest<Blob>(url, buildCookie(sessionToken.value), {
        method: "GET",
        responseType: "blob",
    });
}

async function detectMediaType(blob: Blob) {
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (
        bytes.length >= 8 &&
        [137, 80, 78, 71, 13, 10, 26, 10].every(
            (byte, index) => bytes[index] === byte,
        )
    ) {
        return "image/png" as const;
    }
    if (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
    ) {
        return "image/jpeg" as const;
    }
    if (
        bytes.length >= 12 &&
        String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
    ) {
        return "video/mp4" as const;
    }
    return "";
}

function fallbackMediaName(label: string, mime: string) {
    const ext = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "mp4";
    return `${label.replace(/\s+/g, "-")}.${ext}`;
}

function importUploadError(stage: string, fileName: string, error: unknown) {
    const reason = error instanceof Error ? error.message : "上传失败";
    return new Error(`${stage}（${fileName}）：${reason}`);
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildZipFileName() {
    const levelId = (storedLevelId.value || levelIdInput.value.trim() || "level")
        .replace(/[^a-zA-Z0-9_-]/g, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `oversea-upload-${levelId}-${timestamp}.zip`;
}

interface ResourceUploadOptions {
    ext: "png" | "jpg" | "mp4";
    allowedTypes: Set<string>;
    maxSize?: number;
}

function getImageUploadOptions(file: File): ResourceUploadOptions {
    return {
        ext: file.type === "image/png" ? "png" : "jpg",
        allowedTypes: new Set(["image/png", "image/jpeg"]),
        maxSize: 5 * 1024 * 1024,
    };
}

async function uploadResourceToOss(
    file: File,
    options: ResourceUploadOptions,
): Promise<ResourceUploadResult> {
    if (!options.allowedTypes.has(file.type)) {
        throw new Error(
            options.ext === "mp4"
                ? "仅支持 MP4 视频。"
                : "仅支持 PNG、JPG 或 JPEG 图片。",
        );
    }
    if (options.maxSize !== undefined && file.size > options.maxSize) {
        throw new Error("图片不能超过 5 MiB。");
    }

    const loginData = tokenResponse.value?.data;
    const server = loggedInServer.value;
    if (
        !loginData ||
        !server ||
        !sessionToken.value ||
        !loginData.uid ||
        !loginData.region
    ) {
        throw new Error("登录信息不完整，请重新登录后再上传。");
    }

    const md5 = SparkMD5.ArrayBuffer.hash(await file.arrayBuffer());
    const biz = `ugcprod${server}`;
    const query = new URLSearchParams({
        ugc_login_uid: loginData.uid,
        ugc_login_region: loginData.region,
    });
    const paramsUrl =
        `https://${server}-ugc-api.hoyoverse.com` +
        `/ugc_gateway/v1/levels/resource/upload/params?${query.toString()}`;
    const uploadParams = await proxyRequest<UploadParamsResponse>(
        paramsUrl,
        buildCookie(sessionToken.value),
        {
            method: "POST",
            data: {
                md5,
                ext: options.ext,
                biz,
                support_content_type: true,
                support_extra_form_data: true,
            },
        },
    );

    if (uploadParams.retcode !== 0 || !uploadParams.data?.oss) {
        throw new Error(
            `获取上传参数失败（${uploadParams.retcode}）：${uploadParams.message}`,
        );
    }

    const uploadData = uploadParams.data;
    const oss = uploadData.oss;
    const ossUrl = new URL(oss.host);
    if (
        ossUrl.protocol !== "https:" ||
        !ossUrl.hostname.endsWith(".aliyuncs.com")
    ) {
        throw new Error("上传服务返回了不受信任的 OSS 地址。");
    }

    const formData = new FormData();
    formData.append("name", oss.name);
    formData.append("key", oss.key || uploadData.file_name);
    formData.append("callback", oss.callback);
    for (const [name, value] of Object.entries(oss.callback_var || {})) {
        formData.append(name, value);
    }
    formData.append("x-oss-content-type", oss.x_oss_content_type);
    formData.append("OSSAccessKeyId", oss.accessid);
    formData.append("policy", oss.policy);
    formData.append("signature", oss.signature);
    formData.append("x-oss-object-acl", oss.object_acl);
    if (oss.content_disposition) {
        formData.append("Content-Disposition", oss.content_disposition);
    }
    appendExtraFormData(formData, oss.extra_form_data);
    formData.append("file", file, file.name);

    const ossResponse = await axios.post<unknown>(ossUrl.toString(), formData);
    const callbackData = extractOssCallbackData(ossResponse.data);
    const rawUrl =
        callbackData.url ||
        callbackData.secret_url ||
        callbackData.object ||
        uploadData.file_name ||
        "";
    const absoluteUrl = resolveHoyoverseMediaUrl(
        rawUrl,
        server,
        callbackData.object || uploadData.file_name,
    );
    if (!absoluteUrl || isObjectUrl(absoluteUrl)) {
        throw new Error("OSS 上传完成，但回调未返回可提交的远端 URL。");
    }
    try {
        if (new URL(absoluteUrl).protocol !== "https:") {
            throw new Error();
        }
    } catch {
        throw new Error(
            `OSS 回调地址无法规范化为 HTTPS URL：${rawUrl || "（空）"}`,
        );
    }

    return {
        url: absoluteUrl,
        secretUrl: callbackData.secret_url
            ? resolveHoyoverseMediaUrl(callbackData.secret_url, server)
            : "",
        object: callbackData.object || uploadData.file_name,
        result: {
            md5,
            ext: options.ext,
            biz,
            fileName: uploadData.file_name,
            params: uploadData,
            callback: ossResponse.data,
            callbackData: {
                ...callbackData,
                url: absoluteUrl,
            },
        },
    };
}

function formatUploadError(error: unknown, label: string) {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data as
            | { error?: string; message?: string }
            | undefined;
        return (
            responseData?.error ||
            responseData?.message ||
            (error.response
                ? `${label}上传失败，HTTP 状态码：${error.response.status}`
                : "无法连接上传服务，请检查 OSS 跨域设置。")
        );
    }
    return error instanceof Error ? error.message : `${label}上传失败。`;
}

async function proxyRequest<T>(
    url: string,
    cookie: string,
    options: ProxyOptions = {},
): Promise<T> {
    try {
        const response = await axios.post<T>(
            WORKER_URL,
            {
                url,
                cookie,
                secret: workerSecret.value,
                ua: GAME_USER_AGENT,
                method: options.method || "GET",
                data: options.data,
            },
            { responseType: options.responseType || "json" },
        );
        persistWorkerSecret();
        return response.data;
    } catch (error) {
        if (isInvalidWorkerSecret(error)) clearWorkerSecretCache();
        throw error;
    }
}

function loadWorkerSecret() {
    try {
        const saved = localStorage.getItem(WORKER_SECRET_STORAGE_KEY);
        if (saved) workerSecret.value = saved;
    } catch {
        // localStorage may be unavailable in some environments.
    }
}

function persistWorkerSecret() {
    const value = workerSecret.value.trim();
    if (!value) return;
    try {
        localStorage.setItem(WORKER_SECRET_STORAGE_KEY, value);
    } catch {
        // Ignore quota or privacy mode errors.
    }
}

function clearWorkerSecretCache() {
    try {
        localStorage.removeItem(WORKER_SECRET_STORAGE_KEY);
    } catch {
        // Ignore storage errors.
    }
}

function isInvalidWorkerSecret(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    if (error.response?.status === 401) return true;

    const data = error.response?.data;
    if (typeof data === "string") {
        return data.includes("Invalid secret");
    }
    if (data && typeof data === "object" && "error" in data) {
        return (data as { error?: string }).error === "Invalid secret";
    }
    return false;
}

function appendExtraFormData(formData: FormData, extra: unknown) {
    if (!extra) return;

    if (typeof extra === "string") {
        try {
            appendExtraFormData(formData, JSON.parse(extra));
        } catch {
            // A scalar value has no field name and cannot be appended safely.
        }
        return;
    }

    if (Array.isArray(extra)) {
        for (const item of extra) {
            if (!item || typeof item !== "object") continue;

            const record = item as Record<string, unknown>;
            const name = record.name ?? record.key;
            const value = record.value;
            if (
                typeof name === "string" &&
                (typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean")
            ) {
                formData.append(name, String(value));
            }
        }
        return;
    }

    if (typeof extra === "object") {
        for (const [name, value] of Object.entries(
            extra as Record<string, unknown>,
        )) {
            if (
                typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean"
            ) {
                formData.append(name, String(value));
            }
        }
    }
}

function extractOssCallbackData(value: unknown): OssCallbackData {
    const empty = { url: "", secret_url: "", object: "" };
    if (!value || typeof value !== "object") return empty;

    const record = value as Record<string, unknown>;
    const nested =
        record.data && typeof record.data === "object"
            ? (record.data as Record<string, unknown>)
            : record;
    const firstString = (...keys: string[]) => {
        const key = keys.find((name) => typeof nested[name] === "string");
        return key ? (nested[key] as string) : "";
    };

    return {
        url: firstString("url", "img_url", "file_url"),
        secret_url: firstString("secret_url"),
        object: firstString("object"),
    };
}

function buildCookie(ugcToken: string) {
    return [
        "mi18nLang=zh-cn",
        "ma_passport_region_enable=true",
        "ma_passport_region=SG",
        "lrsag=0",
        "age_gate_country=HK",
        `ugc_hk4e_token=${ugcToken}`,
    ].join("; ");
}
</script>

<style scoped>
.upload-page {
    min-height: 100%;
    box-sizing: border-box;
    padding: clamp(12px, 2.5vw, 28px);
    text-align: left;
}

.view-switch-enter-active,
.view-switch-leave-active {
    transition:
        opacity 0.38s cubic-bezier(0.2, 0.8, 0.2, 1),
        transform 0.38s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.view-switch-enter-from {
    opacity: 0;
    transform: translateY(18px);
}

.view-switch-leave-to {
    opacity: 0;
    transform: translateY(-14px);
}

.topbar-expand-enter-active,
.topbar-expand-leave-active {
    overflow: hidden;
    transition:
        opacity 0.32s ease,
        max-height 0.38s cubic-bezier(0.2, 0.8, 0.2, 1),
        transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.topbar-expand-enter-from,
.topbar-expand-leave-to {
    opacity: 0;
    max-height: 0;
    transform: translateY(-8px);
}

.topbar-expand-enter-to,
.topbar-expand-leave-from {
    opacity: 1;
    max-height: 420px;
    transform: translateY(0);
}

.actions-slide-enter-active {
    transition:
        opacity 0.34s ease,
        transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.actions-slide-leave-active {
    transition:
        opacity 0.24s ease,
        transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}

.actions-slide-enter-from,
.actions-slide-leave-to {
    opacity: 0;
    transform: translateX(28px);
}

.workspace-shell {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 1680px;
    margin: 0 auto;
}

.account-topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    padding: 14px 18px;
    border: 1px solid rgba(106, 90, 205, 0.18);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 10px 32px rgba(66, 55, 130, 0.1);
    backdrop-filter: blur(10px);
}

.account-topbar-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
}

.account-topbar-title {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
}

.account-stats {
    display: flex;
    flex: 1 1 320px;
    flex-wrap: wrap;
    gap: 8px;
    min-width: 0;
}

.account-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    background: #f3f1fa;
    color: #3f395c;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
}

.account-chip-primary {
    background: linear-gradient(90deg, rgba(106, 90, 205, 0.14), rgba(76, 155, 232, 0.14));
    color: #4a3f8f;
}

.account-chip-label {
    color: #8a8498;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.04em;
}

.account-topbar-actions {
    display: flex;
    flex: none;
    gap: 8px;
    margin-left: auto;
}

.topbar-button {
    padding: 8px 14px;
    border: 1px solid #d8d5e8;
    border-radius: 10px;
    background: #fff;
    color: #5a4fb1;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s, transform 0.2s;
}

.topbar-button:hover {
    background: #f8f7fc;
    border-color: #c8c2de;
    transform: translateY(-1px);
}

.topbar-button-muted {
    color: #6e6a80;
}

.account-topbar-detail {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid #e8e5f2;
}

.account-token-row {
    display: grid;
    gap: 8px;
}

.account-token-value {
    display: block;
    padding: 12px 14px;
    border-radius: 10px;
    background: #f6f5fb;
    color: #2c2940;
    font-family: Consolas, monospace;
    font-size: 0.78rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
    word-break: break-all;
}

.account-json-details {
    margin-top: 12px;
    border-top: none;
    padding-top: 0;
}

.account-json-details pre {
    max-height: 240px;
}

.login-card,
.result-card {
    width: min(720px, 100%);
    margin: 0 auto;
    padding: clamp(24px, 5vw, 44px);
    box-sizing: border-box;
    border: 1px solid rgba(106, 90, 205, 0.16);
    border-radius: 24px;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 18px 50px rgba(66, 55, 130, 0.12);
}

.workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    align-items: start;
    transition: grid-template-columns 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.workspace--with-actions {
    grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
}

.panel-actions {
    position: sticky;
    top: 88px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.panel-main {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-width: 0;
}

.panel-main .result-card,
.workspace .result-card {
    width: 100%;
    margin: 0;
}

.action-card {
    padding: clamp(16px, 2.5vw, 22px);
}

.action-card .card-heading h2 {
    margin: 4px 0 6px;
    font-size: 1.05rem;
}

.action-card .card-heading p {
    margin: 0 0 14px;
    font-size: 0.8rem;
    line-height: 1.5;
}

.action-card .eyebrow {
    font-size: 0.68rem;
}

.action-card .message {
    margin-top: 12px;
    font-size: 0.82rem;
}

.action-card pre {
    max-height: 200px;
    font-size: 0.75rem;
}

.level-query-form {
    max-width: 420px;
}

.result-card {
    margin-top: 24px;
}

.card-heading h1,
.result-heading h2 {
    margin: 5px 0 8px;
    color: #292348;
}

.card-heading p {
    margin: 0 0 28px;
    color: #6e6a80;
    line-height: 1.6;
}

.eyebrow {
    color: #6a5acd;
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.16em;
}

.token-form {
    display: grid;
    gap: 10px;
}

.token-form label {
    margin-top: 8px;
    color: #3f395c;
    font-size: 0.9rem;
    font-weight: 700;
}

.token-form input,
.token-form select {
    width: 100%;
    height: 48px;
    box-sizing: border-box;
    padding: 0 14px;
    border: 1px solid #d8d5e8;
    border-radius: 10px;
    outline: none;
    background: #fff;
    color: #2c2940;
    font: inherit;
    transition: border-color 0.2s, box-shadow 0.2s;
}

.token-form input:focus,
.token-form select:focus {
    border-color: #6a5acd;
    box-shadow: 0 0 0 3px rgba(106, 90, 205, 0.12);
}

.submit-button {
    height: 50px;
    margin-top: 18px;
    border: 0;
    border-radius: 11px;
    background: linear-gradient(90deg, #6a5acd, #4c9be8);
    color: white;
    font: inherit;
    font-weight: 800;
    cursor: pointer;
    transition: transform 0.2s, opacity 0.2s;
}

.submit-button:hover:not(:disabled) {
    transform: translateY(-1px);
}

.submit-button:disabled {
    cursor: wait;
    opacity: 0.65;
}

.message {
    margin: 18px 0 0;
    padding: 12px 14px;
    border-radius: 10px;
}

.error-message {
    background: #fff0f0;
    color: #b42318;
}

.success-message {
    background: #e8f8ef;
    color: #217a4b;
}

.info-message {
    background: #eef4ff;
    color: #315b91;
}

.upload-card {
    width: 100%;
}

.upload-level-button {
    width: 100%;
    margin-top: 0;
    font-size: 1.05rem;
}

.upload-disabled-hint {
    margin: 10px 2px 0;
    color: #817b8f;
    font-size: 0.84rem;
}

.upload-card details {
    margin-top: 18px;
}

.zip-card {
    width: 100%;
}

.zip-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
}

.zip-actions .submit-button {
    width: 100%;
    margin-top: 0;
}

.secondary-button {
    background: linear-gradient(90deg, #514a70, #6a5acd);
}

.hidden-file-input {
    display: none;
}

.zip-progress {
    display: grid;
    gap: 8px;
    margin-top: 18px;
    color: #5d5770;
    font-size: 0.88rem;
}

.zip-progress progress {
    width: 100%;
    height: 10px;
    accent-color: #6a5acd;
}

.result-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}

.success-badge {
    flex: none;
    padding: 6px 10px;
    border-radius: 999px;
    background: #e8f8ef;
    color: #217a4b;
    font-size: 0.8rem;
    font-weight: 700;
}

.result-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 24px 0;
}

.result-grid>div {
    padding: 15px;
    border-radius: 12px;
    background: #f6f5fb;
}

.result-grid dt {
    margin-bottom: 6px;
    color: #77728a;
    font-size: 0.78rem;
}

.result-grid dd {
    margin: 0;
    color: #2c2940;
    font-weight: 700;
    overflow-wrap: anywhere;
}

.result-grid .token-result {
    grid-column: 1 / -1;
}

details {
    border-top: 1px solid #e4e1ef;
    padding-top: 18px;
}

details+details {
    margin-top: 18px;
}

.level-results pre {
    max-height: 560px;
}

.result-card.level-results {
    width: 100%;
}

.online-language-panel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-bottom: 20px;
    padding: 16px;
    border: 1px solid #e4e1ec;
    border-radius: 14px;
    background: #f8f7fb;
    text-align: left;
}

.online-language-panel h3 {
    margin: 0 0 10px;
    color: #4b4658;
    font-size: 0.9rem;
}

.online-language-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.online-language-chips .chip {
    padding: 6px 12px;
    border-radius: 999px;
    background: #e7e5ec;
    color: #514b60;
    font-size: 0.82rem;
    font-weight: 700;
}

.online-language-empty {
    margin: 0;
    color: #817b8f;
    font-size: 0.85rem;
}

summary {
    color: #5a4fb1;
    font-weight: 700;
    cursor: pointer;
}

pre {
    max-height: 320px;
    overflow: auto;
    padding: 16px;
    border-radius: 10px;
    background: #242033;
    color: #e9e7f5;
    font-family: Consolas, monospace;
    font-size: 0.84rem;
    white-space: pre-wrap;
    word-break: break-word;
}

@media (max-width: 1180px) {
    .workspace--with-actions {
        grid-template-columns: minmax(0, 1fr);
    }

    .panel-actions {
        position: static;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
}

@media (max-width: 820px) {
    .account-topbar-main {
        flex-direction: column;
        align-items: stretch;
    }

    .account-topbar-actions {
        margin-left: 0;
    }

    .panel-actions {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 560px) {
    .upload-page {
        padding: 12px;
    }

    .login-card,
    .result-card {
        padding: 22px 18px;
        border-radius: 18px;
    }

    .result-grid {
        grid-template-columns: 1fr;
    }

    .account-stats {
        overflow-x: auto;
        flex-wrap: nowrap;
        padding-bottom: 4px;
    }

    .topbar-button {
        flex: 1;
    }

    .online-language-panel {
        grid-template-columns: 1fr;
    }

    .result-grid .token-result {
        grid-column: auto;
    }
}
</style>