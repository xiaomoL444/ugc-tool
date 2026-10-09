import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJSON } from './model-json.mjs';

const match = { resourceId: 'effect:210', reason: 'Rectangular title', matchType: 'feature' };
const expected = { answer: 'Highlight a "selected region". 矩形 / 矩形領域 / область', matches: [match] };

test('valid escaped multilingual model answer is unchanged', () => {
  assert.deepEqual(parseModelJSON(JSON.stringify(expected)), expected);
  assert.deepEqual(parseModelJSON('\uFEFF  ' + JSON.stringify(expected) + '\n'), expected);
  assert.deepEqual(parseModelJSON('```json\n' + JSON.stringify(expected) + '\n```'), expected);
});

test('repair unescaped English quotes while preserving IDs and prose', () => {
  const raw = '{"answer":"Highlight a "selected region". 矩形 / 矩形領域 / область","matches":[{"resourceId":"effect:210","reason":"Rectangular title","matchType":"feature"}]}';
  assert.throws(() => JSON.parse(raw));
  assert.deepEqual(parseModelJSON(raw), expected);
});

test('repair model punctuation errors without changing matching evidence', () => {
  const raw = "{answer:'Ready',matches:[{resourceId:'effect:210',reason:'Rectangular title',matchType:'feature',},],}";
  assert.deepEqual(parseModelJSON(raw), { answer: 'Ready', matches: [match] });
});

test('obviously unfinished output is not accepted through bracket completion', () => {
  for (const raw of ['{"answer":"unfinished","matches":[', '{answer:"Ready",matches:[]', '{answer:"Ready",matches:[{resourceId:"effect:210"', '```json\n{"answer":"unfinished","matches":[']) {
    assert.throws(() => parseModelJSON(raw));
  }
});

test('non-JSON prose, executable content and oversized output remain invalid', () => {
  assert.throws(() => parseModelJSON('Here are the candidates: {answer:"Ready",matches:[]}'));
  assert.throws(() => parseModelJSON('<img src=x onerror="alert(1)">\n{"answer":"unfinished","matches":['));
  globalThis.modelJSONExecuted = false;
  assert.throws(() => parseModelJSON('{answer:(()=>{globalThis.modelJSONExecuted=true})(),matches:[]}'));
  assert.equal(globalThis.modelJSONExecuted, false);
  delete globalThis.modelJSONExecuted;
  assert.throws(() => parseModelJSON(' '.repeat(100001)));
  assert.throws(() => parseModelJSON(null));
});
