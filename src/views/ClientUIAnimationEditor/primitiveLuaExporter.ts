import { buildPrimitiveParameters } from "./primitiveData";
import type { PrimitiveImageResource } from "./primitiveResources";
import type { UINode } from "./types";

export const PRIMITIVE_PROJECT_SCHEMA = "UGCTools.PrimitiveProject@3";
export const PRIMITIVE_PROJECT_VERSION = 3;
const SHAPE_TYPES = { rectangle: 0, ellipse: 1, triangle: 2 } as const;

function luaString(value: string) {
  return '"' + value.replace(/[\\"\x00-\x1f\x7f]/g, char => char === '\\' ? '\\\\' : char === '"' ? '\\"' : `\\${char.charCodeAt(0).toString().padStart(3, '0')}`) + '"';
}

export function buildPrimitiveProjectLua(options: {
  projectName: string; rootNodeId: string; nodes: UINode[]; resources: PrimitiveImageResource[];
}) {
  const byId = new Map(options.nodes.map(node => [node.id, node]));
  if (byId.size !== options.nodes.length) throw new Error("控件 ID 重复，无法确定导出层级。");
  const root = byId.get(options.rootNodeId);
  if (!root) throw new Error("请先选择一个控件作为图元项目的导出根节点。");
  const resources = new Map(options.resources.map(asset => [asset.id, asset]));
  const siblings = new Map<string | null, Map<string, number>>();
  for (const node of options.nodes) {
    const names = siblings.get(node.parentId) ?? new Map<string, number>();
    names.set(node.name, (names.get(node.name) ?? 0) + 1); siblings.set(node.parentId, names);
  }
  const warnings: string[] = [], groups: string[] = [];
  let elementCount = 0, targetCount = 0;
  for (const node of options.nodes) {
    if (node.type !== "primitive") continue;
    const chain: UINode[] = [], seen = new Set<string>();
    let current: UINode | undefined = node;
    while (current && current.id !== root.id && !seen.has(current.id)) {
      seen.add(current.id); chain.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    if (current?.id !== root.id) continue;
    const resource = resources.get(node.properties.imageResourceId ?? "");
    if (!resource?.fitData) { warnings.push(`「${chain.map(item => item.name).join('/') || root.name}」没有拟合结果，已跳过。`); continue; }
    for (const item of chain) {
      if (!item.name.trim() || /[\/\\\x00-\x1f\x7f]/.test(item.name) || item.name === "." || item.name === "..") {
        throw new Error(`控件「${item.name}」的名称不能用于路径，请移除斜杠、控制字符或空名称。`);
      }
      if (siblings.get(item.parentId)?.get(item.name) !== 1) throw new Error(`「${item.name}」存在同级重名控件，请改名后导出，避免路径指向错误容器。`);
    }
    const path = chain.map(item => item.name).join('/');
    const parameters = buildPrimitiveParameters(resource.fitData, node.name, node.width, node.height);
    targetCount++;
    const state = `${node.visible === false ? 'visible=false,' : ''}${node.canControllerFocus ? 'focus=true,' : ''}`;
    groups.push(`  {path=${luaString(path)},${state}elements={`);
    for (const element of parameters.elements) {
      const { position, size, rotation, color } = element;
      const row = [SHAPE_TYPES[element.type], element.imageType === 'basic' ? 0 : 1, position.x, position.y, size.width, size.height, rotation.z, color.r, color.g, color.b, Math.round(color.a * 255)];
      groups.push(`    {${row.join(',')}},`);
      elementCount++;
    }
    groups.push("  }},");
  }
  if (!elementCount) throw new Error("所选控件及其子级没有可导出的图元，请先在图片资源面板生成图元。");
  const filePart = `${options.projectName}-${root.name}`.trim().replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_') || 'PrimitiveProject';
  const lines = [
    '-- PrimitiveImageLib v3: create(root,data,imagePrefabIndex); visible/focus default:true/false',
    '-- path 为空时表示传入的 root 本身；请使用支持根图元的新版 PrimitiveImageLib。',
    '-- type,mode,x,y,w,h,rotation,r,g,b,a; type:0矩形/1椭圆/2三角形; mode:0Basic/1Stretch; RGBA:0–255',
    ...warnings.map(warning => `-- 提示：${warning.replace(/[\r\n]/g, ' ')}`),
    `return {v=${PRIMITIVE_PROJECT_VERSION},groups={`, ...groups, '}}', '',
  ];
  return { code: lines.join('\n'), fileName: `${filePart}-PrimitiveData.lua`, warnings, elementCount, targetCount };
}
