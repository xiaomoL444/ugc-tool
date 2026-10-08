import { isVNode, type VNode } from "vue";

export interface StudioFieldOption { value: unknown; label: string; disabled: boolean; group?: string }
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (isVNode(node)) return text(node.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
/** Read option declarations without rendering a browser-native select; preserve raw Vue-bound values. */
export function studioSelectOptions(nodes: readonly VNode[]): StudioFieldOption[] {
  const result: StudioFieldOption[] = [];
  function visit(node: unknown, group?: string, disabled = false) {
    if (Array.isArray(node)) { node.forEach(child => visit(child, group, disabled)); return; }
    if (!isVNode(node)) return;
    const attrs = node.props ?? {};
    const blocked = disabled || attrs.disabled === "" || attrs.disabled === true;
    if (node.type === "option") {
      const label = String(attrs.label ?? text(node.children)).trim();
      result.push({ value: Object.prototype.hasOwnProperty.call(attrs, "value") ? attrs.value : label, label, disabled: blocked, group });
    } else if (node.type === "optgroup") visit(node.children, String(attrs.label ?? ""), blocked);
    else if (Array.isArray(node.children)) visit(node.children, group, disabled);
  }
  visit(nodes);
  return result;
}
