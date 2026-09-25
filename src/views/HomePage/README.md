# 首页配置

首页展示数据位于 `src/configs/homePage.json`，分类和卡片按数组顺序展示。

- 分类：`id` 唯一标识、`title` 标题、`titleKey` 可选多语言键、`color` 边框与图标颜色、`background` 分类底色、`cards` 卡片列表。
- 卡片：`id` 唯一标识、`href` 跳转地址、`title` 标题、`description` 说明、`icon` 文字图标。
- 卡片可选字段：`cover` 封面图片 URL、`credit` 署名、`titleKey` 和 `descriptionKey` 多语言键。
- 设置 `cover` 时显示图片，否则显示 `icon`。本地图片放入 `public`，例如 `public/covers/demo.png` 对应 `/covers/demo.png`。
- 当前语言存在对应翻译键时优先使用翻译，否则使用 JSON 中的文案。要直接改写展示文案，请同时修改翻译或移除相应翻译键。
- 分类数量根据 `cards` 自动计算；新增分类无需修改 Vue 模板。
- JSON 仅配置首页入口。新增应用页面仍需在 `src/configs/routes.ts` 注册路由。

## 卡片更新标签

在任意卡片对象中添加可选的 `badge` 字段，即可在标题旁显示标签：

```json
{
  "id": "bgm",
  "href": "/BgmPlayer",
  "title": "BGM播放器",
  "description": "查找与试听游戏背景音乐",
  "icon": "♫",
  "badge": "v7.2 Update"
}
```

以上仅为配置示例，不代表该工具实际已更新到对应版本。

- `badge` 可填写 `New`、`v7.2 Update` 或其他文字；删除字段、设置为空字符串或仅空格时隐藏。
- 标签会随标题自动换行，适配窄屏。
- 可选的 `badgeKey` 用于多语言翻译，解析方式与 `titleKey` 相同；未设置时所有语言显示 `badge` 原文。
- 如设置 `badgeKey`，请在 `src/i18n/locales/homePage/` 的五种语言 JSON 中添加对应翻译。
