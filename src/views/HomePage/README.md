# 首页配置

首页和侧边栏共用 `src/configs/homePage.json`，分类和卡片按数组顺序展示。修改分类、工具名称、链接或排序后，两处会同步更新。

- 分类：`id` 唯一标识、`title` 标题、`titleKey` 可选多语言键、`color` 边框与图标颜色、`background` 分类底色、`cards` 卡片列表。
- 卡片：`id` 唯一标识、`href` 跳转地址、`title` 标题、`description` 说明、`icon` 文字图标。
- 卡片可选字段：`cover` 封面图片 URL、`credit` 署名、`titleKey` 和 `descriptionKey` 多语言键。
- 设置 `cover` 时显示图片，否则显示 `icon`。本地图片放入 `public`，例如 `public/covers/demo.png` 对应 `/covers/demo.png`。
- 当前语言存在对应翻译键时优先使用翻译，否则使用 JSON 中的文案。要直接改写展示文案，请同时修改翻译或移除相应翻译键。
- 分类数量根据 `cards` 自动计算；新增分类无需修改 Vue 模板。
- 侧边栏沿用分类的 `color`、`background` 和多语言标题；站内链接通过路由切换，HTTP(S) 外链在新标签页打开。
- JSON 配置首页展示内容和侧边栏导航。新增应用页面仍需在 `src/configs/routes.ts` 注册路由。

## 卡片背景截图

在 `src/configs/homePage.json` 的任意工具卡片中填写可选的 `previewImages` 数组，即可在卡片右侧显示倾斜叠放、向左渐隐的背景截图：

```json
"previewImages": [
  "/home-previews/bgm-player.png",
  "/home-previews/bgm-detail.png"
]
```

- 本地截图放在 `public/home-previews/`，填写路径时省略 `public`，例如 `public/home-previews/bgm-player.png` 对应 `/home-previews/bgm-player.png`。也可以填写完整的图片 URL。
- 最多显示前三张非空图片，按数组顺序叠放，后面的图片位于上层。建议使用 16:10 或 16:9 的横向截图。
- 留空数组 `[]` 或删除 `previewImages` 时不显示截图；加载失败的图片自动隐藏。
- 截图只作背景装饰，点击仍进入该工具。手机端（宽度不超过 680px）隐藏背景截图。
- BGM 卡片已配置一张实际页面截图作为示例，可以替换同名图片，或修改其 `previewImages` 路径；特效播放器预留了空数组供填写。
- `cover` 仍用于卡片左侧图标，与背景截图分开配置。

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

## 鸣谢列表

首页工具分类下方、联系作者区域上方展示鸣谢卡片，默认收起。点击标题栏或聚焦标题栏后按 Enter、空格键可展开或收起名单，右侧箭头指示当前状态。名单使用 `src/configs/homePage.json` 顶层的 `acknowledgements` 数组，按数组顺序展示；设为空数组时隐藏整张卡片。

- 每项包含 `id` 唯一标识、`name` 名字、`description` 贡献说明。
- 可选的 `href` 是贡献者链接，配置后名字可点击，并在新标签页打开。`name` 填显示的名字，链接单独填在 `href`；`name` 中的 Markdown 链接语法会作为普通文字显示。
- 名字和贡献说明直接显示配置原文，所有语言使用同一份名单，无需填写翻译键或修改翻译文件。
- 直接修改每项的 `name` 和 `description` 即可更新名字和贡献说明。
- 每位贡献者填写一个 `{ ... }` 对象，放在 `acknowledgements` 的方括号内，对象之间用逗号分隔，最后一项后不加逗号。每项的 `id` 不能重复。
- 贡献说明可用 `\n` 换行；填写空字符串 `""` 时不显示说明。

例如，将 `acknowledgements` 替换为以下数组，即可展示两位贡献者：

```json
"acknowledgements": [
  {
    "id": "contributor-a",
    "name": "贡献者甲",
    "description": "协助特效资源整理\n参与工具测试"
  },
  {
    "id": "contributor-b",
    "name": "贡献者乙",
    "description": "提供问题反馈与改进建议",
    "href": "https://example.com/"
  }
]
```
