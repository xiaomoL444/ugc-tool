# 图片资源与图元拟合

工具栏「图片资源」管理当前文件的自定义原图、拟合设置与结果。图元控件通过 imageResourceId 引用 primitiveResources 中的资源，只保存引用和显示方式。旧文件的内嵌 imageUrl/fitData 会按原图合并迁移；未被引用的资源也随文件保存。替换原图会清除旧拟合结果，所有引用恢复原图预览。

拟合在浏览器 Web Worker 中运行 Go WASM，默认 2 个线程，最大 min(16, hardwareConcurrency)。每轮分布搜索候选、选取最低误差并提交到主计算线程。关闭面板、切换资源或取消操作会终止本轮全部 Worker，保留之前成功的拟合结果。数量、分辨率与并行数分别影响输出复杂度、计算精度与内存/并行计算开销。

参数 JSON 使用 UGCTools.PrimitiveImage@1：原图中心为原点、X 向右、Y 向上、角度为度、尺寸为原图像素，elements 按底层到顶层排列。每项包含 imageId、position、rotation、size、color、layer。控件预览按 min(控件宽/原图宽, 控件高/原图高) 等比适配。白底模式会增加一个背景矩形。预览使用编辑器已有的游戏素材 100001/100002/100003；游戏实际渲染还可能存在采样差异。当前原生 GIA 导出仍把图元控件作为容器，图元参数通过独立 JSON 导出。

## 引擎来源

- 上游：https://github.com/1475505/Miliastra-toolbox-primitive-shape
- 固定版本：46f30bb318c82aa4d4ece7bd790dc68e483fb360
- public/primitive-wasm/primitive.wasm、wasm_exec.js、fit_worker.js 来自该版本的 web/wasm；Worker 中两处绝对资源地址改为同目录相对地址，其余保持上游实现。
- 上游 MIT 许可保存在 public/primitive-wasm/LICENSE，primitive 依赖许可保存在 primitive-LICENSE。WASM 与 wasm_exec.js 必须配套更新。
- 静态构建直接包含以上资源，无需远端拟合 API、Go 服务或浏览器跨源隔离。来源为网址的图片需要允许跨域读取；本地导入图片可直接计算。

验证：node scripts/test-client-ui-primitive-data.cjs；node node_modules/vue-tsc/bin/vue-tsc.js --noEmit。
