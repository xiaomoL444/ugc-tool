export interface AppRoute {
  path: string;
  name: string;
  title: string;
  description?: string;
  icon?: string;
  titleColor?: string;
  children?: AppRoute[];
}

export const appRoutes: AppRoute[] = [
  {
    path: "/StructViewer",
    name: "StructViewer",
    title: "结构体编辑器",
    description:
      "可在线编辑千星奇域「月之八」（6.7）版本之前的结构体变量与字典变量",
  },
  {
    path: "/SoundEffectPlayer",
    name: "SoundEffectPlayer",
    title: "音效播放器",
    description: "可在线播放千星奇域7.0版本之前的音效",
  },  
  {
    path: "/EffectPlayer",
    name: "EffectPlayer",
    title: "特效播放器",
    description: "还不能在线播放千星奇域7.0版本之前的特效，只做了预览图片",
  },
  {
    path: "/TextGradient",
    name: "TextGradient",
    title: "文本渐变器",
    description:
      "可生成支持千星奇域（unity）富文本格式的颜色渐变文本与流光效果",
  },
  {
    path: "/PixelArt",
    name: "PixelArt",
    title: "图片转像素画",
    description:
      "支持将图片转成像素画文本或以千星奇域字符串列表结构体变量形式的JSON",
  },
    {
    path: "/BgmPlayer",
    name: "BgmPlayer",
    title: "BGM播放器",
    description:
      "可在线播放千星奇域「月之八」（6.7）版本之前的BGM",
  },   
   {
    path: "/MiniMapMapper",
    name: "MiniMapMapper",
    title: "小地图场景映射计算",
    description:
      `小地图场景映射计算
      
      ————无边天下第一制作提供`,
  },
];
