# 边走边说编辑器

在 DSFGStudio 的「编辑内容」下拉框选择「边走边说」。每个文件是一段有序台词，可新增、在任意一句后插入、上移、下移、删除。不使用 Group 节点、连线或 Timeline。

## 保存与导出

- 文件归属当前工作区，存储服务中的路径为 `/<工作区>/WalkTalkEditor/<文件名>.json`，不与对话文件或唯一任务配置混用。
- 自动保存编辑器数据；切换文件、编辑器和工作区前等待保存，保存失败不切换。文件删除使用存储服务的回收站。
- `Ctrl+S`（或 `⌘S`）/「下载编辑器 JSON」下载可继续编辑的数据，不是游戏变量。
- 「导出千星边走边说」使用 `miliastra-variable` 创建和序列化结构体，按页面从上到下顺序下载 `<文件名>-边走边说.json`。
- 普通 StructList 最多 100 项，因此每份文件最多 100 句；没有套用任务的字典分块。
- 数值输入保留为文本，允许尚未输完的草稿保存。导出才校验有效 Float、Int32 范围和列表数量；错误会指出台词序号与字段，不会下载不合法变量。

## 结构体来源与映射

来源为用户 `结构体导出/V2.0` 中的 `NOLOC_测试子结构体1077936131.json` 和新版 `1077936129对话节点.json`，快照位于 `src/assets/DSFGStudio/WalkTalk/`。新增节点定义包含第七字段 `autoContinue`，并与提供的变量样例完全对应；不改动原节点图编辑器所使用的定义。

注意：样例文件名虽有 `1077936131`，内容的真实外层 ID 是 **1077936168**，内层台词 ID 是 **1077936129**。两者都能在「结构体 ID 设置」中调整，每个编辑文件独立保存设置。

外层只有一个 StructList 字段。由于变量样例不包含字段名，导出器注册时使用 `dialogues` 作为内部访问别名；下载数据仍是原样例的 `Struct → StructList → Struct` 值结构，不添加这个字段名，也不复制样例自带的三句空台词。

| 顺序 | 字段 | 类型 | 新建默认值 |
| --- | --- | --- | --- |
| 1 | style | String | Default |
| 2 | talker | String | 空文本 |
| 3 | subtitle | String | 空文本 |
| 4 | content | String | 空文本 |
| 5 | continueDelay | Float | 0.50 |
| 6 | prams | Int32List | 空列表 |
| 7 | autoContinue | Float | 10.00 |

样式使用下拉框，目前只有 `Default`，新增和插入台词默认选中它，与节点对话的 `Default_UI` 独立。可在 `walkTalkStyles.ts` 追加选项。旧文件中的空值或未注册样式会显示为不可重新选择的「旧值」，打开时不自动覆盖；手动选中 `Default` 后正常保存和导出。源结构体快照保持不变，仅编辑器新建默认值覆盖 `style`。

保留源定义中的 `prams` 拼写。整数参数支持逗号、空格或换行分隔，保持填写顺序和重复值，最多 100 项。两种时间独立编辑，不擅自添加源结构体未定义的相互约束。

`walkTalkProject.ts` 负责编辑数据、列表操作与校验，`WalkTalkPanel.vue` 负责台词界面，`walkTalkExporter.ts` 负责结构体映射，`WalkTalkEditor.vue` 负责工作区文件、自动保存、下载与 ID 设置。

## 回归检查

运行 `node scripts/test-dsfg-walk-talk.cjs`、`node scripts/test-dsfg-walk-talk-integration.cjs`，以及 `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`。
