/** Parse exported Lua data without evaluating any Lua or JavaScript. */
export const MAX_LUA_DATA_LENGTH = 2 * 1024 * 1024;

const MAX_DEPTH = 64;
const MAX_ENTRIES = 100_000;
const MAX_TOKENS = 500_000;
const MAX_ARRAY_SLOTS = 100_000;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
]);

interface Token {
  kind: "identifier" | "number" | "string" | "symbol" | "eof";
  value: string | number;
  line: number;
  column: number;
}

function fail(message: string, position: { line: number; column: number }): never {
  throw new Error(`Lua Data 第 ${position.line} 行，第 ${position.column} 列：${message}`);
}

class Lexer {
  private offset = 0;
  private line = 1;
  private column = 1;
  private count = 0;

  constructor(private readonly source: string) {
    if (source.charCodeAt(0) === 0xfeff) this.offset = 1;
  }

  private advance(): string {
    const character = this.source[this.offset++];
    if (character === "\r" || (character === "\n" && this.source[this.offset - 2] !== "\r")) {
      this.line += 1;
      this.column = 1;
    } else if (character !== "\n") {
      this.column += 1;
    }
    return character;
  }

  private longBracket(): string | null {
    if (this.source[this.offset] !== "[") return null;
    let end = this.offset + 1;
    while (this.source[end] === "=") end += 1;
    return this.source[end] === "[" ? this.source.slice(this.offset, end + 1) : null;
  }

  private readLongBracket(open: string, position: Token, comment: boolean): string {
    for (let index = 0; index < open.length; index += 1) this.advance();
    // Lua removes a newline immediately following a long string's opening delimiter.
    if (this.source[this.offset] === "\r") {
      this.advance();
      if (this.source[this.offset] === "\n") this.advance();
    } else if (this.source[this.offset] === "\n") {
      this.advance();
    }
    const start = this.offset;
    const close = `]${open.slice(1, -1)}]`;
    const end = this.source.indexOf(close, start);
    if (end < 0) fail(comment ? "块注释未结束。" : "长字符串未结束。", position);
    while (this.offset < end + close.length) this.advance();
    return comment ? "" : this.source.slice(start, end).replace(/\r\n|\n\r|\r/g, "\n");
  }

  private readString(quote: string, position: Token): string {
    this.advance();
    const bytes: number[] = [];
    const encoder = new TextEncoder();
    const appendText = (value: string) => {
      for (const byte of encoder.encode(value)) bytes.push(byte);
    };
    let rawStart = this.offset;
    while (this.offset < this.source.length) {
      const character = this.source[this.offset];
      if (character === quote) {
        appendText(this.source.slice(rawStart, this.offset));
        this.advance();
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        } catch {
          fail("字符串包含无效的 UTF-8 字节。", position);
        }
      }
      if (character === "\n" || character === "\r") fail("字符串中的换行必须转义。", position);
      if (character !== "\\") {
        this.advance();
        continue;
      }
      appendText(this.source.slice(rawStart, this.offset));
      this.advance();
      if (this.offset >= this.source.length) fail("字符串未结束。", position);
      const escaped = this.advance();
      const escapes: Record<string, number> = {
        a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, "\\": 92, '"': 34, "'": 39,
      };
      if (Object.prototype.hasOwnProperty.call(escapes, escaped)) {
        bytes.push(escapes[escaped]);
      } else if (escaped === "\n" || escaped === "\r") {
        if (escaped === "\r" && this.source[this.offset] === "\n") this.advance();
        bytes.push(10);
      } else if (escaped === "z") {
        while (/\s/.test(this.source[this.offset] ?? "")) this.advance();
      } else if (/\d/.test(escaped)) {
        let digits = escaped;
        while (digits.length < 3 && /\d/.test(this.source[this.offset] ?? "")) digits += this.advance();
        const byte = Number(digits);
        if (byte > 255) fail("十进制字符串转义必须在 0–255 之间。", position);
        bytes.push(byte);
      } else if (escaped === "x") {
        const digits = this.source.slice(this.offset, this.offset + 2);
        if (!/^[\da-fA-F]{2}$/.test(digits)) fail("十六进制字符串转义需要两位数字。", position);
        this.advance();
        this.advance();
        bytes.push(parseInt(digits, 16));
      } else if (escaped === "u") {
        const match = /^\{([\da-fA-F]{1,8})\}/.exec(this.source.slice(this.offset, this.offset + 10));
        if (!match) fail("Unicode 字符串转义格式应为 \\u{十六进制码点}。", position);
        const codePoint = parseInt(match[1], 16);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          fail("Unicode 字符串转义码点无效。", position);
        }
        for (let index = 0; index < match[0].length; index += 1) this.advance();
        appendText(String.fromCodePoint(codePoint));
      } else {
        fail(`不支持的字符串转义 \\${escaped}。`, position);
      }
      rawStart = this.offset;
    }
    fail("字符串未结束。", position);
  }

  next(): Token {
    while (this.offset < this.source.length) {
      if (/\s/.test(this.source[this.offset])) {
        this.advance();
      } else if (this.source.startsWith("--", this.offset)) {
        const position: Token = { kind: "symbol", value: "--", line: this.line, column: this.column };
        this.advance();
        this.advance();
        const open = this.longBracket();
        if (open) this.readLongBracket(open, position, true);
        else while (this.offset < this.source.length && !/[\r\n]/.test(this.source[this.offset])) this.advance();
      } else {
        break;
      }
    }
    const token: Token = { kind: "eof", value: "", line: this.line, column: this.column };
    if (++this.count > MAX_TOKENS) fail("数据符号数量超过限制。", token);
    if (this.offset >= this.source.length) return token;
    const character = this.source[this.offset];
    if (character === '"' || character === "'") {
      return { ...token, kind: "string", value: this.readString(character, token) };
    }
    const open = this.longBracket();
    if (open) return { ...token, kind: "string", value: this.readLongBracket(open, token, false) };
    if (/[a-zA-Z_]/.test(character)) {
      const start = this.offset;
      do { this.advance(); } while (/[a-zA-Z_0-9]/.test(this.source[this.offset] ?? ""));
      return { ...token, kind: "identifier", value: this.source.slice(start, this.offset) };
    }
    if (/\d/.test(character) || (character === "." && /\d/.test(this.source[this.offset + 1] ?? ""))) {
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.offset));
      if (!match) fail("数字格式无效。", token);
      for (let index = 0; index < match[0].length; index += 1) this.advance();
      const value = Number(match[0]);
      if (!Number.isFinite(value)) fail("数字必须是有限值。", token);
      return { ...token, kind: "number", value };
    }
    if ("{}[]=,;-".includes(character)) {
      this.advance();
      return { ...token, kind: "symbol", value: character };
    }
    fail(`不支持的符号「${character}」；只能导入静态 Lua 数据表。`, token);
  }
}

class Parser {
  private current: Token;
  private entries = 0;
  private arraySlots = 0;

  constructor(private readonly lexer: Lexer) {
    this.current = lexer.next();
  }

  private is(value: string): boolean {
    return (this.current.kind === "symbol" || this.current.kind === "identifier") && this.current.value === value;
  }

  private take(): Token {
    const token = this.current;
    this.current = this.lexer.next();
    return token;
  }

  private expect(value: string): void {
    if (!this.is(value)) fail(`预期「${value}」。`, this.current);
    this.take();
  }

  private identifier(): string {
    if (this.current.kind !== "identifier" || KEYWORDS.has(String(this.current.value))) {
      fail("预期普通标识符。", this.current);
    }
    return String(this.take().value);
  }

  private number(): number {
    const negative = this.is("-");
    if (negative) this.take();
    if (this.current.kind !== "number") fail("预期数字字面量。", this.current);
    const value = Number(this.take().value);
    return negative ? -value : value;
  }

  private value(depth: number): unknown {
    if (this.is("{")) return this.table(depth + 1);
    if (this.current.kind === "string") return this.take().value;
    if (this.current.kind === "number" || this.is("-")) return this.number();
    if (this.is("true") || this.is("false") || this.is("nil")) {
      const value = this.take().value;
      return value === "nil" ? null : value === "true";
    }
    fail("只允许表、字符串、数字、boolean 或 nil 字面量。", this.current);
  }

  private table(depth: number): unknown {
    if (depth > MAX_DEPTH) fail(`表嵌套不能超过 ${MAX_DEPTH} 层。`, this.current);
    this.expect("{");
    const array: unknown[] = [];
    const object: Record<string, unknown> = Object.create(null);
    const keys = new Set<string | number>();
    let mode: "array" | "object" | undefined;
    let nextIndex = 1;
    while (!this.is("}")) {
      const position = this.current;
      if (++this.entries > MAX_ENTRIES) fail("数据条目数量超过限制。", position);
      let key: string | number;
      if (this.is("[")) {
        this.take();
        if (this.current.kind === "string") key = String(this.take().value);
        else key = this.number();
        this.expect("]");
        this.expect("=");
      } else if (this.current.kind === "identifier" && !["true", "false", "nil"].includes(String(this.current.value))) {
        key = this.identifier();
        this.expect("=");
      } else {
        key = nextIndex++;
      }
      const fieldMode = typeof key === "number" ? "array" : "object";
      if (mode && mode !== fieldMode) fail("同一张表不能混用数字键和命名键。", position);
      mode = fieldMode;
      if (typeof key === "number" && (!Number.isSafeInteger(key) || key < 1 || key > MAX_ARRAY_SLOTS)) {
        fail(`数字键必须是 1–${MAX_ARRAY_SLOTS} 之间的整数。`, position);
      }
      if (typeof key === "string" && UNSAFE_KEYS.has(key)) fail(`不允许使用键「${key}」。`, position);
      if (keys.has(key)) fail(`重复的表键「${key}」。`, position);
      keys.add(key);
      const value = this.value(depth);
      if (typeof key === "number") {
        const extraSlots = Math.max(0, key - array.length);
        this.arraySlots += extraSlots;
        if (this.arraySlots > MAX_ARRAY_SLOTS) fail("数组总长度超过限制。", position);
        // Preserve Lua nil and explicit numeric-key gaps so columns never shift.
        while (array.length < key) array.push(null);
        array[key - 1] = value;
      } else {
        object[key] = value;
      }
      if (this.is(",") || this.is(";")) this.take();
      else if (!this.is("}")) fail("表条目之间需要逗号或分号。", this.current);
    }
    this.expect("}");
    return mode === "object" ? object : array;
  }

  parse(): unknown {
    let variable: string | undefined;
    if (this.is("local")) {
      this.take();
      variable = this.identifier();
      this.expect("=");
    } else if (this.is("return")) {
      this.take();
    }
    if (!this.is("{")) fail("文件必须包含静态 Lua 数据表。", this.current);
    const data = this.table(1);
    if (this.is(";")) this.take();
    if (variable !== undefined) {
      this.expect("return");
      const position = this.current;
      if (this.identifier() !== variable) fail("return 必须返回前面声明的数据变量。", position);
      if (this.is(";")) this.take();
    }
    if (this.current.kind !== "eof") fail("数据表之后含有额外代码。", this.current);
    return data;
  }
}

/** Accept a bare table, `return { ... }`, or one local table followed by its return. */
export function parseLuaData(source: string): unknown {
  if (source.length > MAX_LUA_DATA_LENGTH) fail("文件超过 2 MiB 长度限制。", { line: 1, column: 1 });
  return new Parser(new Lexer(source)).parse();
}
