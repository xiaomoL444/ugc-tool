interface ColorStyle {
  id: ColorStyleType;
  label: string;
}

type ColorStyleType = "normal" | "ColorFlow1"| "ColorFlow2";

interface SizeStyle {
  id: SizeStyleType;
  label: string;
}

type SizeStyleType = "normal"|'Jump1';
