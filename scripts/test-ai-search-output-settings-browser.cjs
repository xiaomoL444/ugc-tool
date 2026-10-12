/* Offline real Vue component verification. NODE_PATH points to bundled Playwright. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(root, '../ugc-ai-search-file');
const experiment = path.join(artifacts, 'experiments/model-output-constraints');
const screenshots = path.join(artifacts, 'verification/browser');
const origin = 'http://127.0.0.1:18766';

function fixture() {
  const file = 'src/views/AISearch/components/ModelOutputSettings.vue';
  const { descriptor, errors } = parse(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  assert.deepEqual(errors, []);
  const component = compileScript(descriptor, { id: 'output-settings', inlineTemplate: true });
  const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const policy = transpile(fs.readFileSync(path.join(root, 'tools/ai-search-service/model-output-policy.mjs'), 'utf8'));
  const styles = descriptor.styles.map(style => {
    const compiled = compileStyle({ source: style.content, filename: file, id: 'data-v-output-settings', scoped: true });
    assert.deepEqual(compiled.errors, []); return compiled.code;
  }).join('\n');
  const locales = JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/locales/aiSearch/zh-cn.json'), 'utf8'));
  const bundle = `const process={env:{NODE_ENV:'development'}};
  const policyModule={exports:{}};(function(module,exports){${policy}})(policyModule,policyModule.exports);
  const componentModule={exports:{}};
  function require(name){if(name==='vue')return Vue;if(name==='vue-i18n')return VueI18n;if(name.endsWith('model-output-policy.mjs'))return policyModule.exports;throw Error(name);}
  (function(module,exports){${transpile(component.content)}})(componentModule,componentModule.exports);
  componentModule.exports.default.__scopeId='data-v-output-settings';
  const config=Vue.reactive({baseUrl:'https://api.openai.com/v1',model:'gpt-4o-mini',protocol:'auto',outputMode:'auto',apiKey:'',rememberKey:false});
  window.setConfig=patch=>Object.assign(config,patch);window.getConfig=()=>({...config});
  const i18n=VueI18n.createI18n({legacy:false,flatJson:true,locale:'zh-CN',messages:{'zh-CN':${JSON.stringify(locales)}}});
  Vue.createApp({setup:()=>()=>Vue.h(componentModule.exports.default,{config,'onUpdate:outputMode':mode=>config.outputMode=mode})}).use(i18n).mount('#app');window.fixtureReady=true;`;
  const runtime = fs.readFileSync(require.resolve('vue/dist/vue.global.prod.js'), 'utf8') + '\n' + fs.readFileSync(require.resolve('vue-i18n/dist/vue-i18n.global.prod.js'), 'utf8');
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>JSON 约束检测</title><style>body{font-family:Arial,sans-serif;background:#eeeffa;margin:0;padding:20px}#app{max-width:560px;margin:auto}h1{font-size:18px;text-align:center}</style><link rel="stylesheet" href="/fixture.css"><h1>我的模型 · JSON 输出约束</h1><div id="app"></div><script src="/runtime.js"></script><script src="/fixture.js"></script></html>';
  return { html, bundle, runtime, styles };
}

(async () => {
  fs.mkdirSync(experiment, { recursive: true }); fs.mkdirSync(screenshots, { recursive: true });
  const temporary = path.join(experiment, 'browser-temp'); fs.mkdirSync(temporary, { recursive: true });
  process.env.TEMP = temporary; process.env.TMP = temporary;
  const content = fixture();
  fs.writeFileSync(path.join(experiment, 'fixture.js'), content.bundle);
  fs.writeFileSync(path.join(experiment, 'fixture.html'), content.html);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 900, height: 850 }, locale: 'zh-CN' });
      const errors = [], unexpected = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { unexpected.push(url.href); return route.abort(); }
        const entry = { '/': ['text/html', content.html], '/runtime.js': ['application/javascript', content.runtime], '/fixture.js': ['application/javascript', content.bundle], '/fixture.css': ['text/css', content.styles] }[url.pathname];
        return entry ? route.fulfill({ contentType: entry[0], body: entry[1] }) : route.fulfill({ status: 404, body: '' });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin); await page.waitForFunction(() => window.fixtureReady);
      const panel = page.locator('.model-output-settings');
      assert.ok((await panel.textContent()).includes('ChatGPT / OpenAI'));
      assert.equal(await panel.locator('dd').nth(1).textContent(), '严格 JSON Schema');
      assert.ok((await panel.textContent()).includes('不发送 API 请求'));
      assert.equal(await panel.locator('.model-output-inferred').count(), 0);
      await panel.locator('select').selectOption('prompt');
      assert.equal(await panel.locator('dd').nth(1).textContent(), '提示词约束');
      assert.equal(await page.evaluate(() => window.getConfig().outputMode), 'prompt');
      await panel.locator('select').selectOption('auto');
      await page.evaluate(() => window.setConfig({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }));
      assert.equal(await panel.locator('dd').first().textContent(), 'DeepSeek');
      assert.equal(await panel.locator('dd').nth(1).textContent(), 'JSON 模式');
      await page.evaluate(() => window.setConfig({ model: 'deepseek-flash' }));
      assert.equal(await panel.locator('dd').nth(1).textContent(), '严格 JSON Schema');
      await page.evaluate(() => window.setConfig({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-2-0-pro' }));
      assert.equal(await panel.locator('dd').first().textContent(), '豆包');
      assert.equal(await panel.locator('dd').nth(1).textContent(), '严格 JSON Schema');
      await page.evaluate(() => window.setConfig({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-max' }));
      assert.equal(await panel.locator('dd').nth(1).textContent(), '提示词约束');
      assert.ok((await panel.textContent()).includes('text.format'), 'Qwen Responses capability limitation is visible');
      await panel.locator('select').selectOption('json_object');
      await page.evaluate(() => window.setConfig({ baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' }));
      assert.equal(await panel.locator('dd').first().textContent(), 'Claude');
      assert.equal(await panel.locator('dd').nth(1).textContent(), '严格 JSON Schema');
      assert.equal(await panel.locator('option[value="json_object"]').count(), 0);
      assert.equal(await page.evaluate(() => window.getConfig().outputMode), 'auto', 'Native Claude cannot retain an OpenAI-only JSON mode override');
      await page.evaluate(() => window.setConfig({ baseUrl: 'https://gateway.example/v1', model: 'gpt-4o-mini' }));
      await panel.locator('.model-output-inferred').waitFor();
      assert.ok((await panel.textContent()).includes('中转接口'));
      await page.evaluate(() => window.setConfig({ model: 'unknown-model' }));
      assert.equal(await panel.locator('dd').first().textContent(), '未识别');
      assert.equal(await panel.locator('dd').nth(1).textContent(), '提示词约束');
      await page.evaluate(() => window.setConfig({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }));
      await page.screenshot({ path: path.join(screenshots, mobile ? 'ai-search-output-settings-mobile.png' : 'ai-search-output-settings.png'), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, [], 'Detection and overrides make no API requests');
      await context.close();
    }
  } finally { await browser.close(); }
  console.log('PASS model output settings in desktop/mobile: reactive family detection, constraint labels, gateway notice, manual override and zero API requests.');
})().catch(error => { console.error(error); process.exitCode = 1; });
