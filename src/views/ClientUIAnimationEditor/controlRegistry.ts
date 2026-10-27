import { t } from "../../i18n";
import type { ColorRGBA, ControlPropertiesMap, ControlType } from "./types";

export interface PropertyOption { label: string; value: string }
export type ControlPropertyFieldKind = "text" | "textarea" | "number" | "boolean" | "nullableBoolean" | "select" | "color";
export interface ControlPropertyField {
  key: string;
  label: string;
  kind: ControlPropertyFieldKind;
  options?: PropertyOption[];
  allowUnset?: boolean;
  min?: number;
  max?: number;
  step?: number;
  runtimeReadOnly?: boolean;
  tweenable?: boolean;
  description?: string;
}

export interface ControlDefinition<T extends ControlType> {
  type: T;
  label: string;
  icon: string;
  description: string;
  runtimeClass: string;
  editorOnly?: boolean;
  defaultName: string;
  defaultWidth: number;
  defaultHeight: number;
  fields: ControlPropertyField[];
  createProperties: () => ControlPropertiesMap[T];
}

const color = (hex: string, a = 1): ColorRGBA => ({ r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16), a });
const option = (value: string, label: string, params?: Record<string, unknown>): PropertyOption => ({
  value,
  get label() { return label.startsWith("clientUIAnimationEditor.") ? t(label, params ?? {}) : label; },
});
const nullableBoolean = (key: string, label: string, runtimeReadOnly = false): ControlPropertyField => ({ key, label, kind: "nullableBoolean", runtimeReadOnly });
const boolean = (key: string, label: string): ControlPropertyField => ({ key, label, kind: "boolean" });
const number = (key: string, label: string, config: Partial<ControlPropertyField> = {}): ControlPropertyField => ({ key, label, kind: "number", ...config });
const select = (key: string, label: string, options: PropertyOption[], config: Partial<ControlPropertyField> = {}): ControlPropertyField => ({ key, label, kind: "select", options, ...config });
const colorField = (key: string, label: string, tweenable = true): ControlPropertyField => ({ key, label, kind: "color", tweenable });

const textFields: ControlPropertyField[] = [
  { key: "text", label: "clientUIAnimationEditor.ui.controls.textContent", kind: "textarea" },
  number("fontSize", "clientUIAnimationEditor.ui.controls.fontSize", { min: 1, step: 1, tweenable: true }),
  colorField("fontColor", "clientUIAnimationEditor.ui.controls.text.color"),
  colorField("bgColor", "clientUIAnimationEditor.ui.controls.backgroundColor"),
  boolean("enableOutline", "clientUIAnimationEditor.ui.controls.enableTextOutline"),
  colorField("outlineColor", "clientUIAnimationEditor.ui.controls.outlineColor"),
  select("horizontalAlignment", "clientUIAnimationEditor.ui.controls.horizontalAlignment", [option("left", "clientUIAnimationEditor.ui.controls.left"), option("middle", "clientUIAnimationEditor.ui.controls.text.center"), option("right", "clientUIAnimationEditor.ui.controls.right")]),
  select("verticalAlignment", "clientUIAnimationEditor.ui.controls.text.verticalAlignment", [option("top", "clientUIAnimationEditor.ui.controls.top"), option("middle", "clientUIAnimationEditor.ui.controls.text.center"), option("bottom", "clientUIAnimationEditor.ui.controls.anchor.bottom")]),
  boolean("adaptiveFontSize", "clientUIAnimationEditor.ui.controls.text.adaptiveFontSize"),
  number("minimumFontSize", "clientUIAnimationEditor.ui.controls.text.minimumFontSize", { min: 1, step: 1 }),
];

const keyboardKeyOptions = [
  ...Array.from({ length: 43 }, (_, index) => option(`CraftspersonKey${index + 1}`, "clientUIAnimationEditor.ui.controls.craftspersonKey", { index: index + 1 })),
  ...["MoveForwardKey", "MoveBackwardKey", "MoveLeftKey", "MoveRightKey", "SwitchToWalkOrRunKey", "SprintKey", "JumpKey", "DropKey", "OpenShortcutWheelKey", "InteractKey", "NormalAttackKey", "CharacterSkill1Key", "CharacterSkill2Key", "CharacterSkill3Key", "CharacterSkill4Key", "None"].map((name) => option(name, name)),
];
const controllerKeyOptions = [
  ...Array.from({ length: 14 }, (_, index) => option(`CraftspersonKey${index + 1}`, "clientUIAnimationEditor.ui.controls.craftspersonKey", { index: index + 1 })),
  ...["SprintKey", "JumpKey", "InteractKey", "NormalAttackKey", "CharacterSkill1Key", "CharacterSkill2Key", "CharacterSkill3Key", "CharacterSkill4Key", "MenuConfirmKey", "MenuBackKey", "None"].map((name) => option(name, name)),
];

export const controlRegistry: { [T in ControlType]: ControlDefinition<T> } = {
  primitive: {
    type: "primitive", label: "clientUIAnimationEditor.ui.controls.primitive.label", icon: "▧", description: "clientUIAnimationEditor.ui.controls.primitive.description", runtimeClass: "ClientUIContainerControl", editorOnly: true,
    defaultName: "Primitive", defaultWidth: 150, defaultHeight: 150,
    fields: [{ key: "imageResourceId", label: "clientUIAnimationEditor.ui.primitiveResources.title", kind: "text" }], createProperties: () => ({ imageUrl: "", imageResourceId: null, previewMode: "image" }),
  },
  container: {
    type: "container", label: "clientUIAnimationEditor.ui.controls.containerNode", icon: "▣", description: "clientUIAnimationEditor.ui.controls.container.description", runtimeClass: "ClientUIContainerControl", defaultName: "Container", defaultWidth: 280, defaultHeight: 180,
    fields: [boolean("isolateNavigation", "clientUIAnimationEditor.ui.controls.container.isolateControllerNavigation"), boolean("disableKeyEventPassthrough", "clientUIAnimationEditor.ui.controls.container.blockKeyPassthrough"), boolean("disableCursorEventPassthrough", "clientUIAnimationEditor.ui.controls.blockClickPassthrough"), boolean("showCursor", "clientUIAnimationEditor.ui.controls.container.showPersistentCursor")],
    createProperties: () => ({ isolateNavigation: false, disableKeyEventPassthrough: false, disableCursorEventPassthrough: false, showCursor: false }),
  },
  image: {
    type: "image", label: "clientUIAnimationEditor.ui.controls.image.name", icon: "▧", description: "clientUIAnimationEditor.ui.controls.image.description", runtimeClass: "ClientUIImageControl", defaultName: "Image", defaultWidth: 150, defaultHeight: 150,
    fields: [
      select("imageSource", "clientUIAnimationEditor.ui.controls.imageSource", [option("staticReference", "clientUIAnimationEditor.ui.controls.staticReference"), option("item", "clientUIAnimationEditor.ui.controls.image.item"), option("equipment", "clientUIAnimationEditor.ui.controls.equipment"), option("skill", "clientUIAnimationEditor.ui.controls.skill"), option("unitStatus", "clientUIAnimationEditor.ui.controls.image.unitStatus"), option("faction", "clientUIAnimationEditor.ui.controls.image.faction"), option("currency", "clientUIAnimationEditor.ui.controls.currency"), option("prefab", "clientUIAnimationEditor.ui.controls.component")], { runtimeReadOnly: true }),
      number("imageId", "clientUIAnimationEditor.ui.imageControls.imageId", { step: 1, runtimeReadOnly: true }), colorField("imageColor", "clientUIAnimationEditor.ui.imageControls.imageColor"), select("imageType", "clientUIAnimationEditor.ui.imageControls.imageType", [option("basic", "clientUIAnimationEditor.ui.properties.basicTab"), option("stretch", "clientUIAnimationEditor.ui.controls.stretch")]),
      boolean("enableMask", "clientUIAnimationEditor.ui.controls.image.enableMask"), boolean("enableSoftEdge", "clientUIAnimationEditor.ui.controls.image.enableFeathering"), select("softEdgeMode", "clientUIAnimationEditor.ui.controls.featherMode", [option("pixel", "clientUIAnimationEditor.ui.controls.image.softEdgePixels"), option("percentage", "clientUIAnimationEditor.ui.controls.proportional")]),
      number("softEdgeWidthX", "clientUIAnimationEditor.ui.controls.image.horizontalFeatherWidth", { min: 0, tweenable: true }), number("softEdgeWidthY", "clientUIAnimationEditor.ui.controls.verticalFeatherWidth", { min: 0, tweenable: true }), number("horizontalSoftRange", "clientUIAnimationEditor.ui.imageControls.horizontalSoftRange", { min: 0, max: 100, step: 0.01, tweenable: true }), number("verticalSoftRange", "clientUIAnimationEditor.ui.controls.image.verticalFeatherRange", { min: 0, max: 100, step: 0.01, tweenable: true }),
      boolean("reverseMaskArea", "clientUIAnimationEditor.ui.controls.invertMaskRegion"), boolean("enableFill", "clientUIAnimationEditor.ui.controls.image.fillByProgress"), select("fillType", "clientUIAnimationEditor.ui.controls.image.fillMethod", [option("unused", "clientUIAnimationEditor.ui.controls.image.fillUnused"), option("horizontal", "clientUIAnimationEditor.ui.controls.horizontal"), option("vertical", "clientUIAnimationEditor.ui.controls.vertical"), option("radial90", "clientUIAnimationEditor.ui.imageControls.radialQuarter"), option("radial180", "clientUIAnimationEditor.ui.controls.image.radialHalf"), option("radial360", "clientUIAnimationEditor.ui.controls.radialFullCircle")]), boolean("fillClockwise", "clientUIAnimationEditor.ui.controls.clockwise"),
      select("fillHorizontalType", "clientUIAnimationEditor.ui.controls.horizontalFillDirection", [option("left", "clientUIAnimationEditor.ui.controls.fillFromLeft"), option("right", "clientUIAnimationEditor.ui.imageControls.fillFromRight")]), select("fillVerticalType", "clientUIAnimationEditor.ui.imageControls.verticalFillDirection", [option("top", "clientUIAnimationEditor.ui.controls.fillFromTop"), option("bottom", "clientUIAnimationEditor.ui.controls.image.fillFromBottom")]),
      select("fillRadial90Type", "clientUIAnimationEditor.ui.controls.image.radialQuarterOrigin", [option("bottomLeft", "clientUIAnimationEditor.ui.controls.anchor.bottomLeft"), option("topLeft", "clientUIAnimationEditor.ui.canvas.anchorTopLeft"), option("topRight", "clientUIAnimationEditor.ui.controls.anchor.topRight"), option("bottomRight", "clientUIAnimationEditor.ui.controls.bottomRight")]), select("fillRadialType", "clientUIAnimationEditor.ui.controls.image.radialOrigin", [option("bottom", "clientUIAnimationEditor.ui.controls.anchor.bottom"), option("left", "clientUIAnimationEditor.ui.canvas.leftSide"), option("top", "clientUIAnimationEditor.ui.controls.top"), option("right", "clientUIAnimationEditor.ui.canvas.rightSide")]),
      number("fillAmount", "clientUIAnimationEditor.ui.controls.image.fillAmount", { min: 0, max: 1, step: 0.01, tweenable: true }),
    ],
    createProperties: () => ({ imageSource: "staticReference", imageId: 100001, imageColor: color("#ffffff"), imageType: "basic", enableMask: false, enableSoftEdge: false, softEdgeMode: "pixel", softEdgeWidthX: null, softEdgeWidthY: null, horizontalSoftRange: null, verticalSoftRange: null, reverseMaskArea: false, enableFill: false, fillType: "unused", fillClockwise: true, fillHorizontalType: "left", fillVerticalType: "top", fillRadial90Type: "bottomLeft", fillRadialType: "bottom", fillAmount: null }),
  },
  text: {
    type: "text", label: "clientUIAnimationEditor.ui.controls.textBox", icon: "T", description: "clientUIAnimationEditor.ui.controls.text.description", runtimeClass: "ClientUITextBoxControl", defaultName: "TextBox", defaultWidth: 360, defaultHeight: 90, fields: textFields,
    createProperties: () => ({ text: "", fontSize: 20, fontColor: color("#ffffff"), bgColor: color("#ffffff", 0), enableOutline: false, outlineColor: color("#333333", 0.2), horizontalAlignment: "middle", verticalAlignment: "middle", adaptiveFontSize: false, minimumFontSize: 10 }),
  },
  textWindow: {
    type: "textWindow", label: "clientUIAnimationEditor.ui.controls.textWindow", icon: "▤", description: "clientUIAnimationEditor.ui.controls.scrollableTextHint", runtimeClass: "ClientUITextWindowControl", defaultName: "TextWindow", defaultWidth: 420, defaultHeight: 240, fields: [boolean("interactable", "clientUIAnimationEditor.ui.controls.allowInteraction"), boolean("showScrollBar", "clientUIAnimationEditor.ui.controls.showScrollbar"), ...textFields],
    createProperties: () => ({ interactable: true, showScrollBar: true, text: "", fontSize: 20, fontColor: color("#ffffff"), bgColor: color("#ffffff", 0), enableOutline: false, outlineColor: color("#333333", 0.2), horizontalAlignment: "left", verticalAlignment: "top", adaptiveFontSize: false, minimumFontSize: 10 }),
  },
  presetButton: {
    type: "presetButton", label: "clientUIAnimationEditor.ui.controls.presetButton.name", icon: "◉", description: "clientUIAnimationEditor.ui.controls.presetButton.description", runtimeClass: "ClientUIPresetButtonControl", defaultName: "PresetButton", defaultWidth: 220, defaultHeight: 72,
    fields: [boolean("interactable", "clientUIAnimationEditor.ui.controls.allowInteraction"), number("clickAudioId", "clientUIAnimationEditor.ui.controls.button.clickSoundId", { step: 1 }), boolean("raycastTarget", "clientUIAnimationEditor.ui.controls.button.cursorRaycast")], createProperties: () => ({ interactable: true, clickAudioId: null, raycastTarget: true }),
  },
  cursorEventArea: {
    type: "cursorEventArea", label: "clientUIAnimationEditor.ui.controls.cursorHitArea", icon: "⌁", description: "clientUIAnimationEditor.ui.controls.cursorEventArea.description", runtimeClass: "ClientUICursorEventAreaControl", defaultName: "CursorEventArea", defaultWidth: 240, defaultHeight: 140,
    fields: [boolean("raycastTarget", "clientUIAnimationEditor.ui.controls.button.cursorRaycast")], createProperties: () => ({ raycastTarget: true }),
  },
  gridScroller: {
    type: "gridScroller", label: "clientUIAnimationEditor.ui.controls.grid.name", icon: "▦", description: "clientUIAnimationEditor.ui.controls.reusableScrollListHint", runtimeClass: "ClientUIGridScrollerControl", defaultName: "GridScroller", defaultWidth: 420, defaultHeight: 300,
    fields: [number("itemCount", "clientUIAnimationEditor.ui.controls.grid.itemCount", { step: 1, min: 0, runtimeReadOnly: true }), number("itemPrefabIndex", "clientUIAnimationEditor.ui.controls.grid.itemPrefabIndex", { step: 1 }), boolean("raycastTarget", "clientUIAnimationEditor.ui.controls.button.cursorRaycast"), boolean("showScrollBar", "clientUIAnimationEditor.ui.controls.showScrollbar"), boolean("interactable", "clientUIAnimationEditor.ui.controls.allowInteraction"), select("scrollDirection", "clientUIAnimationEditor.ui.controls.grid.scrollDirection", [option("horizontal", "clientUIAnimationEditor.ui.controls.horizontal"), option("vertical", "clientUIAnimationEditor.ui.controls.vertical")], { runtimeReadOnly: true }), select("layoutConstraint", "clientUIAnimationEditor.ui.controls.layoutConstraints", [option("autoWrap", "clientUIAnimationEditor.ui.controls.autoWrap"), option("fixed", "clientUIAnimationEditor.ui.controls.grid.fixedRowsColumns")], { runtimeReadOnly: true }), number("layoutConstraintFixedCount", "clientUIAnimationEditor.ui.controls.fixedGridDimension", { step: 1, min: 0, runtimeReadOnly: true }), number("scrollProgress", "clientUIAnimationEditor.ui.controls.scrollProgress", { min: 0, max: 1, step: 0.01, tweenable: true })],
    createProperties: () => ({ itemCount: null, itemPrefabIndex: null, raycastTarget: true, showScrollBar: true, interactable: true, scrollDirection: null, layoutConstraint: null, layoutConstraintFixedCount: null, scrollProgress: null }),
  },
  keyHint: {
    type: "keyHint", label: "clientUIAnimationEditor.ui.controls.keyHint.label", icon: "⌨", description: "clientUIAnimationEditor.ui.controls.inputDeviceKeyHint", runtimeClass: "ClientUIKeyHintControl", defaultName: "KeyHint", defaultWidth: 180, defaultHeight: 64,
    fields: [select("keyboardKeyCode", "clientUIAnimationEditor.ui.controls.keyboardMouseKeys", keyboardKeyOptions), select("controllerKeyCode", "clientUIAnimationEditor.ui.controls.keyHint.controllerButton", controllerKeyOptions)], createProperties: () => ({ keyboardKeyCode: "None", controllerKeyCode: "None" }),
  },
  uiAnimation: {
    type: "uiAnimation", label: "clientUIAnimationEditor.ui.controls.uiAnimation", icon: "✦", description: "clientUIAnimationEditor.ui.controls.playUiAnimation", runtimeClass: "ClientUIAnimationControl", defaultName: "UIAnimation", defaultWidth: 100, defaultHeight: 100,
    fields: [number("animationId", "clientUIAnimationEditor.ui.controls.effectId", { step: 1 }), boolean("playSoundEffect", "clientUIAnimationEditor.ui.controls.animation.playSound"), select("layer", "clientUIAnimationEditor.ui.controls.animationLayer", [option("aboveAllControls", "clientUIAnimationEditor.ui.controls.animation.layerAboveAll"), option("belowAllControls", "clientUIAnimationEditor.ui.controls.behindAllControls")], { allowUnset: false })], createProperties: () => ({ animationId: null, playSoundEffect: true, layer: "aboveAllControls" }),
  },
  fullscreenAnimation: {
    type: "fullscreenAnimation", label: "clientUIAnimationEditor.ui.controls.fullscreenAnimation", icon: "✧", description: "clientUIAnimationEditor.ui.controls.fullscreenAnimationHint", runtimeClass: "ClientUIFullscreenAnimationControl", defaultName: "FullscreenAnimation", defaultWidth: 1600, defaultHeight: 900,
    fields: [number("animationId", "clientUIAnimationEditor.ui.controls.effectId", { step: 1 }), boolean("playSoundEffect", "clientUIAnimationEditor.ui.controls.animation.playSound")], createProperties: () => ({ animationId: null, playSoundEffect: true }),
  },
  reference: {
    type: "reference", label: "clientUIAnimationEditor.ui.controls.templateReference", icon: "↗", description: "clientUIAnimationEditor.ui.controls.configuredUiResourceHint", runtimeClass: "ClientUIReferenceControl", defaultName: "Reference", defaultWidth: 320, defaultHeight: 180,
    fields: [number("referencedPrefabIndex", "clientUIAnimationEditor.ui.imageControls.prefabIndex", { step: 1, runtimeReadOnly: true })], createProperties: () => ({ referencedPrefabIndex: null }),
  },
};

export const controlDefinitions = Object.values(controlRegistry) as Array<ControlDefinition<ControlType>>;
export function getControlDefinition<T extends ControlType>(type: T): ControlDefinition<T> { return controlRegistry[type]; }
export function createControlProperties<T extends ControlType>(type: T): ControlPropertiesMap[T] { return controlRegistry[type].createProperties(); }
