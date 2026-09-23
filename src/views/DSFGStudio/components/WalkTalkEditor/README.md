# 边走边说编辑器

在 DSFGStudio 的「编辑内容」下拉框选择「边走边说」。每个文件是一段有序台词，可新增、在任意一句后插入、上移、下移、删除。不使用 Group 节点、连线或 Timeline。

## 保存与导出

- 文件归属当前工作区，存储服务中的路径为 `/<工作区>/WalkTalkEditor/<文件名>.json`，不与对话文件或唯一任务配置混用。
- 自动保存编辑器数据；切换文件、编辑器和工作区前等待保存，保存失败不切换。文件删除使用存储服务的回收站。
- 编辑数据自动保存在工作区，`Ctrl+S`（或 `⌘S`）立即刷新保存队列，不下载编辑器 JSON。游戏变量仍通过「导出千星边走边说」下载。
- 「导出千星边走边说」使用 `miliastra-variable` 创建和序列化结构体，按页面从上到下顺序下载 `<文件名>-边走边说.json`。
- 普通 StructList 最多 100 项，因此每份文件最多 100 句；没有套用任务的字典分块。
- 数值输入保留为文本，允许尚未输完的草稿保存。导出才校验有效 Float、Int32 范围和列表数量；错误会指出台词序号与字段，不会下载不合法变量。

## 结构体来源与映射

来源为用户 `结构体导出/V2.0` 中的 `1077936168[消息]边走边说对话.json`、`1077936171[消息]边走边说对话列表结构体.json` 和 `NOLOC_测试边走边说变量.json`，快照位于 `src/assets/DSFGStudio/WalkTalk/`。

外层结构体 ID 为 **1077936171**，唯一字段 `datas` 是子节点列表；每个子节点 ID 为 **1077936168**。两者都能在「结构体 ID 设置」中调整。导出严格使用 `Struct → datas: StructList → Struct`，不包含样例中的空白占位台词。

| 顺序 | 字段 | 类型 | 新建默认值 |
| --- | --- | --- | --- |
| 1 | style | String | Default |
| 2 | talker | String | 空文本 |
| 3 | subtitle | String | 空文本 |
| 4 | content | String | 空文本 |
| 5 | continueDelay | Float | 0.00 |
| 6 | params | Int32List | 空列表 |

编辑器数据升级为 v2。读取 v1 文件时，原默认 ID 组合自动更新为新版，用户自定义 ID 保留；`prams` 迁移为 `params`。新版结构体没有 `autoContinue`，因此界面和变量导出移除此字段，旧值保留在编辑器数据的 `legacyAutoContinue` 中作为备份，不映射到其他时间字段。

样式使用工作区「预设设置 → 边走边说类型」的列表，系统内置 `Default`，新增和插入台词仍默认使用它，与节点对话的 `Default_UI` 独立。系统候选在 `systemPresetConfig.ts` 维护，上方只读展示；下方可以新增、编辑、删除自定义项。选项按系统在前、自定义在后合并。旧文件中的空值或不在当前预设内的样式显示为「旧值」，打开时不自动覆盖；选择其他预设后正常保存和导出。源结构体快照保持不变。

使用新定义中的 `params` 字段。整数参数支持逗号、空格或换行分隔，保持填写顺序和重复值，最多 100 项。推进延迟按新定义的 `continueDelay` 保存。

`walkTalkProject.ts` 负责编辑数据、列表操作与校验，`WalkTalkPanel.vue` 负责台词界面，`walkTalkExporter.ts` 负责结构体映射，`WalkTalkEditor.vue` 负责工作区文件、自动保存、下载与 ID 设置。

## 回归检查

运行 `node scripts/test-dsfg-walk-talk.cjs`、`node scripts/test-dsfg-walk-talk-integration.cjs`，以及 `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`。
