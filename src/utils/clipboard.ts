import { toast } from "vue-sonner";
import { i18n } from "@/i18n";

export function Clipboard(str: string) {
  navigator.clipboard
    .writeText(str)
    .then(() => {
      const length = 50;
      const text = str.length > length ? str.substring(0, length) + "..." : str;
      toast.success(i18n.global.t("common.copySuccess", { text }));
    })
    .catch((err) => {
      toast.error(i18n.global.t("common.copyFailed", { error: String(err) }));
    });
}
