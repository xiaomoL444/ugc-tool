import { toast } from "vue-sonner";

export function Clipboard(str: string) {
  navigator.clipboard
    .writeText(str)
    .then(() => {
      const length = 50;
      const text = str.length > length ? str.substring(0, length) + "..." : str;
      toast.success(` ${text} 复制成功`);
    })
    .catch((err) => {
      toast.error("复制失败" + err);
    });
}