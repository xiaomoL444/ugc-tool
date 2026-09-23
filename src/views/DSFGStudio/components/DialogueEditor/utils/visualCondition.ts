import type { ConditionValue, ConditionGroup, VisualCondition, ComparisonOperator } from "../types/VisualCondition";

// Matches the user's Lib/Expression.lua protocol; this module never executes expressions.
const scopes = { player: "ps", character: "as", level: "lv" } as const;
const operators = ["==", "!=", ">=", ">", "<=", "<"];
const numeric = /^[+-]?(?:0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/;
const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\x07", "0": "\0", "\\": "\\", '"': '"', "'": "'" };
function fail(message: string): never { throw new Error(message); }
function numberValue(text: string) {
  if (!numeric.test(text)) fail("固定数字格式不正确。");
  const unsigned = text.replace(/^[+-]/, "");
  if (/^(?:0[xX][\da-fA-F]+|\d+)$/.test(unsigned)) {
    if (BigInt(unsigned) > BigInt("9223372036854775807")) fail("固定整数超出游戏端支持的范围。");
  } else if (!Number.isFinite(Number(text))) fail("固定数字必须是有限数。");
  return text;
}
function valueText(value: ConditionValue): string {
  if (value.source === "number") return numberValue(value.value.trim());
  if (value.source === "boolean") {
    if (value.value !== "true" && value.value !== "false") fail("请选择真或假。");
    return value.value;
  }
  if (value.source === "text") {
    const encoded = value.value.replace(/[\\"\n\r\t\b\f\v\x07\0]/g, char => {
      const entry = Object.entries(escapes).find(([, decoded]) => decoded === char)!;
      return `\\${entry[0]}`;
    });
    return `"${encoded}"`;
  }
  const scope = scopes[value.source];
  if (!scope) fail("不支持的变量来源。");
  const path = value.value.trim();
  if (!path || /[{}\r\n]/.test(path) || path.split(".").some(part => !part.trim())) {
    fail("请填写变量名或字段路径，例如：背包.金币；动态占位符请使用表达式模式。");
  }
  return `{1:${scope}.${path}}`;
}
export function serializeVisualCondition(root: VisualCondition): string {
  let tokens = 0;
  function visit(node: VisualCondition, nesting: number): { text: string; depth: number } {
    if (nesting > 32) fail("条件分组过深，请减少括号层级。");
    if (node.kind === "comparison") {
      if (!operators.includes(node.operator)) fail("不支持的比较关系。");
      if (!["==", "!="].includes(node.operator) && [node.left, node.right].some(value => value.source === "text")) {
        fail("固定文本只支持等于或不等于比较。");
      }
      const left = valueText(node.left), right = valueText(node.right);
      tokens += 3 + Number(/^[+-]/.test(left)) + Number(/^[+-]/.test(right));
      return { text: `${left} ${node.operator} ${right}`, depth: 3 };
    }
    if (!node.children.length) fail("条件组不能为空，请添加条件或删除空组。");
    if (node.operator !== "and" && node.operator !== "or") fail("请选择且或或。");
    const children = node.children.map(child => visit(child, nesting + 1));
    const depth = children.slice(1).reduce((depth, child) => Math.max(depth, child.depth) + 1, children[0].depth);
    if (depth + nesting > 60) fail("条件组合过长，请拆分为多个分支。");
    tokens += (nesting > 0 ? 2 : 0) + children.length - 1;
    const text = children.map(child => child.text).join(node.operator === "and" ? " && " : " || ");
    return { text: nesting > 0 ? `(${text})` : text, depth };
  }
  const result = visit(root, 0).text;
  if (tokens > 1024) fail("条件超过游戏端 1024 个词元限制。");
  if (new TextEncoder().encode(result).length > 8192) fail("条件超过游戏端 8192 字节限制。");
  return result;
}

/** Parse only the editable subset. Unknown syntax is left untouched in source mode. */
export function parseVisualCondition(expression: string): ConditionGroup | null {
  if (!expression.trim() || new TextEncoder().encode(expression).length > 8192) return null;
  let position = 0, nesting = 0;
  const skip = () => { while (/\s/.test(expression[position] ?? "") && position < expression.length) position++; };
  function consume(text: string) {
    skip();
    if (!expression.startsWith(text, position)) return false;
    position += text.length; return true;
  }
  function operand(): ConditionValue {
    skip();
    const rest = expression.slice(position);
    const variable = /^\{1:(ps|as|lv)\.([^{}]+)\}/.exec(rest);
    if (variable) {
      position += variable[0].length;
      return { source: variable[1] === "ps" ? "player" : variable[1] === "as" ? "character" : "level", value: variable[2] };
    }
    const quote = expression[position];
    if (quote === '"' || quote === "'") {
      position++;
      let value = "", closed = false;
      while (position < expression.length) {
        const char = expression[position++];
        if (char === quote) { closed = true; break; }
        if (char === "\n" || char === "\r") fail("字符串包含未转义换行。");
        if (char === "\\") {
          const escaped = escapes[expression[position++]];
          if (escaped === undefined) fail("未知转义。");
          value += escaped;
        } else value += char;
      }
      if (!closed) fail("字符串未结束。");
      return { source: "text", value };
    }
    const bool = /^(true|false)\b/.exec(rest);
    if (bool) { position += bool[0].length; return { source: "boolean", value: bool[0] }; }
    const number = /^[+-]?(?:0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(rest);
    if (number) { position += number[0].length; return { source: "number", value: number[0] }; }
    return fail("此表达式需要使用原文模式。");
  }
  function atom(): VisualCondition {
    if (++nesting > 32) fail("分组过深。");
    let node: VisualCondition;
    if (consume("(")) {
      node = logical("or");
      if (!consume(")")) fail("缺少右括号。");
      if (node.kind !== "group") node = { id: crypto.randomUUID(), kind: "group", operator: "and", children: [node] };
    } else {
      const left = operand();
      const operator = operators.find(consume) as ComparisonOperator | undefined;
      if (!operator) fail("需要比较运算符。");
      node = { id: crypto.randomUUID(), kind: "comparison", left, operator, right: operand() };
    }
    nesting--; return node;
  }
  function logical(operator: "and" | "or"): VisualCondition {
    const next = () => operator === "or" ? logical("and") : atom();
    const children = [next()];
    while (consume(operator === "and" ? "&&" : "||")) children.push(next());
    return children.length === 1 ? children[0] : { id: crypto.randomUUID(), kind: "group", operator, children };
  }
  try {
    const root = logical("or"); skip();
    if (position !== expression.length) return null;
    serializeVisualCondition(root);
    return root.kind === "group" ? root : { id: crypto.randomUUID(), kind: "group", operator: "and", children: [root] };
  } catch { return null; }
}
