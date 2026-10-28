const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const SparkMD5 = require("spark-md5");

const view = path.resolve(__dirname, "../src/views/OverSeaUpload");
const originalTs = Module._extensions[".ts"];
Module._extensions[".ts"] = (module, filename) => module._compile(
  ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText,
  filename,
);

const plain = (value) => JSON.parse(JSON.stringify(value));
const objectKey = "ugcprodcht/video/os_cht/fixture/20261029/source.MP4";
const rawVideoUrl = `/${objectKey}`;
const mediaBase = "https://cht-ugc-upload.hoyoverse.com/";
const vodId = "0123456789abcdef0123456789abcdef";
const vodUrl = `${mediaBase}vod-fixture/${vodId}/stream-2k.mp4?auth_key=fixture`;

function loadFunctions(context, fileName, names) {
  const source = fs.readFileSync(path.join(view, fileName), "utf8");
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile(fileName, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter((node) =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text),
  );
  assert.equal(declarations.length, names.length, `Missing functions in ${fileName}`);
  const code = declarations.map((node) => node.getText(ast)).join("\n");
  vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context, { filename: fileName });
}

function createHarness(callback, ossOverrides = {}, responseStatus = 200) {
  const requests = [];
  const posts = [];
  const context = vm.createContext({
    URL, URLSearchParams, File, Blob, FormData, Error, console, SparkMD5,
    ...require(path.join(view, "videoHelpers.ts")),
    ...require(path.join(view, "csvHelpers.ts")),
    isObjectUrl: require(path.join(view, "zipHelpers.ts")).isObjectUrl,
    loggedInServer: { value: "cht" },
    sessionToken: { value: "test-session" },
    tokenResponse: { value: { data: { uid: "fixture", region: "os_cht" } } },
    detailResponse: { value: { data: { level_id: "fixture", info_data: {} } } },
    storedLevelId: { value: "fixture" },
    levelIdInput: { value: "" },
    uploadsBusy: { value: false },
    uploadedVideo: { value: null },
    videoUploadError: { value: "" },
    zipProgress: { value: "" },
    proxyRequest: async (url, cookie, options) => {
      requests.push({ url, cookie, options });
      if (options.responseType === "blob") return new Blob(["download"]);
      return {
        retcode: 0, message: "OK", data: {
          file_name: "source.MP4",
          oss: {
            host: "https://fixture.oss-ap-northeast-1.aliyuncs.com/",
            name: "source.MP4", dir: objectKey.slice(0, objectKey.lastIndexOf("/") + 1),
            callback: "fixture-callback",
            callback_var: { "x:extra": "fixture-extra" },
            x_oss_content_type: "video/mp4", accessid: "fixture-access-id",
            policy: "fixture-policy", signature: "fixture-signature", object_acl: "default",
            ...ossOverrides,
          },
        },
      };
    },
    axios: {
      post: async (url, body) => {
        posts.push({ url, body });
        return { status: responseStatus, data: callback };
      },
      isAxiosError: () => false,
    },
    props: {},
    languageOptions: { value: [{ code: "en-us" }] },
    languageDrafts: { value: { "en-us": {
      level_name: "Fixture", level_intro: "Intro", desc: "Description", changelog: [],
    } } },
    selectedLanguages: { value: ["en-us"] },
    primaryLanguage: { value: "en-us" },
    tagDraft: { value: {
      play_cate: "LEVEL_PLAY_CATE_ENUM_Short", devices_control: [{ tag_id: "80001" }],
      tags: [], play_type: { tag_id: "20001" },
    } },
    localCoverFile: { value: null },
    hideOriginalCover: { value: false },
    info: { value: { cover_img: { img_url: `${mediaBase}ugcprodcht/image/cover.png` } } },
    galleryImages: { value: [] },
    displayUploads: { value: [] },
    originalVideoUrl: { value: "" },
    originalVideoId: { value: "" },
  });
  context.videoUpload = context.uploadedVideo;
  context.levelEditorRef = { value: {
    applyImportedDrafts: () => {},
    clearOriginalVideoForImport: () => {
      context.originalVideoUrl.value = "";
      context.originalVideoId.value = "";
    },
  } };
  loadFunctions(context, "OverSeaUpload.vue", [
    "buildLevelUploadPayload", "requireRemoteMediaUrl", "resolveHoyoverseMediaUrl",
    "resolveChangelog", "uploadVideo", "removeVideo", "uploadResourceToOss",
    "extractOssCallbackData", "appendExtraFormData", "formatUploadError", "buildCookie",
    "stableObjectKey", "normalizeImportedRemoteUrl", "downloadBinaryViaWorker",
    "applyReusedVideo", "asFile", "applyImportedZip", "isImportMedia", "importUploadError",
  ]);
  loadFunctions(context, "LevelEditor.vue", [
    "getExportState", "cloneChangelog", "cloneTagDraft", "cloneTags", "cloneTag", "fileNameFromUrl",
  ]);
  return { context, requests, posts, payload: () => plain(context.buildLevelUploadPayload(context.getExportState())) };
}

async function main() {
  const { buildVideoUploadInfo, resolveVideoAccessUrl } = require(path.join(view, "videoHelpers.ts"));
  const sourceFile = new File(["fixture-video"], "clip.MP4", { type: "video/mp4" });

  // Exercise the real upload -> editor export -> info submission path with a mocked OSS response.
  const fresh = createHarness({ retcode: 0, data: { url: rawVideoUrl, object: objectKey } });
  try {
    await fresh.context.uploadVideo(sourceFile, true);
    assert.equal(fresh.context.uploadedVideo.value.status, "success");
    assert.equal(fresh.context.uploadedVideo.value.sourceId, undefined);
    assert.deepEqual(fresh.payload().video_info, { video_url: rawVideoUrl, video_id: "" });
    assert.equal(fresh.context.uploadedVideo.value.result.callbackData.url, rawVideoUrl);
    assert.equal(fresh.requests[0].options.data.ext, "MP4");
    assert.equal(fresh.requests[0].options.data.md5, SparkMD5.ArrayBuffer.hash(await sourceFile.arrayBuffer()));
    assert.equal(fresh.posts[0].body.get("key"), objectKey);
    assert.equal(fresh.posts[0].body.get("x:extra"), "fixture-extra");
    assert.equal(fresh.posts[0].body.get("success_action_status"), "200");
    assert.deepEqual(fresh.posts[0].body.getAll("success_action_status"), ["200"]);
    assert.equal(fresh.posts[0].body.get("file").name, "clip.MP4");
  } finally { fresh.context.removeVideo(); }

  const existing = createHarness(null);
  existing.context.originalVideoUrl.value = vodUrl;
  existing.context.originalVideoId.value = vodId;
  assert.deepEqual(existing.payload().video_info, { video_url: vodUrl, video_id: vodId });
  assert.equal(existing.requests.length, 0, "Keeping an original video does not upload it again");
  existing.context.originalVideoUrl.value = rawVideoUrl;
  existing.context.originalVideoId.value = "";
  assert.deepEqual(existing.payload().video_info, { video_url: rawVideoUrl, video_id: "" });
  existing.context.originalVideoUrl.value = "";
  assert.deepEqual(existing.payload().video_info, {});

  const processed = createHarness({ retcode: 0, data: { url: vodUrl, video_id: vodId, object: objectKey } });
  try {
    await processed.context.uploadVideo(sourceFile, true);
    assert.deepEqual(processed.payload().video_info, { video_url: vodUrl, video_id: vodId });
  } finally { processed.context.removeVideo(); }

  // ZIP import must use the same callback path, including when importing a lowercase extension.
  const imported = createHarness({ retcode: 0, data: { url: rawVideoUrl, object: objectKey } });
  try {
    const file = new File([sourceFile], "archive.mp4", { type: "video/mp4" });
    await imported.context.applyImportedZip({ manifest: { editor: {} } }, {
      coverUnchanged: true, displayUnchanged: true, videoUnchanged: false,
      videoSource: { entry: {}, file },
    });
    assert.deepEqual(imported.payload().video_info, { video_url: rawVideoUrl, video_id: "" });
    assert.equal(imported.requests[0].options.data.ext, "mp4");
  } finally { imported.context.removeVideo(); }

  // Reusing a current video keeps its submit reference; only playback and downloads get a CDN URL.
  existing.context.applyReusedVideo({ label: "Video", remoteUrl: rawVideoUrl, objectKey });
  assert.deepEqual(existing.payload().video_info, { video_url: rawVideoUrl, video_id: "" });
  assert.equal(existing.context.uploadedVideo.value.previewUrl, `${mediaBase}${objectKey}`);
  await existing.context.downloadBinaryViaWorker(rawVideoUrl);
  assert.equal(existing.requests[0].url, `${mediaBase}${objectKey}`);
  assert.equal(resolveVideoAccessUrl(rawVideoUrl, mediaBase), `${mediaBase}${objectKey}`);
  assert.equal(resolveVideoAccessUrl(vodUrl, mediaBase), vodUrl);
  assert.equal(resolveVideoAccessUrl(rawVideoUrl), "");

  // Do not synthesize a successful video reference from a filename if the callback omitted its URL.
  const incomplete = createHarness({ retcode: 0, data: { object: objectKey } });
  try {
    await assert.rejects(incomplete.context.uploadVideo(sourceFile, true), /缺少上传回调地址/);
    assert.equal(incomplete.context.uploadedVideo.value.status, "error");
    assert.throws(() => incomplete.payload(), /缺少上传回调地址/);
  } finally { incomplete.context.removeVideo(); }

  const imagePath = "/ugcprodcht/image/os_cht/fixture/cover.png";
  const image = createHarness({ retcode: 0, data: { url: imagePath } });
  const imageResult = await image.context.uploadResourceToOss(
    new File(["fixture-image"], "cover.png", { type: "image/png" }),
    { ext: "png", allowedTypes: new Set(["image/png"]) },
  );
  assert.equal(imageResult.url, `${mediaBase}${imagePath.slice(1)}`, "Image URL normalization is preserved");

  const explicitKey = createHarness({ retcode: 0, data: { url: rawVideoUrl } }, {
    dir: undefined, key: objectKey, extra_form_data: [{ key: "success_action_status", value: "200" }],
  });
  try {
    await explicitKey.context.uploadVideo(sourceFile, true);
    assert.equal(explicitKey.posts[0].body.get("key"), objectKey);
    assert.deepEqual(explicitKey.posts[0].body.getAll("success_action_status"), ["200"]);
    assert.equal(explicitKey.context.uploadedVideo.value.object, objectKey);
  } finally { explicitKey.context.removeVideo(); }

  for (const [response, status] of [
    [{ retcode: -1, message: "media callback failed", data: { url: rawVideoUrl } }, 200],
    [{ data: { url: rawVideoUrl } }, 200],
    [null, 204],
    [{ retcode: 0, data: { url: rawVideoUrl } }, 203],
  ]) {
    const failed = createHarness(response, {}, status);
    try {
      await assert.rejects(failed.context.uploadVideo(sourceFile, true), /OSS 上传确认失败/);
      assert.equal(failed.context.uploadedVideo.value.status, "error");
      assert.equal(failed.context.uploadedVideo.value.url, "");
    } finally { failed.context.removeVideo(); }
  }

  assert.deepEqual(buildVideoUploadInfo({ label: "Video", remoteUrl: rawVideoUrl, objectKey }), {
    video_url: rawVideoUrl, video_id: "",
  });
  for (const remoteUrl of ["", "blob:local", "http://example.com/video.mp4", "//example.com/video.mp4", "/\\example.com/video.mp4"]) {
    assert.throws(() => buildVideoUploadInfo({ label: "Video", remoteUrl }));
  }
  assert.throws(() => buildVideoUploadInfo({ label: "Video", remoteUrl: rawVideoUrl, sourceId: objectKey }), /video_id 无效/);
  console.log("Oversea video checks passed: raw paths and IDs, editor/ZIP payloads, preview/downloads, dir+name and key formats, explicit OSS success status, callback confirmation/failures, and image compatibility.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalTs) Module._extensions[".ts"] = originalTs;
  else delete Module._extensions[".ts"];
});
