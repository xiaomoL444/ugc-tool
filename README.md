# ugc-tools

## Download
```
git clone https://github.com/xiaomoL444/ugc-tool-beta
```

## Project setup
```
pnpm install
```

### Compiles and hot-reloads for development
```
pnpm run serve
```

### Compiles and minifies for production
```
pnpm run build
```

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).

### 本地化（Vue I18n）

标题栏右上角支持简体中文与 English。用户选择保存在 `ugc-tools.locale`；首次访问按浏览器语言匹配，无法匹配时使用简体中文。切换语言无需刷新，浏览器标题和页面 `lang` 同步更新。

词库按功能组织，不要求每个页面单独建立一份：

- `src/i18n/locales/{zh-CN,en-US}/common.ts`：导航、语言入口、复制提示等公共词条。
- `src/i18n/locales/{zh-CN,en-US}/effectPlayer.ts`：特效播放器的界面与标签词条。分类词条完全由 OSS 提供。
- OSS 中的 `EffectPlayer/i18n/zh-cn.json`、`EffectPlayer/i18n/en-us.json`：按语言独立存放特效名 `names.<ID>`、分类名 `category.<ID>` 和标签 `tags.<ID>`。分类使用稳定数字 ID，如 `category.1` 对应“属性”，`category.7` 对应“颜色”；两份示例已包含全部 10 个分类词条。`filter.*` 等站点界面文案由本地词库维护。

组件使用 `useI18n({ useScope: 'global' })`，然后调用 `t('effectPlayer.loading')`。带参数的句子使用完整词条，例如 `t('common.copySuccess', { text })`。配置中的标签保存翻译键，在模板或 `computed` 中调用 `t()`，以便切换语言时更新。

当前语言的回退链设为空，包括关闭 `en-US → en` 等隐式回退。当前语言缺少翻译时直接显示键名，例如 `effectPlayer.names.12345`，不会使用另一种语言的译文。特效名称及复制名称使用当前语言；搜索同时支持所有已加载语言的译名与标签、原始名称与标签和 ID，切换显示语言不会丢失搜索结果，复制 ID 保持原值。其他工具的专用页面文案尚未迁移。

特效页在获取 `data.json` 后异步、独立加载所有支持语言的翻译文件；未提供对应语言文件时名称显示 key。文件名使用小写语言代码，JSON 内含 `version`、`namespace`、`locale` 和 `translations`（相对 key → 译文）。已移除本地生成的资源译名。全项目通用的 `loadOssTranslations(project, namespace, directory?)` 默认读取 `i18n/` 目录；`remoteI18n.load({ namespace, locale, url })` 可加载单种语言。详见 [OSS 翻译表接口](I18N.md)、[中文示例](examples/i18n/zh-cn.json) 和 [英文示例](examples/i18n/en-us.json)。

数据可直接保存完整键：特效 `title` 为 `effectPlayer.names.2`，`TagData` 值为 `effectPlayer.tags.8`，`category` 键为 `effectPlayer.category.1`。名称和标签原文保存在 `sourceTitle` / `sourceName` / `sourceTagData`；`sourceCategoryData` 保存分类 ID → 原名，如 `{ "1": "属性" }`，后续迁移复用此映射，新增分类追加 ID，调整顺序时不重新编号。分类直接使用完整数字键查询 OSS 词库，没有本地词条或旧键兼容，缺译时显示键名。`scripts/migrate-effect-i18n.cjs` 可从资源目录准备数据与词库迁移副本，具体流程和全部编号见 [数据格式说明](I18N.md#datajson-中的完整键)。

本地化验证：

```sh
node scripts/test-i18n.cjs
node scripts/test-effect-i18n-migration.cjs
node scripts/test-remote-i18n.cjs
node scripts/test-effect-search.cjs
node scripts/test-effect-tag-filters.cjs
node scripts/test-effect-media.cjs
node scripts/test-effect-media-readiness.cjs
```
