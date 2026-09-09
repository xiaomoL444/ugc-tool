# 文本流程

编辑区顶部可切换「节点编辑 / 文本流程」。两种视图共享同一份对话数据，不保存第二套节点或连线。

- `utils/dialogueTextPreview.ts`：从业务 Clip 与实际出口连线派生文本框。连续单向对话合并，分支、合流及返回目标保留边界；空出口和未接入开始的内容不会被隐藏。
- `utils/dialogueTextPreviewLayout.ts`：仅负责自上而下的布局，回接和跨层连线从外侧绕行。位置不回写原图；框高由文本视图实际测量。
- `DialogueTextPreview.vue`：只读展示左侧说话人及 subtitle、右侧台词。连续且说话人、subtitle 都相同的标签只显示一次。长文本自动换行、撑高，可选择复制。
- `utils/dialogueTextEditing.ts`：当前预览只使用其中的说话人合并判定，不调用数据修改方法，也不发送编辑事件。

所有文本、选项、分支和连线均在原节点图 / Timeline 中编辑。文本流程不提供新增、修改或改接入口，不执行表达式、不模拟播放，也不会重排真实节点。保存和 Ctrl+S 下载继续走原有逻辑。

双击预览卡片可切回节点编辑、选中并居中显示对应节点，同时打开 Group 的 Timeline。合并卡片中的具体台词定位到它自己的 Group；选项区定位到卡片末尾拥有选项的 Group；卡片空白处（或卡片获得焦点后按 Enter）定位到第一句。开始、结束和条件分支卡片同样可定位，但不打开 Timeline。`utils/dialogueTextNavigation.ts` 只负责业务 ID 与画布 ID 的只读映射；没有可见画布节点时仅提示，不创建节点或改变隐藏状态。

回归检查：`node scripts/test-dsfg-text-preview.cjs`、`node scripts/test-dsfg-text-preview-layout.cjs`、`node scripts/test-dsfg-text-editing.cjs`、`node scripts/test-dsfg-text-navigation.cjs`。
