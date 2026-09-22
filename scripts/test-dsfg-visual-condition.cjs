/* Run with: node scripts/test-dsfg-visual-condition.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const oldTs = Module._extensions['.ts'];
Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: filename,
}).outputText, filename);
try {
  const { parseVisualCondition: parse, serializeVisualCondition: serialize } = require(path.resolve(__dirname, '../src/views/DSFGStudio/components/DialogueEditor/utils/visualCondition.ts'));
  const comparison = (source, value, operator = '==', rightSource = 'number', rightValue = '1') => ({
    id: 'c', kind: 'comparison', left: { source, value }, operator, right: { source: rightSource, value: rightValue },
  });
  const group = (operator, ...children) => ({ id: 'g', kind: 'group', operator, children });
  const stripIds = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'id' ? undefined : child));
  let count = 0;
  const test = (name, run) => { run(); count++; console.log(`PASS ${name}`); };
  test('All scopes and comparisons emit runtime placeholders without quoting variables', () => {
    for (const [scope, prefix] of [['player', 'ps'], ['character', 'as'], ['level', 'lv']]) {
      for (const operator of ['==', '!=', '>', '>=', '<', '<=']) {
        const node = comparison(scope, '奖励.1.数量', operator, 'character', '属性.攻击力');
        const expression = serialize(node);
        assert.equal(expression, `{1:${prefix}.奖励.1.数量} ${operator} {1:as.属性.攻击力}`);
        assert.deepEqual(stripIds(parse(expression).children[0]), stripIds(node));
      }
    }
  });
  test('Nested groups preserve AND/OR precedence through repeat editing', () => {
    const node = group('and', comparison('player', 'Score', '>='), group('or', comparison('level', 'Stage'), comparison('level', 'Stage', '==', 'number', '2')));
    const expression = serialize(node);
    assert.equal(expression, '{1:ps.Score} >= 1 && ({1:lv.Stage} == 1 || {1:lv.Stage} == 2)');
    assert.deepEqual(stripIds(parse(expression)), stripIds(node));
    const precedence = parse('{1:ps.A} == 1 || {1:ps.B} == 2 && {1:ps.C} == 3');
    assert.equal(precedence.operator, 'or');
    assert.equal(precedence.children[1].operator, 'and');
    assert.equal(serialize(parse(serialize(precedence))), serialize(precedence));
  });
  test('Text escaping remains data including placeholder-looking and operator-looking strings', () => {
    for (const value of ['对话', '', '" || true || "', '{1:ps.A}', '\\路径\n下一行\r\t\b\f\v\x07\0']) {
      const node = comparison('player', 'Kind', '==', 'text', value);
      assert.equal(parse(serialize(node)).children[0].right.value, value);
    }
    assert.equal(parse("{1:ps.Kind} != 'it\\\'s'").children[0].right.value, "it's");
  });
  test('Numbers preserve precision, booleans and distinct text values', () => {
    for (const value of ['9223372036854775807', '-9007199254740993', '+01', '1.0', '.5', '-2.5e-3', '0x7fffffffffffffff']) {
      const node = comparison('player', 'A', '==', 'number', value);
      assert.equal(parse(serialize(node)).children[0].right.value, value);
    }
    assert.equal(serialize(comparison('player', 'A', '==', 'text', '1')), '{1:ps.A} == "1"');
    assert.equal(serialize(comparison('player', 'A', '==', 'boolean', 'false')), '{1:ps.A} == false');
  });
  test('Invalid drafts and runtime limits fail without generating broken conditions', () => {
    for (const value of ['', 'NaN', 'Infinity', '1e999', '1 || true', '9223372036854775808', '-9223372036854775808']) {
      assert.throws(() => serialize(comparison('player', 'A', '==', 'number', value)));
    }
    for (const value of ['', 'A..B', 'A}', '{1:lv.A}']) assert.throws(() => serialize(comparison('player', value)));
    assert.throws(() => serialize(group('and')), /不能为空/);
    assert.throws(() => serialize(comparison('player', 'A', '>', 'text', 'hello')), /文本/);
    assert.throws(() => serialize(comparison('player', 'A', '==', 'text', '字'.repeat(3000))), /字节/);
    assert.throws(() => serialize(group('and', ...Array.from({ length: 70 }, () => comparison('player', 'A')))), /组合过长/);
  });
  test('Unsupported source expressions are never partially converted or evaluated', () => {
    for (const text of ['', 'true', '!{1:ps.A}', '{1:ps.A} + 1 > 2', '{1:lv.{1:ps.Name}} == 1', 'A == 1', '{1:ps.A} == 1 trailing', '{1:ps.A} == "bad\\u0000"', '{1:ps.A} == 1 &&', '{1:ps.A} < 2 < 3']) {
      assert.equal(parse(text), null, text);
    }
  });
  console.log(`${count} visual condition checks passed.`);
} finally { Module._extensions['.ts'] = oldTs; }
