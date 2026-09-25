# OSS 公告

入口：右上角铃铛，在当前工具上方打开公告悬浮窗，不切换路由或卸载工具。支持关闭按钮、Esc 和点击遮罩关闭；关闭后焦点回到铃铛。

## 文件目录

将 `examples/Announcements/` 中的示例改为实际公告后，上传到 OSS：

```text
ugc-tool-data/
  Announcements/
    index.json
    welcome.md
    guide.md
    images/
      screenshot.png
```

生产索引地址为 `https://oss.xiaomol444.xyz/ugc-tool-data/Announcements/index.json`。
开发环境沿用现有代理，先访问 `ugc-tool-data-beta`，文件 404 时回退正式目录。
目录和索引文件名由 `src/configs/announcements.json` 配置，基础地址沿用 `VUE_APP_OSS_BASE`。

## 索引格式

```json
{
  "announcements": [
    {
      "id": "update-2026-09-26",
      "title": "本次更新说明",
      "date": "2026-09-26",
      "revision": "1",
      "content": "updates/2026-09-26.md"
    }
  ]
}
```

上述五个字段均为必填字符串。`id` 必须唯一且保持稳定；`content` 是公告目录下的相对 Markdown 文件路径，不允许路径穿越或外部 URL。
列表按 JSON 数组顺序展示，默认打开第一条；将最新或置顶公告放到数组最前面。空列表用 `{"announcements":[]}`。

先上传正文和图片，再更新索引。修改现有正文时递增 `revision`，例如从 `"1"` 改为 `"2"`，这样已读用户也会重新收到红点提示。建议正文文件使用版本化名称，并在 CDN 配置中避免长期缓存索引，确保查询参数参与缓存键或更新后刷新缓存。

## 未读提示

- 首次访问时索引中的公告均视为未读。
- 每篇正文成功加载并渲染后，才记录该篇版本为已读；打开页面不会把所有公告一次性标记已读。
- 通过 localStorage 持久保存并同步同源多标签页；浏览器禁止存储时退化为会话内记录。
- 页面启动、回到窗口及可见页面每五分钟检查索引；自动检查至少间隔一分钟。公告页支持手动刷新。
- 索引或正文请求失败有重试入口，失败不会清除已有的未读记录。

## Markdown 与语言

支持标题、列表、引用、表格、代码块、链接和图片。原始 HTML 作为文本显示，不执行脚本。
相对图片和链接以当前 Markdown 文件所在目录为基准，例如 `![截图](../images/screenshot.png)`。
正文和图片必须允许站点通过 HTTPS 访问；生产 OSS 正文和索引需正确配置 CORS。
界面支持项目现有五种语言；索引标题与 Markdown 正文原样显示，不会自动翻译。

示例文件仅保存在仓库中，不会自动发布到 OSS。

## Python 桌面编辑器

双击仓库中的 `tools/announcement_editor/start.cmd`，或运行 `python tools/announcement_editor/editor.py`。
支持公告列表排序、Markdown 编辑、图片导入、版本递增、备份和 ZIP 导出。
详细操作见 `tools/announcement_editor/README.md`。
