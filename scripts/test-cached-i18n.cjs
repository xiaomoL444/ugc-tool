const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (loaded, filename) => loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, filename);
global.window = {};
const { createI18n } = require('vue-i18n');
const { computed } = require('vue');
const { createCachedText } = require('../src/i18n/cachedText.ts');
const composer = createI18n({ legacy: false, locale: 'zh-CN', fallbackLocale: false,
  messages: { 'zh-CN': { name: '烟尘' }, 'en-US': { name: 'Smoke' } },
}).global;
let calls = 0;
const text = createCachedText({ locale: composer.locale, messages: composer.messages, te: composer.te,
  t: key => { calls++; return composer.t(key); },
});
const label = computed(() => text('name'));
for (let i = 0; i < 1000; i++) assert.equal(text('name'), '烟尘');
assert.equal(calls, 1, 'Repeated renders reuse a translation');
assert.equal(label.value, '烟尘');
assert.equal(text('missing'), 'missing');
assert.equal(calls, 1, 'Missing resources do not emit repeated translation warnings');
composer.setLocaleMessage('zh-CN', { name: '新烟尘', missing: '已加载' });
assert.equal(label.value, '新烟尘', 'Remote replacement updates existing consumers');
assert.equal(text('missing'), '已加载', 'Missing-key cache refreshes after loading');
composer.locale.value = 'en-US';
assert.equal(label.value, 'Smoke');
assert.equal(text('missing'), 'missing', 'No fallback to another language');
const before = calls;
composer.setLocaleMessage('zh-CN', { name: '再次更新' });
assert.equal(text('name'), 'Smoke');
assert.equal(calls, before, 'Background language load leaves current cache intact');
composer.locale.value = 'zh-CN';
assert.equal(label.value, '再次更新');
composer.setLocaleMessage('zh-CN', {});
assert.equal(label.value, 'name', 'Removed entries return their key');
console.log('Cached resource translation tests passed');
