import chroma from "chroma-js";
import { normalizePrimitiveData, PRIMITIVE_IMAGE_IDS, type PrimitiveElement, type PrimitiveFitData } from "./primitiveData";

export const MAX_PRIMITIVE_SVG_BYTES = 2 * 1024 * 1024;
type Matrix = [number, number, number, number, number, number];
type Point = { x: number; y: number };
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
function numbers(value: string) {
  if (value.replace(numberPattern, "").replace(/[\s,]/g, "")) throw new Error("SVG 包含不支持的单位或无效数值。");
  const result = (value.match(numberPattern) ?? []).map(Number);
  if (result.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) throw new Error("SVG 数值超出支持范围。");
  return result;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function transform(value: string): Matrix {
  let matrix = identity;
  const expression = /([a-zA-Z]+)\s*\(([^()]*)\)/g;
  if (value.replace(expression, "").replace(/[\s,]/g, "")) throw new Error("SVG transform 格式无效。");
  for (const match of value.matchAll(expression)) {
    const n = numbers(match[2]); let next: Matrix;
    if (match[1] === "translate" && (n.length === 1 || n.length === 2)) next = [1,0,0,1,n[0],n[1] ?? 0];
    else if (match[1] === "scale" && (n.length === 1 || n.length === 2)) next = [n[0],0,0,n[1] ?? n[0],0,0];
    else if (match[1] === "matrix" && n.length === 6) next = n as Matrix;
    else if (match[1] === "rotate" && (n.length === 1 || n.length === 3)) {
      const rad = n[0] * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
      const x = n[1] ?? 0, y = n[2] ?? 0;
      next = [c,s,-s,c,x-c*x+s*y,y-s*x-c*y];
    } else throw new Error(`不支持 transform：${match[1]}。请保留平移、旋转和缩放。`);
    matrix = multiply(matrix, next);
    if (matrix.some(v => !Number.isFinite(v) || Math.abs(v) > 1e9)) throw new Error("SVG 变换超出支持范围。");
  }
  return matrix;
}
const point = (m: Matrix, x: number, y: number): Point => ({ x: m[0]*x+m[2]*y+m[4], y: m[1]*x+m[3]*y+m[5] });
const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x, a.y-b.y);

/** Export real vector shapes, not a bitmap wrapped inside an SVG. */
export function exportPrimitiveSvg(value: PrimitiveFitData, name: string): string {
  const data = normalizePrimitiveData(value);
  if (!data) throw new Error("没有有效的拟合结果可导出。");
  const lines = [`<svg xmlns="http://www.w3.org/2000/svg" width="${data.width}" height="${data.height}" viewBox="0 0 ${data.width} ${data.height}">`, `  <title>${xml(name)}</title>`];
  const fixed = (value: number) => Object.is(value, -0) ? "-0.00" : value.toFixed(2);
  for (const e of data.elements) {
    if ([e.x,e.y,e.width,e.height,e.rotation].some(v => Math.abs(v) > 1e9)) throw new Error("图元超出 SVG 支持范围。");
    const cx = Number(fixed(data.width/2+e.x)), cy = Number(fixed(data.height/2-e.y));
    // Round half-extents before building vertices so triangles remain symmetric on reimport.
    const rx = Number(fixed(e.width/2)), ry = Number(fixed(e.height/2));
    if (e.type !== "rectangle" ? rx <= 0 || ry <= 0 : Number(fixed(e.width)) <= 0 || Number(fixed(e.height)) <= 0) throw new Error("图元尺寸过小，无法用两位小数导出 SVG。");
    const hex = [e.color.r, e.color.g, e.color.b].map(channel => channel.toString(16).padStart(2, "0")).join("");
    const paint = `fill="#${hex}" opacity="${e.color.a.toFixed(4)}"`;
    const pose = `transform="rotate(${fixed(-e.rotation)} ${fixed(cx)} ${fixed(cy)})"`;
    const shape = e.type === "ellipse" ? `<ellipse cx="${fixed(cx)}" cy="${fixed(cy)}" rx="${fixed(rx)}" ry="${fixed(ry)}"`
      : e.type === "rectangle" ? `<rect x="${fixed(cx-e.width/2)}" y="${fixed(cy-e.height/2)}" width="${fixed(e.width)}" height="${fixed(e.height)}"`
      : `<polygon points="${fixed(cx)},${fixed(cy-ry)} ${fixed(cx+rx)},${fixed(cy+ry)} ${fixed(cx-rx)},${fixed(cy+ry)}"`;
    lines.push(`  ${shape} ${paint} ${pose} />`);
  }
  lines.push("</svg>");
  return lines.join("\n");
}

function attributeNumber(el: Element, key: string, fallback = 0) {
  const raw = el.getAttribute(key);
  if (raw === null) return fallback;
  const n = numbers(raw.trim().replace(/px$/, ""));
  if (n.length !== 1) throw new Error(`SVG ${key} 数值无效。`);
  return n[0];
}
function pathPoints(value: string): Point[] {
  if (value.replace(numberPattern, "").replace(/[MmLlHhVvZz\s,]/g, "")) throw new Error("曲线路径暂不能直接转换为游戏图元，请保留矩形、椭圆或三角形。");
  const tokens = value.match(/[MmLlHhVvZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  const points: Point[] = []; let command = "", x = 0, y = 0, index = 0;
  while (index < tokens.length) {
    if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
    if (/^[zZ]$/.test(command)) { if (index !== tokens.length) throw new Error("不支持复合路径。"); break; }
    if (!command || !points.length && !/^[mM]$/.test(command)) throw new Error("SVG 路径须以 M 开始。");
    if (/^[mM]$/.test(command) && points.length) throw new Error("不支持多个子路径。");
    const take = () => { const raw = tokens[index++]; if (!raw || /^[a-z]$/i.test(raw)) throw new Error("SVG 路径坐标不完整。"); return numbers(raw)[0]; };
    const relative = command === command.toLowerCase();
    if (/^[hH]$/.test(command)) x = take() + (relative ? x : 0);
    else if (/^[vV]$/.test(command)) y = take() + (relative ? y : 0);
    else { const a = take(), b = take(); x = a + (relative ? x : 0); y = b + (relative ? y : 0); }
    points.push({x,y}); if (points.length > 5) throw new Error("路径只能是等腰三角形。");
    if (command === "m") command = "l"; if (command === "M") command = "L";
  }
  return points;
}

/** Detached XML only: no SVG markup is ever mounted or executed. Unsupported features fail atomically. */
export function importPrimitiveSvg(source: string, target?: { width: number; height: number }): PrimitiveFitData {
  if (new TextEncoder().encode(source).length > MAX_PRIMITIVE_SVG_BYTES) throw new Error("SVG 不能超过 2 MiB。");
  if (/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)/i.test(source)) throw new Error("SVG 不能包含外部实体、样式表或文档类型声明。");
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "svg") throw new Error("不是有效的 SVG 文件。");
  const root = doc.documentElement;
  const box = root.hasAttribute("viewBox") ? numbers(root.getAttribute("viewBox")!) : [0,0,attributeNumber(root,"width"),attributeNumber(root,"height")];
  if (box.length !== 4 || box[2] <= 0 || box[3] <= 0 || box[2] > 32768 || box[3] > 32768) throw new Error("SVG 必须有有效的 viewBox 或像素宽高（不超过 32768）。");
  const width = target?.width ?? box[2], height = target?.height ?? box[3];
  if (![width,height].every(n => Number.isFinite(n) && n > 0 && n <= 32768)) throw new Error("目标资源尺寸无效。");
  const scale = Math.min(width / box[2], height / box[3]);
  const initial: Matrix = [scale,0,0,scale,(width-box[2]*scale)/2-box[0]*scale,(height-box[3]*scale)/2-box[1]*scale];
  const elements: PrimitiveElement[] = []; let visited = 0;
  const paintKeys = new Set(["fill", "fill-opacity", "opacity", "stroke", "stroke-width", "display", "visibility"]);
  function visit(el: Element, parent: Matrix, inherited: Record<string,string>, depth: number) {
    if (++visited > 5000 || depth > 32) throw new Error("SVG 层级或元素数量过多。");
    const tag = el.localName;
    if (["metadata", "title", "desc"].includes(tag)) return;
    if (!["svg","g","rect","ellipse","circle","polygon","path","defs"].includes(tag) || tag === "svg" && el !== root) throw new Error(`不支持 SVG 元素 <${tag}>，原拟合结果未修改。`);
    const paint = { ...inherited }; delete paint.opacity;
    const geometry = new Set(["x","y","width","height","cx","cy","rx","ry","r","points","d","transform","viewBox","version","preserveAspectRatio"]);
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || /href$/i.test(attr.localName)) throw new Error("SVG 不能包含事件或外部引用。");
      if (paintKeys.has(attr.name)) paint[attr.name] = attr.value;
      else if (!(attr.name === "style" || geometry.has(attr.name) || attr.name === "id" || attr.name.startsWith("data-") || attr.name.startsWith("xmlns") || attr.prefix === "inkscape" || attr.prefix === "sodipodi")) throw new Error(`不支持 SVG 属性：${attr.name}。`);
    }
    // Inline styles override presentation attributes regardless of XML attribute order.
    if (el.hasAttribute("style")) {
        for (const declaration of el.getAttribute("style")!.split(";").filter(s => s.trim())) {
          const colon = declaration.indexOf(":"); const key = declaration.slice(0,colon).trim(), value = declaration.slice(colon+1).trim();
          if (!paintKeys.has(key) || !value) throw new Error(`不支持 SVG 样式：${key}。请去除描边、渐变、滤镜和裁剪。`);
          paint[key] = value;
        }
    }
    if (paint.stroke && paint.stroke !== "none") throw new Error("描边无法直接转换为游戏图元，请使用纯填充图形。");
    if (paint.display && !["none","inline"].includes(paint.display) || paint.visibility && !["visible","hidden"].includes(paint.visibility)) throw new Error("不支持此 SVG 可见性设置。");
    if (paint.display === "none" || paint.visibility === "hidden") return;
    const unit = (value: string | undefined) => { if (value === undefined) return 1; const n = numbers(value); if (n.length !== 1 || n[0]<0 || n[0]>1) throw new Error("SVG 透明度必须为 0–1。"); return n[0]; };
    const opacity = unit(paint.opacity);
    const matrix = multiply(parent, transform(el.getAttribute("transform") ?? ""));
    if (["svg","g","defs"].includes(tag)) {
      if (tag === "defs" && el.children.length) throw new Error("不支持 SVG 渐变、蒙版、引用定义；请使用独立的纯填充图元。");
      if (opacity !== 1) throw new Error("组透明度会改变重叠混色，请将透明度分别设置到每个图元上。");
      for (const child of Array.from(el.children)) visit(child, matrix, paint, depth+1);
      return;
    }
    if (el.children.length) throw new Error("图元不能包含子元素或动画。");
    if (paint.fill === "none") return;
    if (!chroma.valid(paint.fill ?? "black")) throw new Error("SVG 填充颜色无效，不支持渐变、纹理或 CSS 变量。");
    const rgba = chroma(paint.fill ?? "black").rgba();
    const color = { r: rgba[0], g: rgba[1], b: rgba[2], a: rgba[3]*unit(paint["fill-opacity"])*opacity };
    let type: PrimitiveElement["type"] = tag === "rect" ? "rectangle" : "ellipse", center: Point, w: number, h: number, rotation: number;
    if (tag === "polygon" || tag === "path") {
      const raw = tag === "path" ? pathPoints(el.getAttribute("d") ?? "") : (() => { const n = numbers(el.getAttribute("points") ?? ""); if (n.length % 2) throw new Error("多边形坐标不完整。"); return Array.from({length:n.length/2},(_,i)=>({x:n[i*2],y:n[i*2+1]})); })();
      const p = raw.map(p => point(matrix,p.x,p.y)); if (p.length>1 && distance(p[0],p[p.length-1])<1e-8) p.pop();
      if (p.length !== 3) throw new Error("多边形/直线路径目前只支持等腰三角形；矩形请保留 rect 元素。");
      let apex = -1;
      for (let i=0;i<3;i++) if (Math.abs(distance(p[i],p[(i+1)%3])-distance(p[i],p[(i+2)%3])) < 1e-6*Math.max(1,distance(p[i],p[(i+1)%3]))) { apex=i; break; }
      if (apex < 0) throw new Error("游戏三角形素材只支持等腰三角形，不支持斜切变形。");
      const tip=p[apex], a=p[(apex+1)%3], b=p[(apex+2)%3], mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      center={x:(tip.x+mid.x)/2,y:(tip.y+mid.y)/2}; w=distance(a,b); h=distance(tip,mid); rotation=-Math.atan2(tip.x-mid.x,mid.y-tip.y)*180/Math.PI; type="triangle";
    } else {
      const sx=Math.hypot(matrix[0],matrix[1]), sy=Math.hypot(matrix[2],matrix[3]);
      if (!sx || !sy || Math.abs(matrix[0]*matrix[2]+matrix[1]*matrix[3])>1e-6*sx*sy) throw new Error("图元包含无法表示的斜切或零缩放变换。");
      if (tag === "rect") {
        if (attributeNumber(el,"rx") || attributeNumber(el,"ry")) throw new Error("圆角矩形不能直接转换为游戏矩形素材。");
        const rw=attributeNumber(el,"width"), rh=attributeNumber(el,"height"); w=rw*sx; h=rh*sy; center=point(matrix,attributeNumber(el,"x")+rw/2,attributeNumber(el,"y")+rh/2);
      } else {
        const rx=attributeNumber(el,tag === "circle" ? "r" : "rx"), ry=tag === "circle" ? rx : attributeNumber(el,"ry");
        w=2*rx*sx; h=2*ry*sy; center=point(matrix,attributeNumber(el,"cx"),attributeNumber(el,"cy"));
      }
      rotation=-Math.atan2(matrix[1],matrix[0])*180/Math.PI;
    }
    if (![center.x,center.y,w,h,rotation].every(n=>Number.isFinite(n) && Math.abs(n)<=1e9) || w<=0 || h<=0) throw new Error("SVG 图元尺寸无效或退化。");
    elements.push({ type, imageId: PRIMITIVE_IMAGE_IDS[type], x:center.x-width/2, y:height/2-center.y, width:w, height:h, rotation, color });
    if (elements.length>1001) throw new Error("SVG 最多支持 1001 个图元。");
  }
  visit(root,initial,{},0);
  const data=normalizePrimitiveData({version:1,width,height,elements});
  if (!data) throw new Error("SVG 中没有可导入的图元，原拟合结果未修改。");
  return data;
}
