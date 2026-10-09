# AI 搜索文件位置

- AI 搜索的实验、一次性脚本、临时配置、模型评估记录、截图、日志、数据样本、导出包和验证构建产物统一保存到 `H:\Code\ugc-web\ugc-ai-search-file`。
- 新实验使用该目录下的 `experiments/<任务名称>`；浏览器截图使用 `verification/browser`，日志使用 `verification/logs`，发布数据使用 `exports`。
- 不在本仓库的 `experiments`、`.wrangler` 或其他临时目录新增上述 AI 搜索产物。执行构建、导出或验证前，显式设置输出路径，避免工具默认输出到本仓库。
- 网页及 Worker 运行源码、随项目维护的正式构建和回归脚本按现有 `src`、`tools/ai-search-service`、`scripts` 结构维护；这些脚本产生的临时产物遵循上述目录规则。
- 移动实验时修正源码依赖和可执行命令路径，保留历史 JSON、哈希收据和原始证据的字节内容。
