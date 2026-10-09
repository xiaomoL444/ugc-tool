# AI 资产搜索

页面保留项目现有路径 `/AISearch`。聊天记录通过项目统一存档服务保存到 `/AISearch/archive.json`；选择“浏览器存档”时由 IndexedDB 保存，并纳入现有存档迁移与同步流程。切换会话、重命名、删除和新对话均可使用。已有清空上下文的存档边界保持兼容，可见历史保留，后续调用不发送边界之前的消息。

桌面端采用左侧历史、右侧聊天两个独立面板。历史默认宽 280px，拖动中间的 14px 分隔条可在 220–420px 间调整，同时为聊天保留至少 360px。分隔条支持左右方向键每次 8px、Shift 加方向键每次 32px、Home／End 调整到允许的最窄／最宽位置，以及双击恢复默认宽度。宽度只保留在当前页面内存，折叠历史或切换会话后仍保留；容器变窄时临时限宽，空间恢复后还原，不写入对话存档。860px 及以下隐藏分隔条，历史仍使用原有抽屉。

存档同时保存当前会话和上次选择的基础搜索、站点 AI 或我的模型模式，刷新后恢复；站点 AI 服务可用时不会覆盖已保存的选择。自有模型的地址、名称和 API Key 保存规则沿用模型设置，不写入对话存档。首次使用新版时，只在新存档不存在时迁移旧 `ugc-tools.ai-search.history.v1` 记录，确认新存档写入成功后才删除旧数据。读取失败或存档损坏会显示提示并停止自动覆盖；保存失败仍能继续当前对话。

输入框、模型按钮和圆形发送／停止按钮排在同一行。短占位文字引导描述所需资产，完整输入说明保留为无障碍标签；输入区不再展示 Enter 操作提示或清空上下文按钮，Enter 发送、Shift+Enter 换行仍可使用。站点 AI 模式的按钮直接显示“站点 AI · 剩余 X 次”，次数读取真实的站点 AI 额度；额度未知时只显示“站点 AI”，不伪造零次。次数单独显示且不会省略，输入区仍保持一行；模型选择弹窗保留每日额度、状态和手动刷新。

右侧模型按钮在站点 AI 模式显示通用“站点 AI”与剩余次数，自有模型显示用户配置的模型名称，基础搜索显示“基础搜索”。站点 AI 按钮、提示文字和设置弹窗均不显示服务端实际模型 ID；底层模型信息与调用逻辑仍保留。点击按钮打开“选择搜索模型”弹窗，可在站点 AI、自有模型和基础搜索三种模式之间选择。弹窗内的选择先作为草稿；点击“使用此模型”或自有模型的“保存并使用”后才提交，取消或关闭不改变已选模式。调用中或存档读取中禁止切换。

每轮结果上限可快捷选择 5／10／20／50 条，也可自定义 1–50 的整数，默认 10 条。选择写入统一存档并在刷新后恢复；自定义输入点击“应用”或按 Enter 才生效，取消或关闭面板不改变原选择。每条回复可保留最多 50 张可信资源卡片；模型可以返回更少的真实匹配，不强制凑数。数量选择同样进入自有模型与站点 AI 请求，输出预算随上限调整，不重复调用模型来拼接卡片。

每轮紧凑卡片以 240px 为目标宽度、12px 为间距，按容器宽度分页，同一行每页显示 1～6 张，手机每页显示 1 张。翻页只切换已取得的结果，不调用 AI，并停止离开当前页的媒体播放。同一轮结果在当前布局宽度下保留已测得的最高行高，各卡片拉齐高度；上一页、下一页以工具栏的屏幕位置保持滚动锚点，较短页面或最后一页不会缩短整段结果而挤动聊天。媒体异步加载时继续更新保留高度，布局宽度变化后重新测量。存档与后续上下文继续保留整轮结果及原始顺序，分页不截断完整结果。

卡片中的资源描述平时显示一行，超出部分省略。鼠标或触控笔仅在缩略描述行悬停时显示完整说明，离开立即关闭，无延迟。浮层使用 `pointer-events: none`，鼠标移入浮层不会使其续留，鼠标点击描述行也不会固定浮层。

长说明采用更宽的阅读浮层：BGM 最宽 720px，其他超过 320 字符的描述最宽 640px，高度最多 640px；短描述沿用 360px 宽与 420px 高上限。所有浮层保留视口四周 12px 边距，不裁剪描述正文。仍有溢出时，桌面鼠标留在缩略描述行上即可用滚轮滚动完整说明，聊天位置不随之移动；浮层给出五语操作提示，鼠标离开缩略行仍立即关闭。

键盘聚焦描述行可显示说明，Escape 关闭；长说明支持方向键、PageUp／PageDown 和 Home／End 滚动。手机点击描述行可展开或收起，展开后可在浮层内触摸滑动阅读，点击外部关闭。同一浮层展示完整描述、关键词、匹配原因与用途。展开说明直接读取本轮结果，不追加 AI 调用，也不改变存档或后续上下文。

站点 AI 服务通过 `/config.limits.maxResults` 声明结果能力，检索历史上限由 `/catalog.limits.maxPreviousIds` 声明，并按已部署的服务上限返回。`/catalog.limits.maxSearchLimit`、`maxAssetIds` 和 `maxExcludeIds` 分别声明单批检索、详情与排除 ID 数量；旧服务未声明时分别按 30、10、30 处理，检索历史默认最多 5 个 ID。网页保留完整的上一轮排除列表，每次请求按服务上限发送，并在本地过滤剩余 ID；候选不足时继续读取同一次检索的游标页，直到达到本轮上限或没有更多候选，避免 50 个结果的“再来点”触发旧 Worker 的 `INVALID_IDS` 或重复旧卡片。所有游标页的检索与排除条件保持一致，额外分页不追加模型调用。站点 AI 要返回最多 50 条，需要重新部署 `tools/ai-search-service` 中的新 Worker，主配置和两个示例的 `MAX_OUTPUT_TOKENS` 已统一为 5400，实际输出预算按本轮数量分级。基础搜索与自有模型支持 1–50 条。

## 当前可用方式

- **基础搜索**：由 Worker 检索真实的音效、特效、BGM 资源 ID、名称、描述、关键词和单独的用途建议。无需聊天模型或 API Key，但需要资产检索服务可用。支持上次结果中的序号和按整体时长排序的简单追问；不能把总时长当尾音长度。
- **站点 AI**：使用站点提供的模型。连接服务端 `/api/ai-search/config` 和 `/api/ai-search/chat`。未部署服务时明确显示未接通，不伪造调用结果或站点 AI 使用次数。新服务负责权威资产检索与详情，并重新根据候选 ID 读取描述。部署模板在 `tools/ai-search-service/`，当前主配置为每日 10 次、每月 50 元的服务端保守预算，两个示例仍为每日 5 次。
- **我的模型**：填写支持聊天接口的服务基础地址、模型名和自己的 Key。请求使用 OpenAI 兼容 `chat/completions`；网页直连需要该服务允许浏览器跨域请求。如果提供商不允许跨域，可填写你部署的兼容代理地址。网站不会接收或保存自有模型 Key；只有明确勾选保存时才写入当前浏览器的 localStorage，否则仅保留在当前标签页的 sessionStorage 和内存中。

对话和卡片不会存储 API Key。模型正文作为纯文本显示。模型回复格式、资源 ID 校验或输出截断失败且有实际正文时，错误文字右侧显示感叹号；悬停、键盘聚焦或手机点击可查看、滚动和选择复制原文。从浮层内拖选文字时，移出并在外松开不会关闭浮层；选区保留期间可继续复制，点击外部或按 Escape 关闭。模型设置与会话管理对话框仅在按下和松开均位于真实背景时关闭，框内开始的拖选不会误关。原文按 UTF-8 最多保留 16 KiB，并遮蔽凭据字段，随错误消息写入浏览器存档；不会加入后续模型上下文，也不会再次调用模型。旧记录或旧服务没有返回原文时不显示图标；站点 AI 需部署支持 `error.rawResponse` 的新 Worker。模型只能选择检索工具实际返回的 ID；网页用可信详情生成 `/SoundEffectPlayer?id=...`、`/EffectPlayer?id=...` 和 `/BgmPlayer?id=...`，不采用模型生成的网址。卡片按类型显示小预览，并提供数字资产 ID、名称复制与资产页入口；BGM 资产页链接使用本库资产 ID，预览播放器使用元数据中的网易云 `song_id`。

自有模型使用 DeepSeek 官方接口时，页面每轮显式关闭思考。新检索服务下采用 function calling，最终一轮启用 JSON 输出；百炼官方兼容接口也在最终一轮启用 JSON 输出。其他兼容服务保留通用请求参数。输出被截断时单独提示，仍要求完整回复与可信资源 ID，不自动重复付费调用。

## 模型返回格式修复

网页的自有模型和 Worker 的站点 AI 共用 `tools/ai-search-service/model-json.mjs`。仅处理模型最终回答正文：去除 BOM 和代码围栏后先尝试严格 `JSON.parse`，语法失败时才用 `jsonrepair` 修复，再解析并交给原有字段、资源 ID、重复项和数量校验。可处理部分漏引号、单引号、多余逗号和英文引号转义问题；格式可修复不代表资源有效。

`finish_reason=length` 等未完整生成状态仍在解析前拒绝，明显未闭合的最外层对象或数组不补齐。修复失败保留原始模型正文供错误提示查看，不使用修复后的文本替代诊断。HTTP 响应封装、接口请求、资产文件、存档及工具参数继续严格解析。本地修复不新增模型调用或 MCP 检索。上线自有模型需要发布前端；上线站点 AI 还需要重新部署 Worker。

## 外置系统提示词

检索行为统一来自 [`ugc-tool-data/AISearch/SystemPrompt.md`](https://oss.xiaomol444.xyz/ugc-tool-data/AISearch/SystemPrompt.md)。自有模型的 Agent 和候选筛选通过 `OSS_BASE_URL/AISearch/SystemPrompt.md` 读取正文，再以 system 消息发给模型；站点 AI 由 Worker 自己读取，网页不代传提示词。基础搜索无需此文件。开发环境沿用现有 OSS 代理，生产环境使用 `OSS_BASE_URL` 对应的公开源。

成功读取缓存一分钟，每次对话的多轮工具请求使用同一份正文；到期后用 `no-store` 和 `_t` 时间参数请求新版本。支持文件中 `RESULT_LIMIT` 占位和 Markdown 对下划线、方括号的转义。代码只补充工具／候选模式、每轮数量及 `answer/matches` 返回格式，不保留内置检索提示词作为回退。文件读取失败、超时、空白、格式不合法或超过 16 KiB 时显示提示，并停止模型调用。

首次启用需发布前端并重新部署 Worker；以后修改并上传同一路径的 Markdown，约一分钟后新请求读取更新，无需重新部署。站点 AI 服务源地址由服务端 `SYSTEM_PROMPT_URL` 配置，详见 `tools/ai-search-service/README.md`。

页面读取 `OSS_BASE_URL/AISearch/index.json` 的 `data` 版本字段检查提示词或数据库是否更新。存档恢复后，如果已有历史消息且从未记录版本，首次成功读取就显示一次可关闭的浮悬通知“提示词或数据库有更新，建议新开一个对话搜索”，覆盖从无更新检测功能的旧网页升级的用户。没有历史消息或只有空对话的新用户首次读取只建立基线，本页后续新建的消息不算旧历史。已观察版本保存在当前浏览器的 localStorage，同版刷新或重开不重复提示，后续版本变化再提示。进入页面、页面可见时每 60 秒、重新聚焦或切回页面，以及提交搜索时均会检查；检查不阻塞搜索，失败时忽略并在下次重试，仍保留尚未完成的首次提示。

## 卡片预览

音效卡片复用原播放器的真实波形，可点击播放、暂停并拖动定位。特效卡片复用 `EffectMedia`，显示图标与主特效／拖尾预览；有真实音轨时，鼠标移入卡片启用音效，首次启用仍遵循浏览器的用户手势限制。BGM 卡片显示专辑封面、时长，点击试听才加载网易云播放器，默认不自动播放。

`previewMedia.ts` 根据经过校验的类型和 ID 解析媒体：音效地址沿用原播放器的 `{id}.mp3` 规则；特效和 BGM 从原播放器 `data.json` 懒加载元数据，各缓存一次索引。模型输出、对话存档不提供媒体地址；旧卡片与旧 Worker 返回值也能预览，无需为这次 UI 改动部署 Worker。读取失败可重试，缺少媒体保留资产页入口。预览媒体不加入 AI 请求，也不增加模型 token。音效播放、特效音轨与打开的 BGM 播放器相互协调，离开视口、切换会话或离开页面会停止声音。同一特效在多轮回复中重复出现时，活跃卡片各自持有独立媒体节点，释放后再复用闲置缓存。

## 站点 AI 服务接入

同源网关可以把 `/api/ai-search/*` 转发到已部署的服务。使用独立 Worker 时，在构建环境配置公开地址，例如：

```text
VUE_APP_AI_SEARCH_API_BASE=https://your-service.workers.dev/api/ai-search
```

项目根目录 `.env.production` 保存公开的生产 Worker 地址，随源码一起发布；`.env.local` 与 `.env.*.local` 已被 Git 忽略。Vue CLI 在构建时把 `VUE_APP_AI_SEARCH_API_BASE` 内联到网页脚本，浏览器不会读取服务器上的 `.env` 文件。修改地址后需重新执行 `npm run build` 并发布完整 `dist`；源码构建平台也需执行生产构建并把发布目录设为 `dist`。平台显式设置的同名环境变量优先于文件，应同步设置为正确地址。

服务地址可以公开，站长的 Key 必须留在服务端 secrets 中，不能放入任何 `VUE_APP_*` 变量。服务部署、价格、密钥与来源域名配置见 `tools/ai-search-service/README.md`。本次实现没有部署云服务，没有用真实 Key 调用模型。

使用 DeepSeek 官方接口的站点 AI 使用服务端 `MIN_BALANCE_CNY="20"` 保护阈值。Worker 通过站长 Key 查询官方余额接口，CNY `total_balance` 含赠送余额；余额小于 20 元或 `is_available=false` 时停用站点 AI，余额等于 20 元可以通过余额检查。查询失败、超时或没有可信 CNY 数据时也暂时停用。`/config` 只公开 `limits.minBalanceCny` 与停用原因，绝不公开真实余额；配置有效时 `configured` 仍为 true，`available` 为 false。前端显示 `PROVIDER_BALANCE_LOW` 或 `PROVIDER_BALANCE_UNAVAILABLE` 对应的停用提示。基础搜索和用户自有模型不受此停用影响；其他上游没有同类余额保障。

2026-10-08 已确认旧 Worker 的余额 fetch 使用 `redirect: "error"`，在 workerd 中于发出请求前抛错。现改用 `redirect: "manual"` 并拒绝重定向，不改变 20 元保护；修复需要重新部署 Worker，刷新前端本身不能更新线上余额查询代码。

新版服务可在 `error.reason` 提供余额检查的安全分类。前端只接收 `MISSING_KEY/AUTH/FORBIDDEN/RATE_LIMIT/UPSTREAM_ERROR/TIMEOUT/NETWORK/INVALID_RESPONSE/CNY_MISSING/ACCOUNT_UNAVAILABLE/ABORTED`，分别显示五语诊断；未知值、非字符串或旧服务没有分类时仍显示原通用停用提示，不展示或保存原始上游消息、密钥、真实余额。密钥相关提示明确指向 Worker 的站长 `UPSTREAM_API_KEY`，与用户在“我的模型”填写的密钥分开。诊断不会自动重试聊天或新增轮询；模型弹窗中的“刷新状态”仍由用户手动触发。

余额状态在 `/config` 最多缓存 30 秒，充值后等待缓存到期并刷新模型状态即可重新检查。每次 `/chat` 会实时查余额，包括读取已缓存回复之前；agent 与旧候选流程入场前被拦不会扣访客次数或月预算。agent 后续第 2、3 轮还会重新检查；前面已发生的调用和预留按原失败机制保留。该保护不能硬锁账户，也不能保证其他项目或并发结算后仍有 20 元。

余额保护与页面提示需要重新部署 `tools/ai-search-service` 的 Worker，并重新构建、发布前端；本次未部署，也未查询真实账户余额。主配置仍为每日 10 次、每月 50 元；最多 50 条结果时模型输出上限为 5400 tokens，较少结果使用较低输出预算。

## 资源描述约定

资源名称、媒体与时长继续读取各播放器原来的 `data.json` 和基础五语 `i18n`。特征字段放在 `SoundEffectPlayer/features.json`、`EffectPlayer/features.json` 和 `BgmPlayer/features.json`，每份包含 `resources[id].searchMetadata` 翻译引用及预编译检索索引。五语描述正文和关键词追加到各播放器原来的 `i18n/{locale}.json`，与名称翻译并存；特征文件通过 `i18nSource: project-i18n-v1` 引用这些字典，避免重复保存正文。基础资源文件不再承载 AI 描述引用。普通音效／特效浏览页与 Worker 读取同一套特征及五语字典，缓存版本覆盖这六个文件；卡片显示简短描述及悬浮详情，选中资产后显示完整描述。普通关键词搜索覆盖五语描述与关键词，特效主视觉、尾迹与真实音轨分开展示。

AI 搜索页面用于检索的目录加载全部由 Worker 承担，浏览器不下载全量描述、特征文件或五语字典来建立搜索库。页面接收资产库计数、版本、覆盖率、检索摘要与选中卡片详情。特效与 BGM 卡片播放仍按需读取原播放器的媒体索引，详见预览说明；这些数据不参与 AI 检索，也不阻塞资产库状态。普通资产浏览页仍按自身需要读取资料。特效的 `standVisual`、`tailVisual` 与 `audio` 分开读取，声音搜索只用声音特征；有音轨但无声音描述时仍保留资料不足状态。用途是建议，可能来源与不确定信息不能当作已确认属性。

进入页面时，聊天存档与 Worker `/config` 并行读取。`/config.retrieval` 已提供完整目录元信息时直接校验使用，省去重复 `/catalog`；旧配置没有完整元信息或配置检查失败时只读取 Worker `/catalog`。公共目录元信息保存在当前网页运行期间的内存中，切换页面后返回先恢复上次就绪状态，再后台刷新；刷新整个网页后重新连接服务。目录请求共享在途读取，失败显示服务错误和重试入口，不回退到浏览器整库加载。缓存不保存站点 AI 的可用状态、额度或余额，每次进入仍重新检查 `/config`。

Worker 在有请求时每分钟检查来源 SHA-256；文件 hash 不变则复用目录，成功更新后页面显示特征资料已更新；正在进行的模型调用先完成当前版本，释放快照后才刷新。刷新失败时继续使用最近一次成功目录并显示提示；首次加载失败停止检索。更新通知不会删除聊天记录或旧卡片。旧版本请求冲突时页面刷新目录，用户可以重新发送，不自动再次调用付费模型。

本轮已经生成的音效与特效描述都保存在独立特征包内；实际线上覆盖率以 Worker `/catalog.coverage` 为准。上传 JSON 后仍需首次部署支持动态文件的新 Worker，并发布前端；不能把本地包已生成当作线上已经生效。构建与上传步骤见 `tools/ai-search-service/README.md` 和 `exports/ugc-tool-data/UPLOAD.md`。

## 检索与上下文边界

页面先读取 `/config` 的 `retrieval.available`。新检索服务可用时，再读取 `/catalog` 获取全库计数、版本和描述覆盖率。**自有模型先收到自然语言请求，再由模型调用 `search_assets`、`get_assets` 或 `get_asset_catalog`；网页执行对应 `/search`、`/assets`、`/catalog` 请求，把结果作为 tool 消息发回同一个模型。**零候选不会在模型调用前挡住请求：模型可改写关键词、缩小类别、读取下一页或解释资料不足。工具使用与 MCP 相同的检索接口能力，通用聊天 API 不会自动访问 MCP；网页在这里承担工具执行器。

工具检索将返回资产的 `scope` 与匹配特征的顶层 `matchOn` 分开，`matchOn` 支持 `any/visual/audio`，默认 `any`。“爆炸特效”使用 `effect+visual`，“爆炸音效”使用 `sound+audio`；“特效里的爆炸音效”或“带爆炸音效的特效”使用 `effect+audio` 并要求 `hasAudio=true`，只返回具有相应声音证据的特效，不能拿普通音效代替。视觉名称和画面不能证明音轨听感，`hasAudio` 仅说明存在音轨。`includeEffectAudio` 只控制声音范围是否扩展到特效音轨，明确搜索特效自身声音时不受其旧隐藏 false 值影响。`get_assets` 将视觉与声音描述有界、分别提供；Agent 仍由模型先理解问题并决定工具参数。

新版及旧候选 `/chat` 同样接受外层可选 `matchOn`，省略时为 `any`。默认网页 Agent 不通过轻量关键词推断强行固定外层意图，而是在模型工具请求中选择具体特征。

默认 `matchOn=any` 可以省略。旧 `/search` 拒绝声音／视觉参数时，前端显示 `aiSearch.errors.matchOnUnsupported` 提示更新 Worker，不静默降级为混合检索。

本轮独立特征文件保留 1523 项特效的声音描述；旧部署目录仍可能显示声音描述为 0，需先发布文件并部署新 Worker。当全库特效声音描述均缺失时，后端提供 `EFFECT_AUDIO_DESCRIPTION_MISSING`，前端显示 `aiSearch.effectAudioDescriptionsMissing`：先按特效名称搜索，再到资产页试听。该提示不代表所有特效都没有音轨，也不代表所需资产一定不存在。

特征文件迁移需要首次更新 Worker 并重新构建、发布前端。本次复用已有生成记录，没有重新调用 Qwen，也没有上传或部署；每轮完整结果最多 50 张卡片可写入存档，余额保护规则保持不变。

站点 AI 在 `/config` 声明 `agent.available: true` 时，页面直接向 `/chat` 发送 `workflow: "agent"`、最新问题、成功历史和前次结果 ID，由 Worker 执行同样的工具循环，返回经过校验的资源详情；不在浏览器提前搜候选。未升级站点 AI Worker 时保留候选筛选旧协议，避免把不支持的新请求发给旧服务。

基础搜索按所选上限读取最多 50 条摘要；“再来点”等纯追问携带上一轮主题和 `excludeIds`，避免只搜索追问字面或重复卡片。基础搜索和自有模型最终选中的卡片通过 `/assets` 读取权威详情。网页不会把旧 OSS 索引描述覆盖到服务端结果上。选中 ID 和数字资产路由都必须验证。

检索状态显示实际使用的 `keyword` 或 `hybrid` 模式；混合检索需要服务端配置并建立向量索引。向量不可用而服务端回到关键词检索时，页面同步显示关键词模式。模型只能选择候选内的 ID；大量资产缺少特征描述时，搜索能力仍有限。

旧服务 `/config` 没有完整检索元信息时，页面尝试 Worker `/catalog`；接口不支持或检索服务不可用时显示错误，不读取本地整库，也不自动重复调用付费模型。资产索引版本变化会要求重新搜索。

资产详情每批按服务能力读取，旧服务默认最多 10 个 ID；最多 50 张卡片分成五批，兼容旧服务的详情接口。仅当 `/assets` 返回 `413 DETAILS_TOO_LARGE` 时，页面按单 ID 拆读、最多三个并发，再按请求顺序合并并校验版本和缺失项；单条详情仍过大则显示正常错误。这个处理只读取资产详情，不重新调用聊天模型。

基础搜索与旧候选协议在“全部资产”范围会识别“受击声”“受击音效”等明确资源类型，按对应范围检索；明确选择的范围优先，无类型词的简单追问继承上一轮卡片类型。新版工具流程由模型决定检索类型。同分的全类型候选按类型交错，避免特效 ID 前缀挤掉所有音效。普通音效允许按名称匹配，并说明依据；特效音轨只按声音描述与声音关键词检索，不使用视觉名称推断音色。

工具循环最多请求模型 3 次、执行 4 次模型工具调用，最后一轮关闭工具并要求最终 JSON。自有模型 Key 仅发送给用户填写的聊天地址，绝不会随检索请求发送给网站。每轮最多返回 50 条裁剪摘要；批量详情最多 5 个已检索 ID，不能用模型猜测的 ID 绕过检索。单条工具消息最多 16 KB，完整模型轮次请求最多 60 KB，保留 ID 和翻页信息、裁剪过长正文。工具服务或模型不支持 function calling 时明确报错，不自动退回关键词回复，也不额外自动付费重试。

工具模式发送最新问题与最近最多 8 条成功问答，由模型判断当前是新主题还是追问，不再用固定追问词表决定是否给 AI 上下文。初始构造体按 UTF-8 字节裁剪到 21 KB，上一轮显示结果的 ID、标题、时长与声音标记随助手历史发送。明确“再来点”等短句默认排除上一轮 ID；其他换一批请求由模型设置 `excludePrevious`。显式资源范围优先，选择“全部资产”时模型可主动缩小到 BGM、音效或特效。总请求超时为 60 秒。停止后不接受晚到回复，失败或取消的问答整对不进入后续上下文；清空上下文后不发送历史。

候选协议最多发送 50 条裁剪摘要；未声明新结果能力的旧站点 AI 服务仍限制为 12 个候选、五条结果；已升级检索、但未声明 agent 的站点 AI 服务只传 `candidateIds`、`audioCandidateIds` 与资产版本，由服务端重读。旧协议相关追问最多携带 8 条成功问答。不会发送整个资产库。

基础搜索或旧候选协议没有候选时由页面直接说明，不调用聊天模型；工具模式会先让模型理解并选择检索策略。BGM 尚无听感描述时，模型可以按名称找到候选，但不能凭名称确认激昂、悠闲等风格，应说明需要试听或补描述。

## 请求失败诊断

“我的模型”由浏览器直接请求用户配置的模型服务，Worker 只提供资产检索；Python 中的简单问候测试成功，不能证明浏览器跨域请求或带工具、上下文的搜索请求也会成功。支持 OpenAI 兼容 Chat Completions 与 Claude 原生 Messages 两种协议；默认自动识别官方 Claude 域名和 `/v1/messages` 路径，也可手动选择协议。Claude 原生调用使用 `/v1/messages`、`x-api-key` 和 SDK 所用的版本／浏览器请求头；代理是否接受浏览器调用仍由该服务决定。工具请求转换为 `tool_use/tool_result`，思考签名仅在当前调用的内存对话中原样传回 Claude，不加入网页存档、诊断或 Worker 请求。

官方 OpenAI 地址支持填 `https://api.openai.com`、`https://api.openai.com/v1` 或完整 `/v1/chat/completions`；粘贴官方 `/v1/responses` 或以前误拼的 `/v1/responses/chat/completions` 也会规范为 `/v1/chat/completions`，不会按 Responses 协议发送请求。官方接口使用 `max_completion_tokens` 控制输出；其他兼容服务保留原 `max_tokens` 参数。官方 `gpt-6-luna` 的 Chat Completions 工具调用需 `reasoning_effort="none"`，工具流程会按[官方要求](https://developers.openai.com/api/docs/models/gpt-6-luna)设置此参数，不改用户选择的模型名称。

模型设置中的“测试模型”由用户手动触发一次短请求，最多生成 128 个 token，弹窗最多等待 20 秒。测试不读取资产、系统提示词或聊天记录，也不请求 Worker；打开／保存设置不会触发测试。成功显示请求模型及服务返回的模型标识，若服务没有返回标识则明确说明。此结果仅证明基础模型调用已返回有效响应，不证明服务商实际权重、工具调用或完整搜索 JSON 支持；截断响应另作提示。修改地址、模型、密钥或协议，切换模式、关闭弹窗或离开页面都会取消未完成的测试，旧响应不能写入新配置的状态。

失败回复会说明出错环节（模型接口、站点服务、资产目录、检索、详情或系统提示词）、HTTP 状态及可读取的服务商原因。右侧诊断入口提供接口地址、模型、轮次、耗时、错误码、参数和请求 ID。自有 API 的 429 与站点每日次数用完分开，403 与密钥无效的 401 分开，5xx 标明服务端错误。服务返回非 JSON 错误页时仍保留 HTTP 状态，不把它误报为模型 JSON 格式错误。

浏览器没有提供可读取响应时，只能判断请求失败，无法从 `TypeError` 单独确定是跨域、DNS、TLS、代理还是网络连接；页面会明确这个限制，提示查看开发者工具中第一条失败请求及 Console。诊断仅保存经过限长、密钥脱敏的公开字段，剥离 URL 用户信息、查询参数及片段；不保存 Authorization、请求体或整个服务商错误包。诊断与模型原文分别展示，仅错误回复进入浏览器存档，均不发送到后续模型上下文。打开诊断不会重试模型调用。

## 验证

```text
npm run type-check
node scripts/test-ai-search.cjs
node scripts/test-ai-search-catalog-cache.cjs
node scripts/test-ai-search-agent.cjs
node scripts/test-ai-search-system-prompt.cjs
node scripts/test-ai-search-request-diagnostics.cjs
node scripts/test-ai-search-model-protocol.cjs
node scripts/test-ai-search-response-errors.cjs
node scripts/test-ai-search-request-cors-browser.cjs
node scripts/test-ai-search-archive.cjs
node scripts/test-ai-search-previews.cjs
node scripts/test-ai-search-result-limits.cjs
node scripts/test-ai-search-more.cjs
node scripts/test-ai-search-feature-sync.cjs
node scripts/test-ai-search-data-update.cjs
node --test tools/ai-search-service/worker.test.mjs tools/ai-search-service/agent-runtime.test.mjs tools/ai-search-service/asset-search.test.mjs tools/ai-search-service/asset-features.test.mjs tools/ai-search-service/asset-catalog-loader.test.mjs tools/ai-search-service/provider-balance.test.mjs tools/ai-search-service/system-prompt.test.mjs
```

浏览器回归 `scripts/test-ai-search-browser.cjs`、`scripts/test-ai-card-previews-browser.cjs`、`scripts/test-asset-deep-links.cjs` 和 `experiments/ai-search-ui/verify-ui.cjs` 需要 Playwright，可用当前本机的 bundled runtime 通过 `NODE_PATH` 提供；默认测试地址 `http://127.0.0.1:8080`。浏览器测试使用模拟目录和模拟模型，不消耗 API 额度。卡片预览回归使用本地合成 WAV 校验真实波形、播放和定位，另校验特效悬停、BGM 懒加载及手机布局。

只验证历史／聊天独立面板、拖动与键盘调整、默认宽度恢复及移动抽屉时，运行布局专用回归：

```text
node scripts/test-ai-search-browser.cjs http://127.0.0.1:8080 --layout-only
```

只验证一行输入区、模型名称入口、弹窗草稿选择与确认／取消行为时，运行输入区专用回归：

```text
node scripts/test-ai-search-browser.cjs http://127.0.0.1:8080 --composer-only
```

特效音轨短测：`node scripts/test-ai-search-browser.cjs http://127.0.0.1:8080 --effect-audio-only`（同样需要 Playwright 的 `NODE_PATH`）。

余额保护回归使用模拟上游，覆盖严格的 20 元边界、每次聊天实时核实与配置缓存隔离，以及超时停用，不读取真实余额。Worker 离线部署 dry-run 已通过，打包 gzip 约 2366 KiB；本次未部署线上服务。

特征更新提示浏览器短测：`node scripts/test-ai-search-browser.cjs http://127.0.0.1:8080 --feature-sync-only`。使用模拟目录验证新 hash、stale 和版本冲突，不访问真实模型；原项目路由应由开发服务器正常提供。

提示词／数据库版本浮悬通知浏览器短测：`node scripts/test-ai-search-data-update-browser.cjs http://127.0.0.1:8080`。使用模拟 OSS 版本验证首次基线、同版去重、刷新持久化、关闭与移动端显示，不访问真实模型。

BGM 特征接入：站点 AI、工具检索和网页基础检索读取同一份音乐特征，音轨描述作为音乐特征，用途保留独立数组。Worker 从三个播放器共 18 份文件检查版本，响应 featureSync.hashes 包含 bgm；任一 BGM 语言变化也会通知更新。资源数据无需为此次接入重新生成，但需部署更新后的 Worker 并重新构建发布前端。
