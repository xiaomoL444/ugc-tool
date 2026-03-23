import { Track } from "@/views/DSFGStudio/types/track";

/**
 * 对话的节点
 */
export interface DialogueNode {
  id: string; //这个节点的id
  nodeType: NodeType; //这个节点的类型
  dialogueType:DialogueType;//对话类型
  blocks: DialogueBlock[]; //对话块
  next?: string[]; //下一条的id，如果没有则为结束
}

/**
 * 节点类型：对话，选项卡，分支选择
 */
export type NodeType = "Dialogue" | "Option" | "Branch";

/**
 * 对话类型
 */
export type DialogueType = 'Stand'|'Walk'|'Shady'|'CG1'|'CG2'|'Center';
/**
 * 对话块
 */
export interface DialogueBlock {
  delay: number; //等待时间进行对话
  title: string; //对话的标题
  subtitle: string; //副标题
  value: DialogueValue[]; //每行的内容，包括文本、显示时间、节点图触发、运镜、动画等等
}

/**
 * 对话的内容
 */
export interface DialogueValue {
  content: string; //文本内容
  delay: number; //等待的时间
  delayMode: DelayMode; //等待的模式，等待N秒后才能点击，还是等待N秒后自动下一句
  nodeGraphEvent: string[]; //节点图事件触发
  anim: any; //动画（占位）
  cameraMovement: Track; //运镜（占位）
}

export type DelayMode = "Wait" | "Auto";
