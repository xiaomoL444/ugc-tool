// Incremental JSON parsing keeps source bytes and full serialized dictionaries out of memory.
// Values are parsed individually; object order and numeric key ordering match JSON.parse.
export class BoundedJsonParser {
  constructor({ maxNodes = 1_000_000, maxDepth = 32, maxStringCharacters = 2_000_000 } = {}) {
    this.maxNodes = maxNodes; this.maxDepth = maxDepth; this.maxStringCharacters = maxStringCharacters;
    this.nodes = 0; this.buffer = ''; this.position = 0; this.scan = null; this.stack = []; this.hasRoot = false;
  }
  invalid() { throw new SyntaxError('Invalid or excessive JSON source'); }
  closeContainer() { this.stack.pop().postingValues?.clear(); }
  attach(value) {
    if (++this.nodes > this.maxNodes) this.invalid();
    const frame = this.stack.at(-1);
    if (!frame) { if (this.hasRoot) this.invalid(); this.value = value; this.hasRoot = true; return; }
    if (!['value', 'valueOrEnd'].includes(frame.state)) this.invalid();
    // Reuse only complete string values in the actual root lexical.postings table.
    // A small FIFO pool avoids retaining another term-sized lookup table.
    if (frame.postingValues && typeof value === 'string') {
      const previous = frame.postingValues.get(value);
      if (previous !== undefined) value = previous;
      else {
        if (frame.postingValues.size >= 4096) frame.postingValues.delete(frame.postingValues.keys().next().value);
        frame.postingValues.set(value, value);
      }
    }
    if (frame.type === 'array') frame.value.push(value); else frame.value[frame.key] = value;
    frame.state = 'commaOrEnd';
  }
  stringToken() {
    const start = this.position;
    let scan = this.scan || { offset: start + 1, escaped: false };
    for (; scan.offset < this.buffer.length; scan.offset++) {
      const char = this.buffer[scan.offset];
      if (scan.escaped) scan.escaped = false;
      else if (char === '\\') scan.escaped = true;
      else if (char === '"') {
        const end = scan.offset + 1;
        if (end - start > this.maxStringCharacters + 2) this.invalid();
        // An escaped prefix makes V8 allocate an independent decoded string. Otherwise
        // JSON.parse can retain a large source chunk through a sliced string value.
        const first = this.buffer[start + 1];
        const independent = first !== '"' && first !== '\\' && first.charCodeAt(0) >= 0x20
          ? '"\\u' + first.charCodeAt(0).toString(16).padStart(4, '0') + this.buffer.slice(start + 2, end)
          : this.buffer.slice(start, end);
        const value = JSON.parse(independent); this.position = end; this.scan = null; return { value };
      }
      if (scan.offset - start > this.maxStringCharacters + 2) this.invalid();
    }
    this.scan = scan; return null;
  }
  feed(text, final = false) {
    this.buffer += text;
    while (this.position < this.buffer.length) {
      const char = this.buffer[this.position];
      if (/[ \t\r\n]/u.test(char)) { this.position++; continue; }
      const frame = this.stack.at(-1), state = frame?.state;
      if (state === 'colon') { if (char !== ':') this.invalid(); this.position++; frame.state = 'value'; continue; }
      if (state === 'commaOrEnd') {
        if (char === ',') { this.position++; frame.state = frame.type === 'object' ? 'key' : 'value'; continue; }
        if (char === (frame.type === 'object' ? '}' : ']')) { this.position++; this.closeContainer(); continue; }
        this.invalid();
      }
      if (state === 'keyOrEnd' && char === '}' || state === 'valueOrEnd' && frame.type === 'array' && char === ']') {
        this.position++; this.closeContainer(); continue;
      }
      if (state === 'key' || state === 'keyOrEnd') {
        if (char !== '"') this.invalid();
        const token = this.stringToken(); if (!token) break;
        if (Object.hasOwn(frame.value, token.value)) this.invalid();
        frame.key = token.value; frame.state = 'colon'; continue;
      }
      if (this.hasRoot && !frame) this.invalid();
      if (char === '{' || char === '[') {
        // Preserve null-prototype safety while allowing V8 fast properties for
        // small records; Object.create(null) starts them in dictionary mode.
        const value = char === '{' ? Object.setPrototypeOf({}, null) : []; this.attach(value); this.position++;
        if (this.stack.length >= this.maxDepth) this.invalid();
        const postingValues = char === '{' && this.stack.length === 2 && this.stack[0].type === 'object'
          && this.stack[0].key === 'lexical' && frame.type === 'object' && frame.key === 'postings' ? new Map() : null;
        this.stack.push({ type: char === '{' ? 'object' : 'array', value, state: char === '{' ? 'keyOrEnd' : 'valueOrEnd', key: null, postingValues }); continue;
      }
      if (char === '"') {
        const token = this.stringToken(); if (!token) break; this.attach(token.value); continue;
      }
      let end = this.position;
      while (end < this.buffer.length && !/[ \t\r\n,}\]]/u.test(this.buffer[end])) end++;
      if (end - this.position > 128) this.invalid();
      if (end === this.buffer.length && !final) break;
      const token = this.buffer.slice(this.position, end);
      if (!/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/u.test(token)) this.invalid();
      this.attach(JSON.parse(token)); this.position = end;
    }
    if (this.position) {
      if (this.scan) this.scan.offset -= this.position;
      this.buffer = this.buffer.slice(this.position); this.position = 0;
    }
    if (final && (this.stack.length || !this.hasRoot || this.buffer.replace(/[ \t\r\n]/gu, ''))) this.invalid();
  }
  finish() { this.feed('', true); return this.value; }
}
