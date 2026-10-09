# ugc-tools

## Download
```
git clone https://github.com/xiaomoL444/ugc-tool
```

## Project setup
```
pnpm install
```

### Compiles and hot-reloads for development
```
pnpm run serve
```

开发环境的 OSS 请求统一经过同源 `/ugc-tool-data/...` 代理：

- 优先读取 `https://oss.xiaomol444.xyz/ugc-tool-data-beta/...`。
- 只有 beta 文件返回 **404** 时，才读取 `https://oss.xiaomol444.xyz/ugc-tool-data/...`；网络错误、403、5xx 等不会触发回退。
- JSON、翻译表、图片、音频、视频均使用相同规则；支持媒体 Range 请求。响应头 `X-Ugc-Data-Source` 显示实际来源 `beta` 或 `production`。
- beta 的 `data.json` 应包含该工具的完整索引（正式内容和测试内容），不会按条目自动合并两份 JSON。仅需在 beta 目录上传新增或修改过的资源，共用资源留在正式目录即可。
- 例如：索引放在 `ugc-tool-data-beta/EffectPlayer/data.json`，新增图片放在 `ugc-tool-data-beta/EffectPlayer/icon/123.png`；未上传至 beta 的图片自动从正式目录读取。翻译表也按整个文件覆盖。
- 开发代理响应禁止浏览器缓存，避免正式资源的缓存遮住新上传的 beta 文件。更新代理配置后需重启 `pnpm run serve`。

正式构建仍直连正式 OSS。已有的 `VUE_APP_OSS_BASE` 优先级不变；若把它设为其他地址，请求将使用该地址，不经过上述默认代理。

运行代理回归测试：`node scripts/test-dev-oss-proxy.cjs`。

### Compiles and minifies for production
```
pnpm run build
```

### Cloudflare Pages 构建

构建根目录应指向包含本项目 `package.json` 和 `pnpm-lock.yaml` 的目录；构建命令使用 `pnpm run build`，输出目录为 `dist`。源码发布时同时提交更新后的依赖清单和锁文件，构建环境先安装依赖再执行构建。若禁用了自动安装，在构建步骤中先执行 `pnpm install --frozen-lockfile`。

AI 搜索共用的 `tools/ai-search-service/model-json.mjs` 依赖根目录声明的 `jsonrepair@3.15.0`。出现 `Can't resolve 'jsonrepair'` 时，先确认构建分支的 `package.json` 包含该依赖，锁文件与之匹配，依赖安装步骤已执行；报错中的源码目录不意味着应在该目录重复安装。更新这些文件后重新构建，缓存仍旧时再清理构建依赖缓存。[Cloudflare 构建目录说明](https://developers.cloudflare.com/pages/configuration/build-configuration/)

### Customize configuration
See [Configuration Reference](https://cli.vuejs.org/config/).

## 致谢

### 项目

[Miliastra-toolbox-primitive-shape](https://github.com/1475505/Miliastra-toolbox-primitive-shape) 客户端UI动画编辑器参考嘟嘟可老师的拟合工具，将图片转成拟合图元导入到lua中使用

[Genshin-Impact-UGC-File-Converter](https://github.com/Nyagamon/Genshin-Impact-UGC-File-Converter) 客户端UI动画编辑器参考该项目实现导入导出gia功能

### 贡献者

[@无边天下第一](https://github.com/zeimo1211) 小地图场景映射计算制作

[@百里问弦](https://github.com/LuoYang-1620) 客户端UI动画编辑器参与
