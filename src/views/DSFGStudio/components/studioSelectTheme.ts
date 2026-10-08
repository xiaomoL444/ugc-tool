import type { SelectProps, TreeSelectProps } from "naive-ui";

const selection = {
  borderRadius: "9px", color: "#fff", colorActive: "#faf8ff", textColor: "#596780",
  border: "1px solid #ded9f0", borderHover: "1px solid #c6bdeb", borderActive: "1px solid #887bd7",
  borderFocus: "1px solid #887bd7", boxShadowFocus: "0 0 0 2px #887bd733", boxShadowActive: "0 0 0 2px #887bd733",
  caretColor: "#6a5acd", arrowColor: "#718097", fontSizeMedium: "12px", heightMedium: "36px",
};
const shadow = "0 12px 36px #35276c29";
export const studioSelectTheme: NonNullable<SelectProps["themeOverrides"]> = {
  menuBoxShadow: shadow,
  peers: {
    InternalSelection: selection,
    InternalSelectMenu: {
      borderRadius: "13px", color: "#fff", optionTextColor: "#555b70", optionTextColorActive: "#6a5acd",
      optionCheckColor: "#6a5acd", optionColorPending: "#f0edff", optionColorActive: "#f6f3ff",
      optionColorActivePending: "#f0edff", paddingMedium: "7px", optionPaddingMedium: "9px 12px",
      optionFontSizeMedium: "13px", optionHeightMedium: "38px",
    },
  },
};
export const studioTreeSelectTheme: NonNullable<TreeSelectProps["themeOverrides"]> = {
  menuBorderRadius: "13px", menuColor: "#fff", menuBoxShadow: shadow, menuPadding: "7px",
  peers: {
    InternalSelection: selection,
    Tree: { nodeBorderRadius: "8px", nodeColorHover: "#f0edff", nodeColorActive: "#eee8ff", nodeColorPressed: "#eee8ff", nodeTextColor: "#555b70" },
  },
};
