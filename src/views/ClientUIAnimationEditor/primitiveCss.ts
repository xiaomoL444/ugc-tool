import chroma from "chroma-js";
import { normalizePrimitiveData, PRIMITIVE_IMAGE_IDS, type PrimitiveElement, type PrimitiveFitData } from "./primitiveData";

export const MAX_PRIMITIVE_CSS_BYTES = 2 * 1024 * 1024;

/** CSS coordinates are top-left / Y-down; each element is positioned by its centre. */
export function exportPrimitiveCss(value: PrimitiveFitData): string {
  const data = normalizePrimitiveData(value);
  if (!data) throw new Error("没有有效的拟合结果可导出。");
  const fixed = (value: number) => Object.is(value, -0) ? "-0.00" : value.toFixed(2);
  const lines = [
    "/* Miliastra CSS Export */",
    ".shaper-container {",
    "  position: relative;",
    `  width: ${data.width}px;`,
    `  height: ${data.height}px;`,
    "  background: #ffffff;",
    "  overflow: hidden;",
    "}",
    ".shaper-element {",
    "  position: absolute;",
    "  box-sizing: border-box;",
    "}",
  ];
  data.elements.forEach((element, index) => {
    const { x, y, width, height, rotation, color, type } = element;
    if ([x, y, width, height, rotation].some(n => Math.abs(n) > 1e9)) throw new Error("图元超出 CSS 支持范围。");
    if (Number(fixed(width)) <= 0 || Number(fixed(height)) <= 0) throw new Error("图元尺寸过小，无法用两位小数导出 CSS。");
    const hex = [color.r, color.g, color.b].map(channel => channel.toString(16).padStart(2, "0")).join("");
    lines.push(
      `.shaper-element.shaper-e${index} {`,
      `  left: ${fixed(data.width / 2 + x)}px;`,
      `  top: ${fixed(data.height / 2 - y)}px;`,
      `  width: ${fixed(width)}px;`,
      `  height: ${fixed(height)}px;`,
      `  background: #${hex};`,
      `  opacity: ${color.a.toFixed(4)};`,
      `  transform: translate(-50%, -50%) rotate(${fixed(-rotation)}deg);`,
      "  transform-origin: 50% 50%;",
      `  z-index: ${index};`,
    );
    if (type === "ellipse") lines.push("  border-radius: 50%;");
    if (type === "triangle") lines.push("  clip-path: polygon(50% 0%, 0% 100%, 100% 100%);");
    lines.push("}");
  });
  return lines.join("\n") + "\n";
}

/** Parse only the exported shaper dialect; never attach imported CSS to the document. */
export function importPrimitiveCss(source: string, target?: { width: number; height: number }): PrimitiveFitData {
  if (new TextEncoder().encode(source).length > MAX_PRIMITIVE_CSS_BYTES) throw new Error("CSS 不能超过 2 MiB。");
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const rules = new Map<string, Record<string, string>>();
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (text.slice(end, match.index).trim()) throw new Error("CSS 规则格式无效。");
    end = match.index! + match[0].length;
    const selector = match[1].trim();
    if (![".shaper-container", ".shaper-element"].includes(selector) && !/^\.shaper-element\.shaper-e(0|[1-9]\d{0,8})$/.test(selector)) throw new Error(`不支持 CSS 选择器：${selector.slice(0, 80)}。请导入 shaper 格式。`);
    if (rules.has(selector)) throw new Error("CSS 不支持重复规则，请合并同一选择器的样式。");
    const values: Record<string, string> = Object.create(null);
    for (const declaration of match[2].split(";").filter(s => s.trim())) {
      const entry = /^\s*([a-z-]+)\s*:\s*([^{};]+?)\s*$/i.exec(declaration);
      if (!entry) throw new Error("CSS 属性格式无效。");
      const key = entry[1].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(values, key)) throw new Error(`CSS 属性重复：${key}。`);
      values[key] = entry[2].trim();
    }
    rules.set(selector, values);
    if (rules.size > 1003) throw new Error("CSS 最多支持 1001 个图元。");
  }
  if (text.slice(end).trim()) throw new Error("CSS 格式无效，不支持嵌套规则、外部引用或媒体查询。");
  const container = rules.get(".shaper-container"), base = rules.get(".shaper-element");
  if (!container || !base) throw new Error("CSS 缺少 shaper-container 或 shaper-element 规则。");
  function only(values: Record<string, string>, keys: string[]) {
    for (const key of Object.keys(values)) if (!keys.includes(key)) throw new Error(`不支持 CSS 属性：${key}。原拟合结果未修改。`);
  }
  const numeric = "[-+]?(?:\\d*\\.\\d+|\\d+\\.?\\d*)(?:[eE][-+]?\\d+)?";
  function number(value: string | undefined, unit = "") {
    if (!value || !new RegExp(`^${numeric}${unit}$`, "i").test(value)) throw new Error(`CSS 数值无效，需要${unit || '纯数字'}。`);
    const n = Number(unit ? value.slice(0, -unit.length) : value);
    if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error("CSS 数值超出支持范围。");
    return n;
  }
  function color(values: Record<string, string>) {
    if (values.background && values["background-color"]) throw new Error("请仅使用 background 或 background-color 之一。");
    const fill = values.background ?? values["background-color"] ?? "transparent";
    if (fill.toLowerCase() === "transparent") return {r:0, g:0, b:0, a:0};
    if (!chroma.valid(fill)) throw new Error("CSS 仅支持纯色填充，不支持渐变、图片或变量。");
    const [r, g, b, a] = chroma(fill).rgba();
    return { r, g, b, a };
  }
  only(container, ["position", "width", "height", "background", "background-color", "overflow"]);
  only(base, ["position", "box-sizing"]);
  if (container.position !== "relative" || container.overflow !== "hidden" || base.position !== "absolute" || base["box-sizing"] !== "border-box") throw new Error("CSS 布局须保持导出的 relative / absolute、border-box 和 overflow: hidden 设置。");
  const sourceWidth = number(container.width, "px"), sourceHeight = number(container.height, "px");
  const width = target?.width ?? sourceWidth, height = target?.height ?? sourceHeight;
  if (![sourceWidth, sourceHeight, width, height].every(n => Number.isFinite(n) && n > 0 && n <= 32768)) throw new Error("CSS 画布尺寸必须在 0–32768 像素之间。");
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const shapes: { id: number; z: number; element: PrimitiveElement }[] = [];
  for (const [selector, style] of rules) {
    const match = /^\.shaper-element\.shaper-e(\d+)$/.exec(selector);
    if (!match) continue;
    only(style, ["left", "top", "width", "height", "background", "background-color", "opacity", "transform", "transform-origin", "z-index", "border-radius", "clip-path"]);
    const rotation = new RegExp(`^translate\\(\\s*-50%\\s*,\\s*-50%\\s*\\)\\s+rotate\\(\\s*(${numeric})deg\\s*\\)$`, "i").exec(style.transform ?? "");
    if (!rotation || style["transform-origin"]?.trim().replace(/\s+/g, " ") !== "50% 50%") throw new Error("CSS 变换须使用 translate(-50%, -50%) rotate(角度deg)，中心为 50% 50%。");
    let type: PrimitiveElement["type"] = "rectangle";
    const radius = style["border-radius"]?.replace(/\s+/g, "");
    if (radius && radius !== "0" && radius !== "0px") {
      if (radius !== "50%") throw new Error("CSS 仅支持 50% 椭圆圆角。");
      type = "ellipse";
    }
    const clip = style["clip-path"]?.replace(/\s+/g, "");
    if (clip && clip !== "none") {
      if (clip !== "polygon(50%0%,0%100%,100%100%)" || type === "ellipse") throw new Error("CSS 仅支持导出格式的等腰三角形裁剪，不支持叠加圆角。");
      type = "triangle";
    }
    const rgba = color(style), opacity = style.opacity === undefined ? 1 : number(style.opacity);
    if (opacity < 0 || opacity > 1) throw new Error("CSS 透明度必须为 0–1。");
    rgba.a *= opacity;
    const z = style["z-index"] === undefined ? 0 : number(style["z-index"]);
    if (!Number.isInteger(z) || z < 0) throw new Error("CSS z-index 必须为非负整数，负层级可能落在容器背景后方。");
    const w = number(style.width, "px"), h = number(style.height, "px");
    if (w <= 0 || h <= 0) throw new Error("CSS 图元宽高必须大于零。");
    shapes.push({ id: Number(match[1]), z, element: {
      type, imageId: PRIMITIVE_IMAGE_IDS[type],
      x: (number(style.left, "px") - sourceWidth / 2) * scale,
      y: (sourceHeight / 2 - number(style.top, "px")) * scale,
      width: w * scale, height: h * scale, rotation: -number(rotation[1]), color: rgba,
    } });
  }
  if (!shapes.length) throw new Error("CSS 中没有可导入的图元。");
  // Numbered classes define DOM order; z-index controls stacking, then DOM order breaks ties.
  shapes.sort((a, b) => a.z - b.z || a.id - b.id);
  const elements = shapes.map(s => s.element), background = color(container), first = elements[0];
  const covered = first.type === "rectangle" && first.x === 0 && first.y === 0 && first.rotation % 360 === 0 && first.width >= sourceWidth * scale && first.height >= sourceHeight * scale && first.color.a === 1;
  if (background.a > 0 && !covered) elements.unshift({type:"rectangle", imageId:PRIMITIVE_IMAGE_IDS.rectangle, x:0, y:0, width:sourceWidth*scale, height:sourceHeight*scale, rotation:0, color:background});
  if (elements.length > 1001) throw new Error("CSS 图元与容器背景合计不能超过 1001 个。");
  const result = normalizePrimitiveData({ version:1, width, height, elements });
  if (!result) throw new Error("CSS 拟合数据无效，原拟合结果未修改。");
  return result;
}
