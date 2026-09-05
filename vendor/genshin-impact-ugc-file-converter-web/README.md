# 项目内置的 GIL/GIA 转换库

此目录是 `Genshin-Impact-UGC-File-Converter` 的 TypeScript 库快照，用于客户端 UI 动画编辑器的 GIA 导入。迁入日期：2026-09-05。

原库 Git 基线为 `4c548c86e69bcb5b5dcafed57935e45f765c0725`；本快照还包含该工作区的本地 TypeScript 库适配，不能仅用这个提交号重建。原 MIT 许可证见 `LICENSE`。

## 安装和云端构建

根项目通过 `file:./vendor/genshin-impact-ugc-file-converter-web` 安装本库。`dist/index.js` 已内置 `dtype/gil.csv` 和 `dtype/gia.csv`，没有外部运行时依赖。

必须把整个 `vendor/genshin-impact-ugc-file-converter-web/` 目录与根项目的 `package.json`、`pnpm-lock.yaml` 一起提交。尤其不能忽略 `dist/` 和 `dist-types/`：云端直接使用这些已构建文件，不需要在安装阶段运行本库构建，也不需要项目外的同级目录。

```ts
import { decode, encode, parse, stringify } from "genshin-impact-ugc-file-converter-web";
const document = decode(bytes, { type: "gia" });
const restoredBytes = encode(parse(stringify(document)));
```

## 维护源码

`lib/`、`worker/converter.ts`、`dtype/` 为库源码及数据；没有迁入原项目的 C++ 程序、网页或 Worker 部署配置。

仅在修改本库时，在本目录安装开发依赖并重新构建，再提交生成文件：

```sh
pnpm install
pnpm run build
pnpm test
```

测试使用 Node 的 TypeScript 类型擦除功能；本次在 Node 24 上验证。根项目安装本库时不需要安装这里的开发依赖。更新库后重新安装根项目依赖，使 `node_modules` 中的本地包快照与此目录同步。
