# 网站免费 AI 搜索服务

这是**单独部署的服务模板**。新版网页先把请求与成功历史交给聊天模型；模型提出搜索或详情工具调用，Worker 执行工具、回传少量资料，模型可换词继续检索，最后返回资源 ID。Vue 根据真实资源详情显示卡片，点击打开原资产页。工具与 MCP 接口共用服务端检索逻辑。仓库中的 Vue 静态页面不能安全保存站长的 API Key，也不能靠浏览器 localStorage 限制全站开销。一个 Durable Object 原子维护匿名访客日次数、并发请求和全站月预算。未部署时页面显示免费服务未接通；基础关键词搜索无需模型调用。开发验证使用模拟上游和向量准备 dry-run，未部署、未上传向量、未调用付费模型。

## 模型返回格式修复

网页的自有模型和 Worker 的站点 AI 共用 `tools/ai-search-service/model-json.mjs`。仅处理模型最终回答正文：去除 BOM 和代码围栏后先尝试严格 `JSON.parse`，语法失败时才用 `jsonrepair` 修复，再解析并交给原有字段、资源 ID、重复项和数量校验。可处理部分漏引号、单引号、多余逗号和英文引号转义问题；格式可修复不代表资源有效。

`finish_reason=length` 等未完整生成状态仍在解析前拒绝，明显未闭合的最外层对象或数组不补齐。修复失败保留原始模型正文供错误提示查看，不使用修复后的文本替代诊断。HTTP 响应封装、接口请求、资产文件、存档及工具参数继续严格解析。本地修复不新增模型调用或 MCP 检索。上线自有模型需要发布前端；上线站点 AI 还需要重新部署 Worker。

`jsonrepair@3.15.0` 是项目根目录的运行依赖，由根 `package.json` 和 `pnpm-lock.yaml` 管理。网页和 Worker 都使用它；本目录没有独立依赖清单。安装必须在包含根 `package.json` 的 `ugc-tools` 目录进行，随后再进入 Worker 目录操作：

```powershell
cd H:\Code\ugc-web\ugc-tools
pnpm install --frozen-lockfile
cd tools/ai-search-service
```

发布源码时必须一起提交或上传更新后的根 `package.json`、`pnpm-lock.yaml` 和共享解析器源码，不能只上传 `model-json.mjs`。本机 `node_modules` 不随 Git 提交，Cloudflare 构建环境须根据依赖清单重新安装。`Can't resolve 'jsonrepair' in .../tools/ai-search-service` 表示此源码的依赖解析失败；报错路径是导入文件的位置，不能仅据此判断构建根目录。检查线上构建分支的依赖声明、安装步骤及缓存，不通过硬编码本机 `node_modules` 路径解决。

## 外置系统提示词

检索行为的系统提示词统一读取公开的 [`ugc-tool-data/AISearch/SystemPrompt.md`](https://oss.xiaomol444.xyz/ugc-tool-data/AISearch/SystemPrompt.md)。网站免费 AI 由 Worker 读取，自有模型由网页通过 `OSS_BASE_URL` 读取；文件正文作为 `role: "system"` 发给模型，模型无需自行访问文件地址。基础搜索不读取此文件。

三个 Wrangler 配置在 `[vars]` 中提供源地址；需要更换位置时由维护者修改服务端配置，不接收聊天请求传入的源地址或提示词：

```toml
SYSTEM_PROMPT_URL = "https://oss.xiaomol444.xyz/ugc-tool-data/AISearch/SystemPrompt.md"
```

源码不保留旧的检索提示词作为回退。程序只追加当前运行协议：工具调用次数、候选模式、结果上限及 `answer/matches` JSON 格式。文件中的 `RESULT_LIMIT` 会替换为本轮所选的 1 至 50；兼容 Markdown 编辑器对下划线和方括号的转义，如 `search\_assets`、`RESULT\_LIMIT`。

成功读取缓存 60 秒，每轮工具调用使用同一份正文。缓存到期后请求采用 `no-store` 和 `_t` 时间参数刷新，失败与取消不写缓存。文件要求 HTTPS、有效 UTF-8、非空且原始正文不超过 32 KiB（32,768 字节），响应类型为 `text/markdown`、`text/x-markdown` 或 `text/plain`；OSS 缺失类型或返回 `application/octet-stream` 时仍按正文校验。读取正文在内的超时为 5 秒，重定向不跟随。`PROMPT_UNAVAILABLE` 表示无法读取合法文件，返回 HTTP 503；不再继续调用模型，也不消耗该次免费额度或预留月预算。网页读取失败的诊断会区分文件过大、编码、空正文、HTML、类型及重定向，并显示已知的正文大小和上限；HTTP 200 仅表示请求成功，不表示内容通过校验。文件读取上限与包含上下文、工具的整体模型消息预算独立，后者保持现有配置。

首次接入需要部署本目录 Worker，并更新前端。接入完成后，只需将修改后的 Markdown 上传到相同 OSS 路径，后续请求在缓存到期后读取新内容，无需为提示词修改重新构建或部署。该文件是公开内容，不放密钥或私有资料。

## 游戏用途搜索与补充用途

本地 `SystemPrompt.md` 将任意具体游戏效果拆成对象与变化、触发阶段、期望玩家感受和可检索的声学方向，包括用途词库未收录的自定义玩法。例子和事件词表不是支持范围或固定声音模板。工具检索同时考虑用途/名称（`searchType=both`）与音轨听感（`searchType=feature`）；没有同名用途标签也可以依据声音描述推荐。声学路线是寻找候选的假设，游戏用途不会自动成为 `includeTerms` 硬过滤。只有真实音轨描述和明确音轨字段可以证明声音特征。

候选偏少或贴合度不足时，在既有工具预算内换词、翻页或读取必要详情。有真实近似候选时，说明吻合的听感与差异，并可在同一条 `answer` 追问期望感受；歧义不默认阻止返回卡片。带候选的回复仍只使用 `answer/matches`，用途推荐标为 `suggestion`。确实无法合理映射且无需查库时才使用空 `matches` 的纯澄清协议，不能编造 ID、补写声音属性或放宽用户硬要求。

区分对象、行为、阶段、听感和感受；多阶段效果可分别寻找动作接触、状态完成和界面反馈。环境地点与情绪氛围也分别考虑。单次触发、随操作重复、阶段持续和长期背景是使用方式，不证明素材能无缝循环。实验中的升级、尖刺与结算查询只作为历史示例回归；通用玩法理解需按跨行为、词库外需求的模型评估规格检查，不能据这几个例子宣称通用能力已经验证。

依据已有音轨描述补充游戏用途的独立模板位于 [`ugc-ai-search-file/experiments/game-audio-search-20261010/game-uses-prompt.txt`](../../../ugc-ai-search-file/experiments/game-audio-search-20261010/game-uses-prompt.txt)。它只生成带听感证据、适配理由和条件的新增用途，不重做原音频分析，不改原描述、声学关键词、冻结模板或已有用途；新增用途也不能反过来证明实际声音属性。第一阶段的隔离样本与离线验证不等于已经批量补标、上传 OSS 或部署。`node --test tools/ai-search-service/system-prompt.test.mjs` 会验证真实本地正文可加载并符合 32 KiB 文件限制和 30 KB agent 消息预算；这类协议检查不能证明模型实际选音质量。

## DeepSeek 免费模型

DeepSeek 专用配置为 `wrangler.deepseek.example.toml`，使用官方 API `https://api.deepseek.com/chat/completions` 与 `deepseek-flash`。`UPSTREAM_THINKING = "disabled"` 会发送 `thinking: {type: "disabled"}`，用于非思考的资源筛选。当前 DeepSeek API 默认开启思考，因此这项配置需要保留。[模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[聊天参数](https://api-docs.deepseek.com/api/create-chat-completion/)

专用配置按 2026-10-08 核对的高峰时段、缓存未命中价格预留预算：输入每百万 tokens 2 元，输出每百万 tokens 8 元。实际账单可能因时段与缓存更低；账本仍按保守单价扣预算。模型或价格变化后请更新配置。当前主配置 `wrangler.toml` 为匿名访客每日 10 次、全站月预算 50 元；两个示例配置仍为每日 5 次，首次复制时请核对 `GUEST_DAILY_LIMIT`。

首次配置时，可以将专用示例复制为 `wrangler.toml`。如果已经生成了 `wrangler.toml`，直接检查并编辑它，保留已有部署设置。生产网站需将真实来源（协议、域名、端口，不带页面路径）追加到 `ALLOWED_ORIGINS`。

```powershell
cd H:\Code\ugc-web\ugc-tools
pnpm install --frozen-lockfile
cd tools/ai-search-service
# 仅首次创建配置时执行；已存在的配置应直接编辑。
if (-not (Test-Path -LiteralPath wrangler.toml)) {
  Copy-Item -LiteralPath wrangler.deepseek.example.toml -Destination wrangler.toml
}
npx wrangler login
npx wrangler secret put UPSTREAM_API_KEY
npx wrangler secret put VISITOR_HASH_SECRET
npx wrangler deploy
```

`UPSTREAM_API_KEY` 交互输入 [DeepSeek 官方平台](https://platform.deepseek.com/api_keys) 创建的 Key；已有百炼 Key 不能用于上述 DeepSeek 官方地址。`VISITOR_HASH_SECRET` 交互输入一段随机且固定的字符串。Cloudflare secrets 不会自动读取 Windows 环境变量。

部署后在项目根目录 `.env.local` 设置公开的 Worker 接口地址，并重启开发服务；生产构建环境也要设置此变量：

```text
VUE_APP_AI_SEARCH_API_BASE=https://你的Worker地址/api/ai-search
```

网页「模型设置 → 刷新状态」显示可用后，选择「网站免费 AI」进行一次实际验证。config 检查配置、额度及官方 DeepSeek 余额状态；余额查询不调用聊天模型，也不会验证所配置的模型能否正常聊天。本次只准备配置与模拟测试，没有部署、查询真实账户余额或使用真实 Key 调用模型。

## DeepSeek 余额保护

三个 Wrangler 配置在 `[vars]` 中提供 `MIN_BALANCE_CNY = "20"`。仅当 `UPSTREAM_URL` 使用官方 `api.deepseek.com` 时，Worker 使用站长的 `UPSTREAM_API_KEY` 请求 `GET https://api.deepseek.com/user/balance`。保护读取人民币条目的 `total_balance`，包含未过期赠送余额与充值余额。[DeepSeek 官方余额接口](https://api-docs.deepseek.com/api/get-user-balance/)

2026-10-08 已在 workerd、兼容日期 `2025-04-01` 下复现旧余额请求的运行时错误：`redirect: "error"` 会在请求发到上游之前抛出 `Invalid redirect value`，旧错误处理将其隐藏成“无法核实余额”。余额请求现使用 `redirect: "manual"`，拒绝非成功 HTTP 状态，包括所有重定向；不会跟随 `Location`，也不会把站长 Key 发送给跳转目标。原来的 Node 模拟 fetch 测试不能发现这一运行时差异，因此增加 workerd 实际 fetch 的合成上游回归。此修复需重新部署 Worker 才会生效。

可信 CNY 总余额小于 20 元，或接口返回 `is_available=false` 时，网站免费 AI 暂停；余额等于 20 元可以通过余额检查。查询失败、超时或没有可信 CNY 余额时同样暂时停用，避免在余额不明时继续调用。每日次数和全站月预算独立继续生效；基础搜索及用户自有模型不受本站余额保护停用的影响。其他供应商没有同类查询保障，不能因配置了这项变量就宣称受到了余额保护。

`/config` 仅公开有效阈值 `limits.minBalanceCny` 与停用原因，不返回真实余额。配置有效时仍为 `configured=true`，余额保护拦截时为 `available=false`；低余额使用 `PROVIDER_BALANCE_LOW`，查询不可用使用 `PROVIDER_BALANCE_UNAVAILABLE`。配置查询的余额状态最多缓存 30 秒；充值后可等待缓存到期，再在网页刷新状态恢复。

新版 Worker 在 `PROVIDER_BALANCE_UNAVAILABLE` 的 `error.reason` 中附带以下固定枚举，方便区分查询失败原因；`PROVIDER_BALANCE_LOW` 不附带该字段。`/config`、聊天入场检查及后续 agent 模型轮使用同一规则，不返回密钥、实际余额、上游原始响应或异常文本，也不会为诊断额外调用聊天模型。

| `error.reason` | 含义与排查方向 |
| --- | --- |
| `MISSING_KEY` | 服务端 Key 缺失或去掉首尾空白后为空；检查 Worker 的 `UPSTREAM_API_KEY` secret。 |
| `AUTH` | 官方余额接口返回 401；确认 Worker 使用有效的 DeepSeek 官方 Key。 |
| `FORBIDDEN` | 官方接口返回 403；检查供应商账户及访问限制。 |
| `RATE_LIMIT` | 官方接口返回 429；稍后刷新状态。 |
| `UPSTREAM_ERROR` | 官方接口返回其他非成功 HTTP 状态；检查供应商服务状态，稍后重试。 |
| `TIMEOUT` | 余额查询超过 5 秒，包括读取响应的时间；稍后刷新状态。 |
| `NETWORK` | 无法完成网络请求或读取响应；检查服务网络及供应商状态。 |
| `INVALID_RESPONSE` | JSON、人民币余额或其他相关字段的格式不可信；保护保持停用，不按不完整数据继续调用。 |
| `CNY_MISSING` | 响应格式合理，但没有人民币余额条目；不会自行换算美元余额来满足 20 元规则。 |
| `ACCOUNT_UNAVAILABLE` | 可信人民币余额达到阈值，但官方接口仍标记 `is_available=false`；检查供应商账户可用状态。 |
| `ABORTED` | 发起查询的请求被取消；重新刷新状态。 |

维护者可在浏览器开发者工具的网络面板查看 `GET /api/ai-search/config` 的 `error.code` 与 `error.reason`，或查看聊天请求返回的同名字段。余额查询失败不代表已确认余额不足。之前部署的版本没有 `error.reason`，只能返回泛化提示；必须重新部署新版 Worker 后才能获得上述诊断，修改本地文件不会更新线上服务。旧响应缺少该字段时仍须按查询不可用处理，不能放行免费调用。临时失败的结果可能缓存 30 秒，等待缓存到期后刷新状态。

每次 `/chat` 实时查询余额，在返回已缓存的成功回复前也会检查。新版 agent 与旧候选流程均在消耗访客次数、预留月预算和调用聊天模型之前检查；入场前被拦截会返回 HTTP 503 与上述机器码，不扣本次免费额度或月预算。agent 的第 2、3 次模型请求前会再次核实；如果此前已经调用上游，后来余额不足或查询失败会停止剩余调用，已有请求的次数与费用预留按原失败机制保留。

这项检查控制本站是否发起免费请求，不能硬锁 DeepSeek 账户。其他项目的调用、并发请求及正在进行的结算仍可能改变余额，因此不能保证整轮结算后账户一定还留有 20 元。

已有站点需要重新部署 Worker，并重新构建、发布前端，才能启用保护与停用提示；仅修改本地配置不会更新线上服务。检查主配置中的 `MIN_BALANCE_CNY="20"`、`GUEST_DAILY_LIMIT="10"`、`MONTHLY_BUDGET_CNY="50"` 与 `MAX_OUTPUT_TOKENS="5400"`，保留现有 secrets 和来源域名。以下是维护者更新时执行的步骤，本次未部署：

```powershell
cd H:\Code\ugc-web\ugc-tools
pnpm install --frozen-lockfile
cd tools/ai-search-service
npx wrangler deploy
cd ../..
npm run build
# 将新构建的 dist 发布到已有前端站点。
```

## 通用模型配置与部署

1. 使用其他上游且尚无配置时，在这个目录将 `wrangler.example.toml` 复制成 `wrangler.toml`；已有配置直接编辑。`wrangler.toml` 已被本目录 `.gitignore` 忽略。
2. 填入完整的 OpenAI 兼容 `UPSTREAM_URL`（包含 `/chat/completions`）、`MODEL` 和网站 `ALLOWED_ORIGINS`。新版模型须支持 `tools` / `tool_calls`、`tool_choice: "required"` 与 `"none"`、`role: "tool"`、`response_format: {type: "json_object"}`、`max_tokens` 及非流式响应。仅有文字聊天 API 不足以运行工具流程；不支持时会提示换模型或基础搜索，不自动重试计费请求。
3. 将 `INPUT_CNY_PER_MILLION` 和 `OUTPUT_CNY_PER_MILLION` 改为**上游模型当前实际人民币单价**。模板故意填零，让未配置价格的服务不可用。使用外币计价或阶梯价格时，应换算为保守的最高适用单价；价格调整后及时更新。
4. 通过 Wrangler 的 secret 功能配置 `UPSTREAM_API_KEY`，另设置一个随机且固定的 `VISITOR_HASH_SECRET`。不要将 Key 放入 Vue、`VUE_APP_*` 变量、示例 TOML、Git 或聊天中。
5. 维护者确认 Cloudflare 账号及部署配置后，用自己的 Wrangler 部署此目录，将前端免费服务地址指向 Worker 地址；也可通过自己的站点网关将 `/api/ai-search/*` 转发到此 Worker。不要将 Durable Object 暴露为独立公共接口。

示例操作（由维护者执行，secret 命令交互输入密钥）：

```powershell
cd H:\Code\ugc-web\ugc-tools
pnpm install --frozen-lockfile
cd tools/ai-search-service
if (-not (Test-Path -LiteralPath wrangler.toml)) {
  Copy-Item -LiteralPath wrangler.example.toml -Destination wrangler.toml
}
npx wrangler login
npx wrangler secret put UPSTREAM_API_KEY
npx wrangler secret put VISITOR_HASH_SECRET
npx wrangler deploy
```

额度由 `GUEST_DAILY_LIMIT` 和 `MONTHLY_BUDGET_CNY` 配置：当前主配置为匿名访客每日 10 次、全站月预算 50 元，两个示例为每日 5 次、每月 50 元，均按 Asia/Shanghai 的日/月零点重置。匿名访客按 Cloudflare 提供的 IP 加服务端 secret 哈希识别；同一网络共享额度，换网络可能获得另一份额度。它不是登录账号限额，CORS 也不是身份验证。需要更严格的抗滥用能力时，应在 Worker 前增加实际账号验证或挑战验证；全站预算仍由服务端控制。

## 资产目录与检索

基础资源与 AI 特征分别保存。两个播放器的 `data.json` 逐字节恢复到生成 AI 特征前的备份，继续提供 ID、名称、媒体路径、时长与分类。每个播放器各有 `features.json` 保存 AI 生成记录、翻译引用与预编译索引；描述和关键词的五语实际文本追加到该播放器的 `i18n/<locale>.json`，与原名称和界面翻译并存。资产浏览页与 AI 搜索读取同一套文件：

```text
ugc-tool-data/
  SoundEffectPlayer/
    data.json
    i18n/zh-cn.json … 五语基础翻译与搜索描述
    features.json
  EffectPlayer/
    data.json
    i18n/zh-cn.json … 五语基础翻译与搜索描述
    features.json
  BgmPlayer/
    data.json
    i18n/zh-cn.json … 五语基础翻译与搜索描述
    features.json
```

每份磁盘 `features.json` 使用 `schemaVersion: 1` 与 `i18nSource: "project-i18n-v1"`，`resources[id].searchMetadata` 保留原生成记录和翻译引用，不再内嵌 `i18n` 文本字典。五語描述、关键词、用途、可能来源与不确定信息放在对应项目语言文件的 `<namespace>.search.*` 键中。解析时从五份语言文件提取这些键，归一化成运行时字典；普通名称和界面键不会作为描述证据。旧版内嵌字典仅作为兼容输入支持。特效的 `standVisual`、`tailVisual` 和 `audio` 分开归一化：画面描述不能证明音轨听感；用途单独作为建议；可能来源与不确定信息保留在文件内，不作为已经确认的特征。BGM 同样读取 BgmPlayer/features.json 和五语字典，searchMetadata.audio 映射音乐特征与独立用途建议。原名称、专辑和媒体资料仍来自基础目录。

`scripts/export-ai-asset-features.cjs` 生成本地恢复与上传包，`scripts/build-ai-asset-catalog.cjs` 从基础文件和特征文件生成可重建的离线目录。`generated/asset-identities.json` 只保存基础身份资料，随 Worker 部署；`generated/asset-catalog.json` 是离线检索／向量准备产物，生产 Worker 不再静态导入这份全量描述。特征 JSON 里的预编译词法索引由脚本生成，不能把它当作另一份手工维护的描述。

```powershell
# 使用本机 exports/ugc-tool-data 恢复包；不会调用模型。
node scripts/build-ai-asset-catalog.cjs
# 也可指定含三个播放器基础资料和三份 features.json 的本地目录。
node scripts/build-ai-asset-catalog.cjs --base "本机资料目录"
```

Worker 的三个 Wrangler 配置均提供以下公开地址；只能由维护者修改，不接受聊天请求指定来源：

```toml
ASSET_FEATURES_BASE_URL = "https://oss.xiaomol444.xyz/ugc-tool-data"
```

生产检索由已有 `SEARCH_LEDGER` Durable Object 执行，普通 Worker 负责入口校验和转发；目录查询和关键词检索不预留聊天模型预算，也不扣聊天次数；启用混合检索时，额外的 embedding 调用仍使用原有费用与额度保护。这样大文件解析与检索在 Durable Object 内进行。Cloudflare 普通 Workers Free 每次 HTTP 请求只有 10 ms CPU，Durable Objects 默认有 30 秒 CPU；等待下载不计入 CPU，两者仍受内存约束。[Workers 限额](https://developers.cloudflare.com/workers/platform/limits/)、[Durable Objects 限额](https://developers.cloudflare.com/durable-objects/platform/limits/)

Worker 在有检索请求时检查三个播放器的 `features.json` 和各自五份 `i18n/<locale>.json`，共 18 条固定路径，最多每 60 秒检查一次。ETag 用于逐文件条件请求；每个播放器的来源 hash 由一份 features 和五份翻译文件原始字节的 SHA-256 组合生成。即使 features 本身没有变化，任一语言文件变化也会触发验证与目录更新。全部 304 或组合 hash 不变时继续使用当前目录对象与缓存。若只有部分文件返回 304，而同项目其他文件有变化，会重新读取需要的 304 文件以校验完整资料；不长期缓存另一套完整源 JSON。没有访问时不运行后台计时器。缓存保存在当前运行实例内；实例回收后会重新读取特征文件，不是数据库里的永久内存缓存。成功校验三类特征及各自五语字典后整体切换目录，每轮模型工具调用固定使用同一份目录快照。缓存到期而已有 AI／语义检索正在使用快照时，先继续使用该目录，待进行中的调用完成再刷新；新模型请求等待旧快照释放，避免长时间同时保存两份完整目录。

首次加载失败时停止检索并返回 503；有成功目录后刷新失败则继续使用上次版本，返回 `featureSync.status="stale"`，页面显示提示。文件必须与基础目录的 `baseIndexVersion` 对应，五语引用完整、ID 合法，且预编译索引对应当前特征内容。 现有 BGM 特征包绑定部署时的基础快照；该快照与当前 BGM 发布目录的名称附加字段和分类文本不同。需要重建离线目录但保留现有特征版本时，通过 `--bgm-base` 指向原基础快照目录，`--base`／`--features-base` 使用当前特征包目录。不要为了本次接入覆盖现有轻量身份目录或手动修改 `baseIndexVersion`。手动编辑对应语言文件的搜索描述后须用脚本重编译该播放器的 features，不能修改文本却保留旧索引。`--reindex <Player>/features.json` 自动读取同目录下五份 i18n 后更新索引，输出 features 仍不含字典副本。更新基础 ID、名称等资源资料时仍须重新构建并部署轻量身份目录；修改现有资源的特征文件则不需要重新部署 Worker。

`/catalog`、`/search`、`/assets` 与免费 Agent 使用同一目录加载规则。响应的 `featureSync` 提供 `status`、sound、effect、bgm 三份来源 `hashes` 和检查时间；`catalogVersion` 随特征版本变化。前端检测新版本后提示资料已更新，保留聊天存档。旧分页游标返回 409 `CATALOG_VERSION_MISMATCH`，页面刷新目录并让用户重新发送，不自动重复调用计费模型。未设置 `ASSET_FEATURES_BASE_URL` 的离线测试可使用注入目录；此时状态为 `disabled`，不代表线上特征已经加载。

本轮的恢复包在项目根目录 `exports/ugc-tool-data`，源备份与 SHA-256 校对报告另存。先上传三份 `features.json` 与配套五语字典及所需基础资料，再部署 Worker 并发布前端。R: 是 R2 挂载视图，本次没有尝试强行改写挂载，也没有上传或部署；操作顺序见恢复包的 `UPLOAD.md`。

默认 `RETRIEVAL_MODE="keyword"`，使用倒排索引、关键词权重与少量多语言同义词规则检索。检索只返回短摘要，可通过游标读取下一页，再按选中的 ID 获取详情。音效搜索可包含特效音轨，但只有明确带音轨且已有声音描述的特效进入声音候选；特效视觉描述不能证明声音存在。用途建议和实际特征分开检索与标记。返回候选有上限，关键词或语义检索都不能保证涵盖所有符合描述的资产。

## 特征文件迁移验证

上传包的 SHA-256 清单在 `exports/ai-asset-feature-export-manifest.json`。两个 data 保留原备份字节；十份 i18n 保留原有全部键和值，仅恢复 AI 搜索文本的追加内容，不能称为原 i18n 文件逐字节还原。本次离线验证涵盖基础资源与原翻译保持不变、外部五语引用、声音／视觉／用途隔离、分块摘要、12 文件组合 hash、哈希不变复用、版本切换及失败保留。

```powershell
node --test tools/ai-search-service/asset-features.test.mjs tools/ai-search-service/asset-json-stream.test.mjs tools/ai-search-service/asset-catalog-loader.test.mjs tools/ai-search-service/asset-search.test.mjs tools/ai-search-service/worker.test.mjs
node scripts/test-ai-search-feature-sync.cjs
npm run type-check
npm run build
```

真实目录运行时回归为 `tools/ai-search-service/asset-catalog.runtime.test.mjs`，需要先准备本机三类特征包，并设置 `MINIFLARE_MODULE_PATH` 指向已安装的 Miniflare 模块。可通过 `MINIFLARE_WORKERD_V8_FLAGS="--max-old-space-size=96 --max-semi-space-size=4"` 验证较低堆限制；执行 `node --test tools/ai-search-service/asset-catalog.runtime.test.mjs`。测试使用完整本机资料和合成上游，验证进行中的快照、三类文件更新、ETag、并发刷新、旧游标以及 stale；不查询真实余额或调用真实模型。

2026-10-09 的 BGM 接入验证使用当前完整三源特征与十五份语言文件，共 18 份资料、5,378 条身份，其中 188 首 BGM 均有五语描述和用途。实际 workerd 在 112 MiB old-space、4 MiB semi-space 下通过冷加载、120 次五语用途查询、并发刷新、旧快照与失败回退；冷加载约 4.33 秒、更新约 4.35 秒，采样堆与 backing storage 合计峰值约 106.4 MiB。验证记录在 `H:/Code/ugc-web/ugc-ai-search-file/experiments/bgm-worker-integration-20261009/verification.json`。实现使用流式 UTF-8／JSON 解析与 SHA-256、分块内部校验、按需词法分面和快照 pin；没有每轮重新构建全库索引。本机采样不能保证捕获每个瞬时内存峰，也不能代替 Cloudflare 线上实际限制和监控，线上指标仍需部署后确认。

## 接口

下列路径前缀为 `/api/ai-search`。已配置 Worker 地址时，网页使用服务端目录、检索和详情；服务不可用会显示错误，避免悄悄换到另一版本的本地目录。来源校验适用于公开 HTTP 和 MCP 接口。

`GET /catalog` 不调用模型，返回 `catalogVersion/indexVersion`、资产数量、语言、描述覆盖率、当前配置的 `mode`，以及 `limits: {maxResults: 50, defaultResults: 10, maxPreviousIds: 50, maxExcludeIds: 50, maxSearchLimit: 50, maxAssetIds: 10}`。这里的模式表示服务配置；每次 `/search` 返回的 `mode` 才表示该次实际使用的检索方式。

`POST /search`，`Content-Type: application/json`：

```json
{
  "query": "短促的金属撞击音",
  "scope": "sound",
  "matchOn": "audio",
  "locale": "zh-CN",
  "includeEffectAudio": true,
  "limit": 20,
  "previousIds": [],
  "previousQuery": "",
  "excludeIds": []
}
```

`query` 与可选 `previousQuery` 各最多 2000 字符；`scope` 为 `all/sound/effect/bgm`，`locale` 为 `zh-CN/zh-TW/en-US/ja-JP/ru-RU`（兼容 `zh/en/ja/ru`）。`limit` 为 1–50（默认 10），`previousIds` 和 `excludeIds` 各最多 50 个格式合法的资源 ID；已从当前目录删除的历史 ID 会被忽略。追问时前端从历史提取最近明确的搜索主题与相关 ID 给检索，不把整段聊天发给检索接口；服务不会凭空拥有未提交的对话。可选 `searchType` 为 `feature/suggestion/both`，`filters` 支持时长区间、是否有音轨、循环、包含/排除词。

检索请求和 `search_assets` 工具参数使用顶层 `matchOn: "any" | "visual" | "audio"`，默认 `any`，不能放入 `filters`。`scope` 决定返回的资产范围，`matchOn` 决定使用哪种特征证据，二者分别生效。

默认 `matchOn=any` 可省略；旧 Worker 的 `/search` 拒绝声音／视觉匹配参数时，前端会提示更新 Worker，不静默降级为混合检索。

| 请求示例 | scope | matchOn | 证据与结果 |
|---|---|---|---|
| 爆炸特效 | effect | visual | 按画面描述、视觉关键词及可用名称资料找特效 |
| 爆炸音效 | sound | audio | 按声音找音效；开启包含特效音轨时可扩展到特效的声音分面 |
| 特效里的爆炸音效／带爆炸音效的特效 | effect | audio | 加 `filters.hasAudio=true`，只按该特效自身的声音证据找特效 |

最后一种请求不能用普通音效替代，也不能凭视觉“爆炸”名称认定音轨是爆炸声。`hasAudio=true` 只证明该特效有音轨。`includeEffectAudio` 仅控制 `scope=sound` 时是否扩展到特效音轨；明确 `scope=effect, matchOn=audio` 时不受该开关的旧隐藏 false 值影响。

`excludeIds` 最多 50 个格式合法的资源 ID，关键词和向量结果都会排除它们，分页游标也绑定该列表。基础搜索遇到“再来点”等追问会继承上一主题并排除上一批卡片；模型工具流程会根据提交的上下文改写查询并排除旧结果。

新版 `/catalog` 与 `/config` 通过 `limits.maxExcludeIds` 声明排除上限。旧 Worker 未声明该能力时，网页按旧版最多 30 个 `excludeIds` 的边界提交请求，同时在本地过滤完整的上一批卡片 ID；候选不足时继续读取同一搜索的 `nextCursor`，补充未展示的候选。这样即使上一批有 50 张卡片，也能兼容旧服务的排除边界，且不会把旧卡片重新交给模型或展示。

HTTP 响应含 `items`、`catalogVersion`、`mode`、`effectiveScope`、`total`、`nextCursor` 和 `hasMore`，不重复序列化 `candidates` 数组。每项含 `resourceId/title/kind/description/descriptionLocale/href/matchType` 等短摘要，描述最多 220 字符。`total` 是当前有界候选池数量。下一页在同样查询条件上加 `cursor=nextCursor`；游标绑定目录版本与查询条件，不能换一个问题继续用。索引更新后重新发起搜索。

音乐查询无匹配，且整个 BGM 目录缺少描述和风格关键词时，响应附带 `retrievalNotice: {code: "MUSIC_DESCRIPTION_MISSING"}`。基础搜索直接说明目前只能按曲名、专辑等搜索。模型工具流程先收到这个信息，仍可换词搜索；仅依据名称推荐时必须说明依据有限，不能编造曲目的节奏、情绪或声学特征。

针对特效音轨的搜索，在全库此类声音描述均缺失时，响应附带 `retrievalNotice: {code: "EFFECT_AUDIO_DESCRIPTION_MISSING"}`。前端提示目前不能确认所需声音，可先按特效名称搜索并在资产页试听。这表示声音特征资料不足，不表示所有特效都没有音轨，也不表示所需资源一定不存在；部分描述已存在而本次未匹配时，不使用这个全库缺描述提示。

`POST /assets` 读取选中资源的详细资料：

```json
{ "ids": ["sound:124", "effect:20001"], "locale": "zh-CN" }
```

一次最多 10 个 ID，HTTP 仅序列化 `items`，另含 `missingIds` 和 `catalogVersion`，不重复附加 `assets` 数组。详情包含描述及其语言、特效声音描述、关键词、用途建议和真实资产页的相对 `href`。`get_assets` 将特效的 `visualDescription` 与 `audioDescription` 分开、有界提供，缺少声音描述时保留缺失状态，不把视觉全文当作声音证据。未知 ID 放入 `missingIds`，不造资源；详情 JSON 超过 30 KB 会返回 `DETAILS_TOO_LARGE`，应减少单批 ID 数。

`GET /api/ai-search/config` 无聊天模型调用，返回服务器状态和当前匿名访客剩余次数；官方 DeepSeek 还检查最多缓存 30 秒的余额状态。下面按当前主配置举例：

```json
{
  "configured": true,
  "available": true,
  "model": "configured-model-id",
  "models": [{ "id": "configured-model-id", "name": "网站免费模型", "free": true }],
  "quota": { "remaining": 10, "limit": 10, "resetAt": "2026-10-08T16:00:00.000Z" },
  "limits": { "maxCandidates": 50, "maxMessages": 12, "maxQueryLength": 2000, "maxResults": 50, "defaultResults": 10, "maxPreviousIds": 50, "maxExcludeIds": 50, "maxSearchLimit": 50, "maxAssetIds": 10, "minBalanceCny": 20 },
  "agent": { "available": true, "maxModelRounds": 3, "maxToolCalls": 4, "timeoutMs": 55000 }
}
```

没有配置、今日次数用完、月预算用完或官方 DeepSeek 余额保护拦截时，`available` 为 false，并提供 `error: {code, message}`。`limits.minBalanceCny` 只表示有效的保护阈值，不是账户实际余额。config 不能保证下一次请求一定获准：其他访客可能同时消耗预算或上游余额，POST 必须重新查询余额并原子检查本地额度。

`agent.available` 表示服务支持新版协议，不代表免费模型已配置或上游已验证。新版网页在该字段为 true 时直接提交模型工具请求，不提前搜索候选；旧服务未声明它时，网页沿用兼容协议。

网页可选择常用的 5、10 或 20 个结果，也可自定义 1 至 50 的整数，默认选择 10；`/chat` 通过 `resultLimit` 传递本轮上限。未携带该字段时默认最多返回 10 个；显式传入旧的 5／10／20 档仍有效。是否支持更多结果以 `/config` 的 `limits.maxResults` 为准；旧 Worker 未声明能力时，应先更新并重新部署 Worker，前端不能只改变显示数量来解除服务端限制。无免费模型配置的 `/config` 也会声明这些协议能力；它们不代表免费额度可用。

`POST /api/ai-search/chat`，`Content-Type: application/json`：

新版请求不携带候选表：

```json
{
  "workflow": "agent",
  "requestId": "3f9049ca-3086-49aa-a707-788401f373f8",
  "query": "再来点",
  "locale": "zh-CN",
  "scope": "all",
  "matchOn": "any",
  "includeEffectAudio": true,
  "resultLimit": 10,
  "messages": [
    { "role": "user", "content": "来点爆炸特效" },
    { "role": "assistant", "content": "找到爆炸特效。Previous results: effect:10007150" }
  ],
  "previousIds": ["effect:10007150"]
}
```

网页提交最近最多 4 对成功问答（8 条文本），失败或取消的问答不进入上下文，可见历史照常保留。当前问题优先，模型判断是否沿用历史，不依靠网页先猜关键词。`scope=all` 允许模型主动缩小资产类型；明确选择的音效、特效或 BGM 范围不能被模型扩大。模型在 `search_assets` 中选择 `matchOn`，区分“找特效里的声音”与“找视觉特效”；声音搜索只能依据该资源的真实声音证据，视觉特效标题不能证明音轨特征。新版仍是先调用聊天模型，由模型提出工具请求，再由执行器访问资料库。

新版与旧候选 `/chat` 都接受外层可选 `matchOn`，省略时默认 `any`。默认网页 Agent 保持外层 `any`，由模型在工具参数中选择声音或视觉特征，不根据轻量关键词推断强行固定外层意图。

Worker 以 function calling 暴露 `search_assets`、`get_assets`、`get_asset_catalog`，执行器使用与 MCP 相同的检索函数。模型每次拿到最多 50 条摘要；搜索批次默认取本轮结果上限和 10 中的较大值。摘要过长时在原有 30 KB 模型消息预算内缩短描述、名称和可选关键词／用途，保留全部可信 ID、声音匹配状态和特征／用途标记，不通过增加上下文预算容纳更多卡片。详情工具每次仍最多 5 项，只读取必要证据，无须为了显示更多卡片逐条读取完整详情。每个问题最多 3 轮模型请求、4 次工具调用，整轮最多 55 秒，最后一轮强制结束工具调用并输出 JSON。它可以先查“激昂音乐”，结果为空后改查“战斗”，也可以带游标读取下一批；描述缺失仍会限制结果可靠性。完整工具回合计为 1 次访客免费额度，预算先按最多 3 轮预留，成功后汇总实际 usage 结算。

以下是仍保留的旧候选筛选协议：

```json
{
  "requestId": "3f9049ca-3086-49aa-a707-788401f373f8",
  "query": "比上一个短一些的金属撞击音",
  "locale": "zh-cn",
  "scope": "sound",
  "messages": [
    { "role": "user", "content": "找金属撞击声音" },
    { "role": "assistant", "content": "推荐 sound:123，持续 4 秒。" }
  ],
  "includeEffectAudio": true,
  "catalogVersion": "从 /catalog 或 /search 获取的当前版本",
  "candidateIds": ["sound:124"]
}
```

旧协议的 `scope` 支持 `all/sound/effect/bgm`；`locale` 支持项目现有 `zh-CN/zh-TW/en-US/ja-JP/ru-RU`，兼容 `zh-cn/zh-tw/en/ja/ru`。历史仅支持 `user/assistant`；网页仅在明确追问时发送当前主题的成功问答对，最多 8 条且每条不超过 2000 字符。新主题不带旧问题，失败或取消的问答不进入模型上下文；可见聊天记录照常保留。上一轮选中的资源 ID、时长等必要信息进入助手历史文本，候选检索也结合追问上下文，模型不能记住未发送的消息。默认最多 50 个候选；维护者仍可用 `MAX_CANDIDATES` 设置更低上限。Worker 按 ID 从当前目录重新读取描述，校验资产存在、目录版本和搜索范围；浏览器提交的描述不成为模型事实来源。发送给聊天模型的描述截取最多 600 字符，关键词最多 12 个，用途建议最多 3 项。整个提交体最多 160 KB，构造后的模型消息最多 30 KB。

旧协议直接调用 `/chat` 但候选为空时，Worker 返回本地空结果说明，不调用上游、不扣访客次数或模型预算，且不伪造模型 usage。新版 `workflow: "agent"` 始终先调用模型，不受旧候选门槛限制。

成功：

```json
{
  "answer": "这条更短，具有明显的金属振铃。",
  "matches": [{ "resourceId": "sound:124", "reason": "时长较短，撞击后带轻微振铃", "matchType": "feature" }],
  "resources": [{ "resourceId": "sound:124", "id": "124", "kind": "sound", "title": "金属撞击", "href": "/SoundEffectPlayer?id=124" }],
  "catalogVersion": "当前打包索引版本",
  "quota": { "remaining": 9, "limit": 10, "resetAt": "2026-10-08T16:00:00.000Z" },
  "model": "configured-model-id",
  "requestId": "3f9049ca-3086-49aa-a707-788401f373f8"
}
```

`matches` 允许为空，最多为本轮 `resultLimit` 指定的 1 至 50 项；相关资源不足时不会凑数。服务验证 ID 只来自本次已核对的目录候选、无重复，`matchType` 为 `feature` 或 `suggestion`；模型不能生成资源 URL。`resources` 由服务端目录读取，只包含卡片需要的可信摘要和元数据，每项 JSON 最多约 3.4 KB；结果较多且回答较长时进一步缩短摘要，使卡片与回答合计控制在约 110 KB，给浏览器存档和账本记录留出空间。描述最多 600 字符，关键词最多 6 个，用途建议最多 3 项；元数据过长时先减少用途建议和关键词，保留资源 ID 与描述。特效音轨匹配通过 `audioDescription/audioKeywords/audioSuggestedUses` 提供声音资料，不重复传输视觉全文。完整详情仍可由 `/assets` 单独读取。前端按这些资料显示卡片并通过真实相对 `href` 跳转资产页。上面的资源详情为了示意省略了描述等字段，ID 和版本也仅为格式示例。实际匹配仍需前往资产页核对效果。

工具模式成功响应还包含 `agent.steps/rounds`；至少成功执行一次搜索时，顶层 `mode` 表示最后一次搜索实际使用的 `keyword/hybrid`。网页据此更新检索状态，不能把 `/catalog` 中配置的 hybrid 模式当作本轮确实使用了向量检索。

错误响应为 `{ "error": { "code": "...", "message": "..." }, "quota": { ... } }`，quota 在身份或请求尚未验证时可缺少。

工具模式和旧候选协议在收到模型正文、但 JSON 解析、可信资源 ID／结果校验失败或生成未完成时，原有 `UPSTREAM_RESPONSE_INVALID` 错误会额外包含可选字符串 `error.rawResponse`。该字段只取模型 `message.content/refusal`，最多 16 KiB（UTF-8），保留完整字符和换行；已知服务端 Key 与访客哈希 secret 若意外出现在正文中会被遮去。网页将其作为纯文本显示，不能执行其中的 HTML 或链接。网络／HTTP 失败、上游整包 JSON 无法解析、没有正文或仅有工具数据时不提供此字段；它不包含上游对象、headers、推理过程、工具中间结果或异常的 `response` 属性。相同 requestId 的失败重试复用原有安全缓存，不增加模型调用、额度或费用预留。

常见机器码：

| HTTP | code | 含义 |
|---|---|---|
| 400 / 413 | INVALID_REQUEST / INVALID_JSON / PAYLOAD_TOO_LARGE / PROMPT_TOO_LARGE | 请求不符合格式或长度限制 |
| 403 | ORIGIN_NOT_ALLOWED / FORBIDDEN | 来源或内部访问格式不正确 |
| 409 | REQUEST_IN_PROGRESS | 同一请求仍处理中，稍后带同一 requestId 重试 |
| 409 | REQUEST_ID_CONFLICT | 同一 requestId 被用于不同内容 |
| 409 | CATALOG_VERSION_MISMATCH | 页面使用的目录版本已过期，重新检索 |
| 400 | UNKNOWN_ASSET / ASSET_SCOPE_MISMATCH | 候选不在目录中或与搜索范围不符 |
| 429 | FREE_QUOTA_EXHAUSTED / FREE_SERVICE_BUSY | 今日额度用完或并发已满 |
| 503 | FREE_SERVICE_NOT_CONFIGURED / FREE_BUDGET_EXHAUSTED | 免费服务未配置或全站月预算不足 |
| 503 | PROVIDER_BALANCE_LOW / PROVIDER_BALANCE_UNAVAILABLE | 官方 DeepSeek 余额低于保护阈值／不可用于 API，或余额查询不可用 |
| 502 / 503 | UPSTREAM_REJECTED / UPSTREAM_RESPONSE_INVALID / UPSTREAM_TIMEOUT / UPSTREAM_UNAVAILABLE | 上游不可用或返回内容无效 |
| 502 | TOOLS_UNSUPPORTED / TOOL_ARGUMENTS / AGENT_LIMIT | 上游不支持工具调用、工具参数无效或超出工具轮次限制 |

## 预算、重试与保留

每次调用前按输入消息的 UTF-8 字节数作为宽松 token 估计，加允许输出的最高 token 数，再按已配置单价和安全系数预留开销。原子事务保证多个访客不会同时穿透本地预留预算；服务器不会使用浏览器提交的次数或费用。只有完整成功响应且 usage 落在预留边界内，才释放多余预留；没有可信 usage、超时、网络错误或格式错误都保留整份预留。**这些金额是保守预算账，不是上游真实账单**，不包含 Cloudflare、Vectorize、带宽、存储费用，也不包含维护者在本机批量生成文档向量的费用。聊天 API 和 embedding API 分别由各自提供商计费，不能把聊天单价当成向量单价。预算保障依赖正确单价与所用上游的通常 UTF-8 tokenizer 计数；上游账号自己的硬支出限制可以提供独立保护。

单轮输出预算随结果上限变化：1–5 项最多 800 tokens、6–10 项最多 1400 tokens、11–20 项最多 2400 tokens；21–50 项按 `2400 + (resultLimit - 20) × 100` 设置，50 项最多 5400 tokens，并受配置 `MAX_OUTPUT_TOKENS` 的较低上限约束。当前默认配置上限为 5400；升级已有部署时请同步将 `MAX_CANDIDATES` 调整到 50，并检查 `MAX_OUTPUT_TOKENS`，旧配置 2400 可能不足以生成 50 项完整 JSON。同一个有效输出上限用于实际模型请求、最多 3 轮的原子预算预留和最终汇总 usage 校验；增加结果数量会增加实际输入、输出 tokens，但不会增加每日免费计次。请求数量不受支持时在扣费前拒绝。

获准调用即消耗一次日额度，上游失败也可能已经计费，因此不会自动退回次数。网络超时后应使用**同一 requestId、完全相同内容**重试；服务会返回已保存结果或处理状态，不再次调用模型。不要生成新 ID 自动重试。幂等结果保留至少 48 小时，之后按定时任务分批清理；超过保留期的 ID 不再保证幂等。日计数保留至少 7 天，预算记录约保留 13 个月。服务器不保存原始 IP、API Key、请求提示词或候选原文，只保存匿名哈希、内容摘要、计数、费用预留与短期响应结果；回复可能含用户问题中的文字。

实现使用 SQLite-backed Durable Object 的异步 KV 与事务 API，清理时遵守多键删除的 128 项限制，并按页扫描。[Cloudflare 存储 API](https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/)、[Alarm API](https://developers.cloudflare.com/durable-objects/api/alarms/)

## 可选语义检索与向量准备

关键词检索默认启用；只增加 Vectorize 绑定不会开启付费查询。`RETRIEVAL_MODE="hybrid"` 必须同时具备 `ASSET_VECTORIZE`、对应模型与维度的已上传向量、独立 `EMBEDDING_API_KEY`、有效 embedding 地址、正数 `EMBEDDING_CNY_PER_MILLION` 以及账本/访客哈希配置。示例故意把 embedding 单价设为 `0`，维护者应核对自己地区和服务商的实际人民币价格后填写。真实查询把关键词候选与语义候选融合；向量查询失败时该次返回关键词模式及 `retrievalWarning`，不假称成功使用向量。

准备脚本固定使用百炼北京 `text-embedding-v4`、1024 维稠密向量。文档使用 `text_type="document"`，运行时查询使用 `text_type="query"`；同一索引的提供商、模型和维度必须一致。只为 `feature` 和明确的特效 `audio` 分面创建向量：视觉和音轨独立，用途建议不混入实际特征向量。百炼 v4 每批最多 10 条，脚本另外限制每段 UTF-8 文本 8192 字节、每个请求 60000 字节；字节限制是保守工程上限，不是对 token 数的精确估算。[百炼 embedding API](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)

先在项目根目录运行计划检查，默认不会读取 Key、网络请求或写向量文件：

```powershell
node scripts/seed-ai-asset-vectors.mjs
node --test scripts/seed-ai-asset-vectors.test.mjs
```

批量生成会产生独立的 embedding 账单，**不经过线上 Worker 月预算账本**。维护者决定生成时，在自己的终端配置 `EMBEDDING_API_KEY` 或 `DASHSCOPE_API_KEY` 后执行下列命令；脚本只从进程环境取得这两个变量之一，不读 `.env`、系统注册表、聊天 Key，也不接受命令行 Key 参数。`--endpoint` 仅允许北京百炼原生 embedding 地址（旧兼容地址或自己的北京工作空间地址）。以下为操作说明，本次开发未执行：

```powershell
node scripts/seed-ai-asset-vectors.mjs --execute
```

输出保存在忽略的 `tools/ai-search-service/.vector-seed/`：成功批次立即缓存；中断后重跑复用已有 embedding，不自动重试计费结果不确定的请求。`cache/` 按提供商、模型、维度、文本摘要缓存向量；每个目录版本另有 NDJSON 文件和 manifest。manifest 标明提供商、模型、维度、namespace、请求数和成功响应中的 token 用量，不推断总货币费用。默认每个 NDJSON 最多 1000 条。NDJSON 不包含 Key 或原始描述，metadata 含真实资源 ID、kind、facet、hasAudio、模型/维度及版本。

Vectorize namespace 使用完整 `catalog.indexVersion`；向量 ID 是目录版本、资源 ID、分面的 SHA-256，避免新版本 upsert 把旧部署的向量移走。查询同时限定 namespace，并检查返回的真实 ID、分面、模型/维度和目录版本。更新资产后重建目录并生成新 namespace，部署的 JSON 与上传的 namespace 必须对应；旧 namespace 不会参与新版本查询。**更换 embedding 提供商、模型或维度时，创建新的 Vectorize index_name 并完整重新生成**，避免同维度向量空间混用。

以下 Cloudflare 操作仅由维护者在确认后手动执行。先创建余弦索引及 metadata indexes，再上传；metadata indexes 建立前已有向量不会自动补齐可过滤属性。[Vectorize 配置和客户端 API](https://developers.cloudflare.com/vectorize/reference/client-api/)、[Wrangler 命令](https://developers.cloudflare.com/vectorize/reference/wrangler-commands/)

```powershell
cd tools/ai-search-service
npx wrangler vectorize create ugc-assets-v4-1024 --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index ugc-assets-v4-1024 --propertyName=kind --type=string
npx wrangler vectorize create-metadata-index ugc-assets-v4-1024 --propertyName=facet --type=string
npx wrangler vectorize create-metadata-index ugc-assets-v4-1024 --propertyName=hasAudio --type=boolean
npx wrangler vectorize create-metadata-index ugc-assets-v4-1024 --propertyName=model --type=string
npx wrangler vectorize create-metadata-index ugc-assets-v4-1024 --propertyName=dimensions --type=number
# 把版本占位符换成 manifest 中的 namespace；逐个上传该版本的所有 NDJSON 文件。
npx wrangler vectorize upsert ugc-assets-v4-1024 --file=".vector-seed/目录版本/vectors-0001.ndjson"
npx wrangler secret put EMBEDDING_API_KEY
```

在自己的 Wrangler 配置启用示例末尾的 `[[vectorize]]` 绑定 `ASSET_VECTORIZE`，并将 `RETRIEVAL_MODE` 改为 `hybrid`、embedding 单价改为核对后的正数，再由维护者部署。向量写入需要异步生效；应核对 manifest、Cloudflare 索引信息及真实查询结果，不能仅凭上传命令退出成功就认为检索已就绪。[向量写入说明](https://developers.cloudflare.com/vectorize/best-practices/insert-vectors/)

线上查询 embedding 的默认额度是每个匿名访客每日 20 次缓存未命中，和聊天额度（主配置每日 10 次、示例每日 5 次）分别计数；相同文本、服务地址、模型和维度的查询向量缓存 24 小时，命中缓存不再次请求 embedding。查询 embedding 与聊天共同使用默认全站每月 50 元的保守预算，任一项失败可能仍消耗预留。维护者本机批量 embedding、Cloudflare 与 Vectorize 自身费用仍由各平台单独计费，不在这 50 元账本内。默认关键词模式不会发起 embedding API 请求。

## MCP 接口

`POST /mcp`（也可 `/api/ai-search/mcp`）提供无会话的 Streamable HTTP JSON-RPC 子集：`initialize`、`ping`、`tools/list`、`tools/call` 和通知接受响应。工具包括 `search_assets`、`get_assets`、`get_asset_catalog`，分别使用上述同一份服务端检索、详情和目录逻辑；工具输出同时有有界 JSON 文本与 `structuredContent`。不提供 SSE、批量 JSON-RPC、resources、prompts 或主动通知流，不能据此假定所有 MCP 客户端扩展功能都受支持。

MCP 查询不调用本站聊天模型，不需要把 DeepSeek Key 交给 MCP 客户端；关键词模式也不请求 embedding。启用 hybrid 后搜索工具会使用受限额保护的 query embedding。连接它的外部 AI 模型仍可能按工具结果占用的上下文 tokens 计费，所以“检索端没有聊天调用”不代表用户的整次 AI 对话免费。

普通 Chat Completions API 返回工具调用指令，不会替网站自动执行 MCP 请求。本站免费流程由 Worker 执行这些指令；自有模型由浏览器执行器调用 `/search`、`/assets`、`/catalog`，均共用 MCP 的检索资料和规则。外部支持 MCP 的客户端可直接连接上述 MCP 地址。[DeepSeek 工具调用流程](https://api-docs.deepseek.com/guides/tool_calls/)

## 本地验证

先在项目根目录安装依赖（见“模型返回格式修复”），再在本目录用 Node 20+ 执行：

```powershell
node --test worker.test.mjs
node --test asset-search.test.mjs
node --test agent-runtime.test.mjs
node --test model-response.test.mjs
node --test system-prompt.test.mjs
# 可选：需要 Miniflare，检查真实 workerd fetch 的提示词读取兼容性。
node --test system-prompt.runtime.test.mjs
node --test provider-balance.test.mjs
# 可选：需要 Miniflare，检查真实 workerd fetch 的运行时兼容性。
node --test provider-balance.runtime.test.mjs
# 从 tools/ai-search-service 回到项目根目录：
cd ../..
node --test scripts/seed-ai-asset-vectors.test.mjs
node scripts/seed-ai-asset-vectors.mjs
```

测试使用模拟存储和模拟上游，不读取本机 API Key、不部署、不发生付费 API 调用。向量脚本末条是默认 dry-run，不生成或上传向量。2026-10-08 本地部署 dry-run 的打包 gzip 大小约 2366 KiB；真实目录查询的 20 项摘要 HTTP 响应约 7.1 KB（UTF-8 字节）。这些是传输/打包体积，不等于实际模型 token 数或调用费用。数量扩展回归覆盖 1、6、10、20、21、33、50 项合法请求、超出 50 项／小数／未知／重复 ID 拒绝、50 项追问排除与 MCP 输入、50 项两页覆盖 100 项候选池，以及每轮输出上限和全轮费用预留。长摘要回归验证在原输入预算内保留所有声音证据与可信 ID、50 项卡片可写入有界账本存档。余额回归覆盖严格的 20 元边界、每次聊天实时核实与配置缓存隔离，以及超时停用。真实 Key 是否有效、供应商账单、Vectorize 上传效果需要维护者另行验证。

`matchOn` 协议与特效音轨缺描述提示需要重新部署 Worker，并重新构建、发布前端。旧线上 `/search` 不支持该参数，不能仅更新本地页面就宣称线上已修复。此次修正未生成或补充特效声音描述、未调用 Qwen，也未部署。
