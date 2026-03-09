export type NodeType = "工作区" | "高级结构体" | "自定义变量";

export async function ensureNode(ndoeType: NodeType): Promise<boolean> {
  switch (ndoeType) {
    case "工作区":
      break;
    case "自定义变量":
      break;
    case "高级结构体":
      break;
  }
  return true;
}
