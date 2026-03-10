interface config {
  colors: string[]; //颜色合集
  sizes: number[]; //缩放合集
  text: string; //文本
  option: option; //选项卡
  title: string; //文件名
}

interface option {
  isSetColor: boolean;
  isUse4bit: boolean;
  isUseSize: boolean;
  isSkipSpace: boolean;
}
