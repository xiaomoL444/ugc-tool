export type ParamChange =
  | { type: "set"; path: string; value: any }
  | {
      type: "add";
      path: string; //这个路径不包括列表索引
      index: number;
      value: any;
    }
  | {
      type: "delete";
      path: string; //这个路径不包括列表索引
      index: number;
    }
  | { type: "swap"; pathA: string; pathB: string };
