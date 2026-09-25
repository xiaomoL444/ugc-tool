# Python 公告编辑器

需要 Python 3.10+ 和 Tkinter（Windows 官方 Python 安装器通常已包含）。

双击 `start.cmd`，或在项目根目录运行：

```powershell
python tools/announcement_editor/editor.py
```

直接打开现有公告目录：

```powershell
python tools/announcement_editor/editor.py examples/Announcements
```

- 左侧新增、删除、上移、下移公告；第一条是网页默认打开的公告。
- 右侧编辑 ID、标题、ISO 日期、版本号、Markdown 路径和正文。
- ID 是已读记录的标识，发布后请保持稳定。
- 已保存的正文修改后，如果版本号未手动变化，保存时自动递增数字版本号；非数字版本号需要手动修改。
- 支持 Markdown 快捷插入、图片导入、Ctrl+S、未保存提醒。
- 保存生成 UTF-8 `index.json` 和各篇 `.md`；已存在且将被修改的文件会备份至 `.backups/`。检测到外部修改时会停止覆盖。
- 删除只从索引移除公告，保留旧正文；ZIP 中仅包含当前索引、当前正文和图片，不包含备份。
- 导出 ZIP 会先保存，再生成包含 `Announcements/` 的上传包。

## 可选正文预览

编辑、保存、导出仅使用 Python 标准库。需要在默认浏览器查看 Markdown 排版时安装：

```powershell
python -m pip install -r tools/announcement_editor/requirements.txt
```

预览使用临时目录，不会把 HTML 混入上传包；不支持原始 HTML 和脚本。样式与网页接近，但以网页最终展示为准。

## 发布到 OSS

解压 ZIP，将 `Announcements/` 放到 OSS 的 `ugc-tool-data/` 下；开发测试可放到 `ugc-tool-data-beta/`。
先上传正文及图片，最后上传 `index.json`。目录已有旧内容时覆盖更新文件即可。
编辑器不会保存 OSS 密钥或自动上传；遵循项目现有 OSS 发布方式。
保存和导出只作用于本地文件，网页要等 OSS 更新后才显示新公告。

## 自检

```powershell
python -m unittest discover -s tools/announcement_editor -p "test_*.py"
```
