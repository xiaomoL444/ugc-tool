/* Run with: node scripts/test-dsfg-preset-editor.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc');

const base = path.resolve(__dirname, '../src/views/DSFGStudio/components');
const originalLoad = Module._load;
const originalExtensions = Object.fromEntries(['.ts', '.vue', '.css'].map(extension => [extension, Module._extensions[extension]]));
const originalDocument = global.document;
const historyKey = Symbol('preset-editor-test-history');
const container = tag => vue.defineComponent({ setup: (_, { slots }) => () => vue.h(tag, slots.default?.()) });
const history = {
  workspacePresetHistoryKey: historyKey,
  useWorkspacePresetHistory: () => ({ current: vue.ref(undefined), register() {}, finish() {} }),
};
const stubs = new Map([
  ['SectionLayout.vue', container('layout-stub')],
  ['StudioSidebarContent.vue', container('sidebar-stub')],
  ['StudioHistoryToolbar.vue', container('history-stub')],
  ['CustomPresetSection.vue', container('custom-stub')],
  ['SelectOptionIcon.vue', container('option-icon-stub')],
]);
Module._load = function(request, parent, isMain) {
  if (request === 'vue-sonner') return { toast: { error: error => { throw Error(String(error)); } } };
  if (request === 'naive-ui') return { NSelect: vue.defineComponent({
    props: ['value', 'options', 'disabled', 'themeOverrides', 'menuProps'],
    setup(props, { attrs }) {
      return () => vue.h('select-stub', {
        label: attrs['aria-label'], value: props.value, options: props.options, disabled: props.disabled,
        choose: value => attrs['onUpdate:value'](value),
      });
    },
  }) };
  if (path.basename(request).replace(/\.ts$/, '') === 'useWorkspacePresetHistory') return history;
  if (path.basename(request).replace(/\.ts$/, '') === 'dialogueProject' && parent?.filename.endsWith('SelectClipEditor.vue')) {
    return { createSelectOption: () => ({ id: 'new-option', content: '', icon: 0 }) };
  }
  if (stubs.has(path.basename(request))) return { default: stubs.get(path.basename(request)), __esModule: true };
  return originalLoad.call(this, request.startsWith('@/') ? path.resolve(__dirname, '../src', request.slice(2)) : request, parent, isMain);
};
const compile = (source, filename) => ts.transpileModule(source, {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
Module._extensions['.ts'] = (mod, filename) => mod._compile(compile(fs.readFileSync(filename, 'utf8'), filename), filename);
Module._extensions['.css'] = () => {};
Module._extensions['.vue'] = (mod, filename) => {
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  mod._compile(compile(compileScript(descriptor, { id: 'preset-editor-test', inlineTemplate: true }).content, filename), filename);
};

// Real Vue DOM directives receive a small host element implementation. Tests
// dispatch input/change events rather than assigning component state directly.
global.document = { activeElement: null };
function element(tag) {
  return { tag, tagName: tag.toUpperCase(), children: [], parent: null, props: {}, events: new Map(),
    style: { display: '' }, value: '', open: false, dataset: {}, scrollCalls: [],
    addEventListener(name, callback) {
      const listeners = this.events.get(name) ?? [];
      listeners.push(callback); this.events.set(name, listeners);
    },
    removeEventListener(name, callback) {
      this.events.set(name, (this.events.get(name) ?? []).filter(listener => listener !== callback));
    },
    setCustomValidity(message) { this.validationMessage = message; },
    querySelector(selector) { return this.querySelectorAll(selector)[0]; },
    querySelectorAll(selector) { return query(this, selector); },
    getAttribute(name) { return this.props[name] ?? null; },
    setAttribute(name, value) { this.props[name] = String(value); },
    removeAttribute(name) { delete this.props[name]; },
    closest(selector) {
      for (let node = this; node; node = node.parent) if (query(node, selector).includes(node)) return node;
      return null;
    },
    focus(options) { global.document.activeElement = this; this.focusOptions = options; },
    scrollIntoView(options) { this.scrollCalls.push(options); },
  };
}
const renderer = vue.createRenderer({
  createElement: element, createText: text => ({ text, parent: null }), createComment: text => ({ text, parent: null }),
  setText(node, text) { node.text = text; }, setElementText(node, text) { node.text = text; node.children = []; },
  parentNode: node => node.parent,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
  insert(node, parent, anchor) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(index < 0 ? parent.children.length : index, 0, node);
  },
  remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
    node.parent = null;
  },
  patchProp(node, key, previous, value) {
    node.props[key] = value;
    if (key === 'value') node.value = value;
    if (key === 'open') node.open = value !== undefined && value !== false;
    if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    if (key === 'style' && value && typeof value === 'object') Object.assign(node.style, value);
  },
  setScopeId() {},
});
function all(root, predicate) {
  return [...(predicate(root) ? [root] : []), ...(root.children ?? []).flatMap(child => all(child, predicate))];
}
const find = (root, predicate) => all(root, predicate)[0];
const text = node => [node.text ?? '', ...(node.children ?? []).map(text)].join('');
const input = (root, label) => find(root, node => node.tag === 'input' && node.props['aria-label'] === label);
const select = (root, label) => find(root, node => node.tag === 'select-stub' && node.props.label === label);
const hasClass = (node, name) => String(node.props?.class ?? '').split(/\s+/).includes(name);
function query(root, selector) {
  const parts = selector.trim().split(/\s+/);
  function matches(node, part) {
    if (!node.tag) return false;
    const tag = part.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tag !== tag) return false;
    for (const match of part.matchAll(/\.([\w-]+)/g)) if (!hasClass(node, match[1])) return false;
    for (const match of part.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]+)["']?)?\]/g)) {
      if (node.props[match[1]] === undefined || (match[2] !== undefined && String(node.props[match[1]]) !== match[2])) return false;
    }
    if (part.includes(':last-child') && node.parent?.children.filter(child => child.tag).at(-1) !== node) return false;
    return true;
  }
  return all(root, node => {
    if (!matches(node, parts.at(-1))) return false;
    let ancestor = node.parent;
    for (let index = parts.length - 2; index >= 0; index--) {
      while (ancestor && !matches(ancestor, parts[index])) ancestor = ancestor.parent;
      if (!ancestor) return false;
      ancestor = ancestor.parent;
    }
    return true;
  });
}
function dispatch(node, name) {
  const event = { target: node, currentTarget: node, isComposing: false };
  for (const listener of node.events.get(name) ?? []) listener(event);
  const prop = node.props[`on${name[0].toUpperCase()}${name.slice(1)}`];
  for (const listener of Array.isArray(prop) ? prop : prop ? [prop] : []) listener(event);
}
async function enter(node, value) {
  assert.ok(node, 'Expected an editable input in the real preset editor');
  assert.ok(!node.props.disabled && !node.props.readonly, 'Default entries must permit editing');
  for (let ancestor = node; ancestor; ancestor = ancestor.parent) {
    assert.notEqual(ancestor.style?.display, 'none', 'Navigate to the visible category before editing its fields');
  }
  node.value = value; dispatch(node, 'input'); await vue.nextTick();
  assert.equal(node.value, value);
}
async function settle() {
  await new Promise(resolve => setImmediate(resolve)); await vue.nextTick();
  await new Promise(resolve => setImmediate(resolve)); await vue.nextTick();
}

async function main() {
  const filename = path.join(base, 'EntityPresetEditor/EntityPresetEditor.vue');
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  const cssRules = [];
  for (const style of descriptor.styles) {
    const compiled = compileStyle({ source: style.content, filename, id: 'data-v-preset-editor-test', scoped: style.scoped });
    assert.deepEqual(compiled.errors, []);
    compiled.rawResult.root.walkRules(rule => { if (rule.parent.type === 'root') cssRules.push(rule); });
  }
  const property = (selector, name) => cssRules.find(rule => selector.test(rule.selector))?.nodes.find(node => node.type === 'decl' && node.prop === name)?.value;
  assert.equal(property(/\.public-card[^>]*>\s*\.parameter-toggle/, 'grid-row'), '1', 'The parameter control must stay in the card header row');
  assert.equal(property(/\.public-card[^>]*>\s*\.parameter-toggle/, 'grid-column')?.replace(/\s/g, ''), '-2/-1', 'The parameter control must use the far-right grid column');
  assert.equal(property(/\.public-card[^>]*>\s*\.public-parameters/, 'grid-row'), '2');
  assert.equal(property(/\.public-card[^>]*>\s*\.public-parameters/, 'grid-column')?.replace(/\s/g, ''), '1/-1', 'Expanded settings must occupy a complete following row');
  const Editor = require(path.join(base, 'EntityPresetEditor/EntityPresetEditor.vue')).default;
  const { systemPresetConfig: config } = require(path.join(base, 'EntityPresetEditor/systemPresetConfig.ts'));
  const { decodePublicEventPresets } = require(path.join(base, 'EntityPresetEditor/publicEventPresets.ts'));
  const { decodeEntityPresets } = require(path.join(base, 'EntityPresetEditor/entityPresets.ts'));
  const { decodeSkillAnimationPresets } = require(path.join(base, 'EntityPresetEditor/skillAnimationPresets.ts'));
  const { decodeStylePresets, encodeStylePresets, stylePresetCategories, supportsCustomStylePresets,
    supportsEditableSystemStylePresets, getStylePresetValueType, useStylePresets } = require(path.join(base, 'EntityPresetEditor/stylePresets.ts'));
  const customStyleCategories = stylePresetCategories.filter(category => supportsCustomStylePresets(category.key));
  const editableStyleCategories = stylePresetCategories.filter(category => supportsEditableSystemStylePresets(category.key));
  const customStyleValue = category => getStylePresetValueType(category.key) === 'Int32' ? '3' : `NOLOC_Custom_${category.key}`;
  const seeds = JSON.stringify(config);
  const files = new Map(), writes = [];
  const storage = {
    setProject() { return this; }, async exists(file) { return files.has(file); },
    async readFile(file) { assert.ok(files.has(file)); return files.get(file); },
    async writeFile(file, data) { files.set(file, data); writes.push(file); },
  };
  const workspace = vue.ref('preset-editor-test');
  const mounted = [];
  function mount() {
    const root = element('root'), app = renderer.createApp(Editor);
    app.provide('storage', storage); app.provide('selectedWorkspaceId', workspace);
    const instance = app.mount(root); mounted.push(app);
    return { app, root, instance };
  }
  try {
    const { app, root, instance } = mount(); await settle();
    assert.equal(files.size, 0, 'Rendering defaults must not create workspace files');
    const nav = find(root, node => node.tag === 'nav' && node.props['aria-label'] === '预设分类');
    const navigation = all(nav, node => node.tag === 'button').map(text);
    const activate = async title => {
      const button = find(nav, node => node.tag === 'button' && text(node) === title);
      assert.ok(button, `Expected navigation for ${title}`);
      dispatch(button, 'click'); await vue.nextTick();
      assert.equal(button.props['aria-current'], 'page');
    };
    assert.equal(navigation.includes('布尔值'), false);
    assert.ok(navigation.includes('实体获取方式'));
    assert.ok(navigation.includes('移动方式'), 'Movement methods must be a peer preset category');
    assert.equal(navigation[navigation.indexOf('对话类型') + 1], '选项卡样式', 'Select styles belong beside dialogue styles in preset navigation');
    const card = (surface, label) => find(surface, node => node.tag === 'article' && node.props['aria-label'] === label);
    const click = async (surface, label, byAria = false) => {
      const button = find(surface, node => node.tag === 'button' && (byAria ? node.props['aria-label'] === label : text(node) === label));
      assert.ok(button, `Expected ${label} action`); assert.ok(!button.props.disabled);
      dispatch(button, 'click'); await vue.nextTick();
    };
    const systemCards = [
      [card(root, '系统公共事件预设 1'), '系统公共事件 1 代号', config.publicEvents.presets[0].alias],
      [card(root, '系统人物预设 1'), '系统人物 1 代号', config.entities.presets[0].name],
      [card(root, '系统技能动画预设 1'), '系统技能动画 1 名称', config.skillAnimations.presets[0].name],
    ];
    for (const [systemCard, aliasLabel, alias] of systemCards) {
      assert.ok(systemCard, 'System defaults must have a distinct card section');
      assert.equal(input(systemCard, aliasLabel), undefined, 'System labels must not expose editable inputs');
      assert.ok(text(systemCard).includes(alias), 'System labels must remain visible as fixed text');
      assert.equal(all(systemCard, node => node.tag === 'button' && node.parent === systemCard && /\bdelete\b/.test(node.props.class ?? '')).length, 0, 'System cards must not expose preset deletion');
    }
    assert.equal(input(root, '系统公共事件 1 名称').value, config.publicEvents.presets[0].name);
    assert.equal(input(root, '系统人物 1 guid').value, config.entities.presets[0].guid);
    assert.equal(input(root, '系统技能动画 1 配置 ID').value, config.skillAnimations.presets[0].configId);
    let browser = find(root, node => node.tag === 'aside' && node.props['aria-label'] === '预设词条浏览');
    assert.ok(browser, 'The editor must render the real entry browser');
    const settingsHeader = find(root, node => node.tag === 'header' && hasClass(node, 'settings-header'));
    const workbench = find(root, node => hasClass(node, 'preset-workbench'));
    assert.equal(vue.toRaw(settingsHeader.parent), vue.toRaw(workbench), 'The shared header must be a direct workbench row');
    assert.equal(vue.toRaw(workbench.children.find(node => node.tag)), vue.toRaw(settingsHeader), 'The shared header must precede the pane and editor content');
    assert.equal(vue.toRaw(find(root, node => node.tag === 'main' && hasClass(node, 'preset-content')).parent), vue.toRaw(workbench));
    const entries = () => all(browser, node => node.tag === 'button' && hasClass(node, 'entry-button'));
    const entryLabels = () => entries().map(entry => text(find(entry, node => hasClass(node, 'entry-label'))));
    const expectedCategories = [
      { title: '公共事件', rows: config.publicEvents.presets, label: row => row.alias },
      { title: '实体', rows: config.entities.presets, label: row => row.name },
      { title: '技能动画', rows: config.skillAnimations.presets, label: row => row.name },
      ...stylePresetCategories.map(category => ({ title: category.title, rows: config[category.key].presets, label: row => row.label })),
      { title: '自定义配置', rows: config.customTables.presets, label: row => row.name },
    ];
    for (const group of expectedCategories) {
      await activate(group.title);
      assert.deepEqual(entryLabels(), group.rows.map(group.label), `The browser should show only ${group.title} entries`);
      assert.equal(text(find(settingsHeader, node => node.tag === 'h2')), group.title);
      assert.equal(text(find(settingsHeader, node => hasClass(node, 'browser-count'))), String(group.rows.length));
      assert.deepEqual(all(browser, node => hasClass(node, 'group-title')).map(text), group.rows.length ? ['系统默认'] : [], 'Only current-category source sections should appear');
      for (const entry of entries()) assert.equal(entry.closest('.browser-group').props['aria-label'], '系统默认');
      assert.equal(all(browser, node => hasClass(node, 'entry-detail')).length, 0, 'Compact entry rows must omit long event names and other details');
    }
    await activate('公共事件');
    await enter(input(browser, '搜索词条或代号'), config.publicEvents.presets[0].name.toLowerCase());
    assert.equal(entries().length, 1, 'Searching event content should still find its compact alias row');
    assert.ok(text(entries()[0]).includes(config.publicEvents.presets[0].alias));
    assert.equal(text(entries()[0]).includes(config.publicEvents.presets[0].name), false, 'Long event names should be searchable without appearing in the entry row');
    await enter(input(browser, '搜索词条或代号'), '重置镜头');
    assert.equal(entries().length, 1, 'Searching a fixed alias should find its entry');
    await enter(input(browser, '搜索词条或代号'), config.skillAnimations.presets[0].name);
    assert.equal(entries().length, 0, 'Search must not include entries from another category');
    await enter(input(browser, '搜索词条或代号'), '不存在的预设词条');
    assert.equal(entries().length, 0);
    assert.match(text(browser), /未找到匹配/);
    await activate('实体');
    assert.equal(input(browser, '搜索词条或代号').value, '', 'Switching categories must clear the previous search');
    assert.deepEqual(entryLabels(), config.entities.presets.map(row => row.name));
    await activate('技能动画');
    const skillEntry = entries()[0];
    dispatch(skillEntry, 'click'); await settle();
    const target = find(root, node => node.tag === 'article' && node.props['data-preset-id'] === config.skillAnimations.presets[0].id);
    assert.ok(target, 'Entry navigation must locate the corresponding actual card');
    assert.equal(target.scrollCalls.length, 1, 'Clicking an entry should scroll the matching card into view');
    assert.equal(vue.toRaw(global.document.activeElement), vue.toRaw(target));
    assert.deepEqual(target.focusOptions, { preventScroll: true });
    assert.ok(target.props['data-preset-selected'] === true || target.props['data-preset-selected'] === 'true');
    assert.equal(skillEntry.props['aria-current'], 'true');
    assert.equal(find(nav, node => node.tag === 'button' && text(node) === '技能动画').props['aria-current'], 'page');
    for (let ancestor = target; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.style?.display, 'none');
    await enter(input(browser, '搜索词条或代号'), config.skillAnimations.presets[0].configId);
    assert.equal(entries().length, 1);
    const browserToggle = find(root, node => node.tag === 'button' && hasClass(node, 'browser-toggle'));
    assert.equal(vue.toRaw(browserToggle.closest('header')), vue.toRaw(settingsHeader), 'The persistent toggle must stay in the shared header');
    assert.match(text(browserToggle), /词条/);
    browserToggle.focus();
    await click(root, '收起词条浏览', true);
    assert.equal(vue.toRaw(find(root, node => node.props?.['aria-label'] === '展开词条浏览')), vue.toRaw(browserToggle), 'The shared header must reuse the same toggle button');
    assert.equal(vue.toRaw(global.document.activeElement), vue.toRaw(browserToggle), 'Collapsing the browser must retain keyboard focus on its handle');
    assert.equal(browserToggle.props['aria-expanded'], false);
    assert.equal(browser.style.display, 'none', 'Collapsing must hide the whole pane');
    assert.ok(hasClass(find(root, node => hasClass(node, 'preset-workbench')), 'browser-collapsed'));
    assert.equal(input(browser, '搜索词条或代号').value, config.skillAnimations.presets[0].configId, 'The hidden pane must retain its query');
    await click(root, '展开词条浏览', true);
    browser = find(root, node => node.tag === 'aside' && node.props['aria-label'] === '预设词条浏览');
    assert.ok(browser);
    assert.equal(vue.toRaw(global.document.activeElement), vue.toRaw(browserToggle), 'Expanding the browser must retain keyboard focus on its toggle');
    assert.equal(browserToggle.props['aria-expanded'], true);
    assert.notEqual(browser.style.display, 'none');
    assert.ok(!hasClass(find(root, node => hasClass(node, 'preset-workbench')), 'browser-collapsed'));
    assert.equal(input(browser, '搜索词条或代号').value, config.skillAnimations.presets[0].configId, 'Expanding the pane must restore the same query');
    assert.equal(entries().length, 1);
    await enter(input(browser, '搜索词条或代号'), '');
    assert.deepEqual(entryLabels(), config.skillAnimations.presets.map(row => row.name));
    assert.equal(files.size, 0, 'Search, category changes, navigation and browser toggles must not save preset data');
    await activate('公共事件');
    console.log('PASS compact entry browser follows the selected category, searches hidden details, clears search on category changes and scrolls/highlights cards without saving UI state');
    const details = all(root, node => node.tag === 'div' && hasClass(node, 'public-parameters'));
    const parameterToggle = panel => find(panel.parent, node => node.tag === 'button' && hasClass(node, 'parameter-toggle'));
    const toggleParameters = async panel => { dispatch(parameterToggle(panel), 'click'); await vue.nextTick(); };
    assert.equal(details.length, config.publicEvents.presets.length);
    for (const [index, panel] of details.entries()) {
      assert.equal(panel.style.display, 'none', 'Parameter settings must initially be collapsed');
      const toggle = parameterToggle(panel);
      assert.equal(toggle.props['aria-expanded'], false);
      assert.equal(toggle.props['aria-controls'], panel.props.id);
      assert.match(text(toggle), new RegExp(`${config.publicEvents.presets[index].parameters.length} 项`));
    }
    await toggleParameters(details[0]);
    assert.equal(parameterToggle(details[0]).props['aria-expanded'], true);
    assert.notEqual(details[0].style.display, 'none');
    await toggleParameters(details[0]);
    assert.equal(details[0].style.display, 'none');
    assert.equal(files.size, 0, 'Opening and closing parameter settings must not write preset data');
    console.log('PASS system cards have fixed labels and no preset-delete controls, editable values, collapsed counted parameter panels and no boolean navigation');

    await enter(input(root, '系统公共事件 1 名称'), 'NOLOC_WorkspaceSkill');
    await toggleParameters(details[0]);
    await enter(input(details[0], '公共事件参数名称'), '工作区配置');
    await enter(input(details[0], '公共事件参数默认值'), '120');
    const addParameter = find(details[0], node => node.tag === 'button' && text(node) === '＋ 添加参数');
    dispatch(addParameter, 'click'); await vue.nextTick();
    const rows = all(details[0], node => node.tag === 'div' && node.props.class === 'public-param-row');
    assert.equal(rows.length, 2);
    const typeSelect = select(rows[1], '公共事件参数类型');
    const boolType = typeSelect.props.options.find(option => option.label === '布尔值');
    typeSelect.props.choose(boolType.value); await vue.nextTick();
    const newBool = select(rows[1], '公共事件参数默认值');
    assert.ok(newBool);
    assert.deepEqual(newBool.props.options.map(option => option.label), ['否', '是']);
    assert.equal(newBool.props.value, 0, 'Changing a new parameter to Bool must select False');
    await enter(input(rows[1], '公共事件参数名称'), '启用');
    dispatch(addParameter, 'click'); await vue.nextTick();
    const allRows = all(details[0], node => node.tag === 'div' && hasClass(node, 'public-param-row'));
    assert.equal(allRows.length, 3);
    await enter(input(allRows[2], '公共事件参数名称'), '次数');
    const chooseLabel = async (field, label) => {
      assert.ok(field, `Expected select field for ${label}`);
      const option = field.props.options.find(option => option.label === label);
      assert.ok(option, `Expected select option ${label}`);
      field.props.choose(option.value); await vue.nextTick();
    };
    await chooseLabel(select(allRows[2], '公共事件参数类型'), '整数');
    await enter(input(allRows[2], '公共事件参数默认值'), '2');
    const visibilityRules = row => all(row, node => node.tag === 'div' && hasClass(node, 'visibility-rule'));
    await click(allRows[0], '＋ 显示条件');
    await click(allRows[0], '＋ 显示条件');
    assert.equal(visibilityRules(allRows[0]).length, 2);
    await chooseLabel(select(visibilityRules(allRows[0])[0], '显示条件参数'), '启用');
    await chooseLabel(select(visibilityRules(allRows[0])[0], '显示条件匹配值'), '是');
    await chooseLabel(select(visibilityRules(allRows[0])[1], '显示条件参数'), '次数');
    await enter(input(visibilityRules(allRows[0])[1], '显示条件匹配值'), '2');
    await click(visibilityRules(allRows[0])[0], '删除条件');
    assert.equal(visibilityRules(allRows[0]).length, 1);
    assert.equal(input(visibilityRules(allRows[0])[0], '显示条件匹配值').value, '2', 'Removing a condition must retain the other rule and its match value');
    await click(allRows[0], '＋ 显示条件');
    await chooseLabel(select(visibilityRules(allRows[0])[1], '显示条件参数'), '启用');
    await chooseLabel(select(visibilityRules(allRows[0])[1], '显示条件匹配值'), '是');
    assert.equal(visibilityRules(allRows[0]).length, 2);
    const resetIndex = config.publicEvents.presets.findIndex(preset => preset.id === 'public-reset-camera');
    const resetBool = select(details[resetIndex], '公共事件参数默认值');
    assert.deepEqual(resetBool.props.options.map(option => option.label), ['否', '是']);
    assert.equal(resetBool.props.value, 0, 'Built-in Bool defaults must be False');
    await toggleParameters(details[0]);
    assert.equal(input(details[0], '公共事件参数默认值').value, '120', 'Collapsing must keep edited parameter values');
    assert.match(text(parameterToggle(details[0])), /3 项/);
    console.log('PASS parameter folding preserves edits, new Bool fields default to False and offer only 否/是');

    await activate('实体');
    await enter(input(root, '系统人物 1 Talker'), '工作区人名');
    await enter(input(root, '系统人物 1 guid'), '1234567890');
    await activate('技能动画');
    await enter(input(root, '系统技能动画 1 配置 ID'), '42');
    for (const category of editableStyleCategories) {
      await activate(category.title);
      const valueLabel = category.key === 'cameras' ? '相机名称' : '类型值';
      const systemStyle = card(root, `系统${category.title}预设 1`);
      assert.ok(systemStyle);
      assert.ok(text(systemStyle).includes(config[category.key].presets[0].label));
      assert.equal(all(systemStyle, node => node.tag === 'button' && /\bdelete\b/.test(node.props.class ?? '')).length, 0, 'System style rows must not expose preset deletion');
      assert.equal(input(root, `系统${category.title} 1 显示名称`), undefined, 'System style labels are fixed');
      if (category.key === 'selectStyles') {
        assert.equal(input(root, `系统${category.title} 1 ${valueLabel}`), undefined, 'System option style values remain fixed even when their parameters are editable');
      } else {
        assert.equal(input(root, `系统${category.title} 1 ${valueLabel}`).value, config[category.key].presets[0].value);
        await enter(input(root, `系统${category.title} 1 ${valueLabel}`), `NOLOC_Workspace_${category.key}`);
      }
    }
    await activate('选项卡样式');
    const systemSelectStyle = card(root, '系统选项卡样式预设 1');
    assert.ok(systemSelectStyle);
    assert.ok(text(systemSelectStyle).includes(config.selectStyles.presets[0].label));
    assert.ok(text(systemSelectStyle).includes('Default_UI'));
    assert.equal(input(systemSelectStyle, '系统选项卡样式 1 显示名称'), undefined);
    assert.equal(input(systemSelectStyle, '系统选项卡样式 1 类型值'), undefined);
    assert.equal(all(systemSelectStyle, node => node.tag === 'button' && node.parent === systemSelectStyle).length, 0, 'System option styles never expose preset delete or restore controls');
    const stylePanel = surface => find(surface, node => node.tag === 'details' && hasClass(node, 'style-parameters'));
    const styleRows = surface => all(surface, node => node.tag === 'div' && hasClass(node, 'parameter-row'));
    // The host renderer models native details state; native summary clicks only
    // change the element's open property and do not write a Vue preset field.
    const foldStyle = async panel => { panel.open = !panel.open; dispatch(panel, 'toggle'); await vue.nextTick(); };
    const expectedStyleParameters = new Map();
    for (const [title, manualName, sourceName, sourceLabel, manualDefault, sourceDefault] of [
      ['对话类型', '次数', '配置编号', '技能动画 / 配置 ID', '12', '42'],
      ['选项卡样式', '选项数量', '获取方式', '实体获取方式 / 值', '3', '0'],
    ]) {
      await activate(title);
      const systemStyle = card(root, `系统${title}预设 1`), panel = stylePanel(systemStyle), label = `系统${title} 1`;
      assert.ok(panel, 'Both system style categories need a full-width parameter editor');
      assert.equal(panel.open, false, 'Style parameter definitions start collapsed');
      assert.equal(styleRows(panel).length, 0);
      await foldStyle(panel); await click(panel, '＋ 添加参数');
      await enter(input(panel, `${label} 参数 1 名称`), manualName);
      await enter(input(panel, `${label} 参数 1 默认值`), manualDefault);
      const integerInput = input(panel, `${label} 参数 1 默认值`);
      integerInput.value = '1.5'; dispatch(integerInput, 'input'); await vue.nextTick();
      assert.equal(integerInput.value, manualDefault, 'Integer defaults reject decimal input without rewriting the accepted value');
      assert.ok(text(styleRows(panel)[0]).includes('整数（Int32）'));
      assert.equal(all(panel, node => node.tag === 'select-stub').length, 1, 'Integer parameter type is fixed text, with only the source selectable');
      await click(panel, '＋ 添加参数');
      await enter(input(panel, `${label} 参数 2 名称`), sourceName);
      await enter(input(panel, `${label} 参数 2 默认值`), sourceDefault);
      const sourceField = select(panel, `${label} 参数 2 值来源`);
      assert.ok(sourceField.props.options.some(option => option.label === '技能动画 / 配置 ID'), 'ConfigReference sources are compatible with integer parameters');
      assert.ok(sourceField.props.options.some(option => option.label === '实体获取方式 / 值'));
      assert.ok(sourceField.props.options.some(option => option.label === '移动方式 / 值'), 'Movement methods are an integer reference source');
      assert.equal(sourceField.props.options.some(option => option.label === '实体 / 人名' || option.label === '公共事件 / 事件名' || option.label === '对话类型 / 值'), false, 'String sources are excluded from integer parameter definitions');
      await chooseLabel(sourceField, sourceLabel);
      await click(panel, '＋ 添加参数');
      await enter(input(panel, `${label} 参数 3 名称`), '待删除参数');
      await click(panel, `${label} 下移参数 1`, true);
      assert.equal(input(panel, `${label} 参数 1 名称`).value, sourceName);
      assert.equal(input(panel, `${label} 参数 2 名称`).value, manualName);
      await click(panel, `${label} 删除参数 3`, true);
      assert.equal(styleRows(panel).length, 2, 'Deleting one definition preserves the others');
      await click(panel, `${label} 上移参数 2`, true);
      await click(panel, `${label} 下移参数 1`, true);
      await foldStyle(panel); await foldStyle(panel);
      assert.equal(input(panel, `${label} 参数 1 默认值`).value, sourceDefault);
      assert.equal(input(panel, `${label} 参数 2 默认值`).value, manualDefault);
      assert.match(text(find(panel, node => node.tag === 'summary')), /2 \/ 100/);
      expectedStyleParameters.set(title, { names: [sourceName, manualName], defaults: [sourceDefault, manualDefault] });
    }
    console.log('PASS dialogue and option style definition cards edit integer names, defaults and compatible sources, reorder/delete parameters and retain edits when folded');
    await activate('实体获取方式');
    const fixed = find(root, node => node.tag === 'section' && node.props['aria-label'] === '实体获取方式预设');
    assert.equal(all(fixed, node => node.tag === 'input').length, 0, 'Entity-get methods remain fixed');
    await activate('移动方式');
    for (const [index, preset] of config.movementMethods.presets.entries()) {
      const systemMethod = card(root, `系统移动方式预设 ${index + 1}`);
      assert.ok(systemMethod);
      assert.ok(text(systemMethod).includes(preset.label));
      assert.equal(all(systemMethod, node => node.tag === 'input' || node.tag === 'button').length, 0, 'System movement methods remain read-only');
    }

    await activate('公共事件'); await click(root, '＋ 新建公共事件预设');
    const customPublic = card(root, '公共事件预设 1');
    assert.ok(customPublic);
    await enter(input(customPublic, '公共事件 1 代号'), '自定义技能事件');
    await enter(input(customPublic, '公共事件 1 名称'), 'NOLOC_CustomSkill');
    const publicSection = find(root, node => node.tag === 'section' && node.props['aria-labelledby'] === 'public-presets-title');
    const publicOrder = all(publicSection, node => node.tag === 'article');
    assert.equal(publicOrder.at(-1), customPublic, 'Custom public-event rows must appear below system rows');
    await activate('实体'); await click(root, '＋ 新建人物预设');
    await enter(input(root, '人物 1 代号'), '自定义角色');
    await enter(input(root, '人物 1 Talker'), '自定义人名');
    await activate('技能动画'); await click(root, '＋ 新建技能动画预设');
    await enter(input(root, '技能动画 1 名称'), '自定义动画');
    await enter(input(root, '技能动画 1 配置 ID'), '88');
    for (const category of customStyleCategories) {
      await activate(category.title); await click(root, `＋ 新建${category.title}预设`);
      const valueLabel = category.key === 'cameras' ? '相机名称' : '类型值';
      await enter(input(root, `${category.title} 1 显示名称`), `自定义${category.title}`);
      const valueField = input(root, `${category.title} 1 ${valueLabel}`);
      await enter(valueField, customStyleValue(category));
      if (getStylePresetValueType(category.key) === 'Int32') {
        assert.equal(valueField.props.inputmode, 'numeric');
        for (const invalid of ['1.5', 'bad']) {
          valueField.value = invalid; dispatch(valueField, 'input'); await vue.nextTick();
          assert.equal(valueField.value, customStyleValue(category), 'Integer preset values reject decimal and text input');
        }
      }
      if (category.key === 'dialogueStyles' || category.key === 'selectStyles') {
        const panel = stylePanel(card(root, `${category.title}预设 1`));
        await foldStyle(panel); await click(panel, '＋ 添加参数');
        await enter(input(panel, `${category.title} 1 参数 1 名称`), '自定义参数');
        await enter(input(panel, `${category.title} 1 参数 1 默认值`), '7');
      }
    }
    await activate('公共事件');
    await enter(input(browser, '搜索词条或代号'), '自定义技能事件');
    assert.equal(entries().length, 1, 'Newly edited custom entries should immediately appear in the browser');
    assert.equal(entries()[0].closest('.browser-group').props['aria-label'], '自定义');
    dispatch(entries()[0], 'click'); await settle();
    assert.equal(customPublic.scrollCalls.length, 1, 'New custom entries must navigate to their corresponding cards');
    assert.equal(customPublic.props['data-preset-selected'], 'true');
    assert.equal(target.props['data-preset-selected'], undefined, 'Selecting a new entry must clear the prior card highlight');
    await enter(input(browser, '搜索词条或代号'), '');
    await instance.prepareToLeave(); await settle();
    assert.equal(JSON.stringify(config), seeds, 'Editing defaults must preserve central seed configuration');
    const publicSaved = decodePublicEventPresets(files.get('/preset-editor-test/PublicEventPresets.json'));
    assert.equal(publicSaved.length, 1);
    assert.equal(publicSaved[0].alias, '自定义技能事件');
    assert.equal(publicSaved[0].name, 'NOLOC_CustomSkill');
    const systemSaved = JSON.parse(files.get('/preset-editor-test/PublicEventPresets.json')).systemOverrides;
    assert.equal(systemSaved.length, 1);
    assert.equal(systemSaved[0].id, config.publicEvents.presets[0].id);
    assert.equal(systemSaved[0].alias, config.publicEvents.presets[0].alias);
    assert.equal(systemSaved[0].name, 'NOLOC_WorkspaceSkill');
    assert.equal(systemSaved[0].parameters[0].name, '工作区配置');
    assert.equal(systemSaved[0].parameters[0].defaultValue, '120');
    assert.equal(systemSaved[0].parameters[1].type, 'Bool');
    assert.equal(systemSaved[0].parameters[1].defaultValue, 'False');
    assert.equal(systemSaved[0].parameters[2].type, 'Int32');
    assert.equal(systemSaved[0].parameters[2].defaultValue, '2');
    assert.deepEqual(systemSaved[0].parameters[0].visibleWhen, [
      { parameterId: systemSaved[0].parameters[2].id, equals: '2' },
      { parameterId: systemSaved[0].parameters[1].id, equals: 'True' },
    ], 'Multiple UI conditions must retain source IDs, ordering and typed matching values through persistence');
    const eventArguments = require(path.join(base, 'DialogueEditor/utils/publicEventParameters.ts'));
    const testClip = { components: [] };
    eventArguments.applyPublicEventPreset(testClip, systemSaved[0]);
    const savedArguments = eventArguments.getPublicEventArguments(testClip);
    assert.equal(eventArguments.isPublicEventArgumentVisible(savedArguments[0], savedArguments), false);
    savedArguments[1].value = 'True';
    assert.equal(eventArguments.isPublicEventArgumentVisible(savedArguments[0], savedArguments), true, 'Every condition must match for the configured field to appear');
    savedArguments[2].value = '3';
    assert.equal(eventArguments.isPublicEventArgumentVisible(savedArguments[0], savedArguments), false);
    console.log('PASS multiple visibility conditions can be added, deleted and edited with typed match values, then save and apply together');
    const entityFile = JSON.parse(files.get('/preset-editor-test/EntityPresets.json'));
    assert.equal(decodeEntityPresets(files.get('/preset-editor-test/EntityPresets.json'))[0].name, '自定义角色');
    assert.equal(entityFile.systemOverrides[0].name, config.entities.presets[0].name);
    assert.equal(entityFile.systemOverrides[0].guid, '1234567890');
    assert.equal(entityFile.systemOverrides[0].talker, '工作区人名');
    const skillFile = JSON.parse(files.get('/preset-editor-test/SkillAnimationPresets.json'));
    assert.equal(decodeSkillAnimationPresets(files.get('/preset-editor-test/SkillAnimationPresets.json'))[0].configId, '88');
    assert.equal(skillFile.systemOverrides[0].name, config.skillAnimations.presets[0].name);
    assert.equal(skillFile.systemOverrides[0].configId, '42');
    for (const category of customStyleCategories) {
      const raw = files.get(`/preset-editor-test/${category.key}.json`), saved = decodeStylePresets(category.key, raw);
      assert.equal(saved[0].label, `自定义${category.title}`);
      assert.equal(saved[0].value, customStyleValue(category));
      const file = JSON.parse(raw);
      if (supportsEditableSystemStylePresets(category.key)) {
        assert.equal(file.presetStorage, 'system-overrides');
        assert.equal(file.systemOverrides[0].label, config[category.key].presets[0].label);
        assert.equal(file.systemOverrides[0].value, category.key === 'selectStyles' ? 'Default_UI' : `NOLOC_Workspace_${category.key}`);
        if (category.key === 'dialogueStyles' || category.key === 'selectStyles') {
          const expected = expectedStyleParameters.get(category.title);
          assert.deepEqual(file.systemOverrides[0].parameters.map(param => param.name), expected.names);
          assert.deepEqual(file.systemOverrides[0].parameters.map(param => param.defaultValue), expected.defaults);
          assert.ok(file.systemOverrides[0].parameters.every(param => param.type === 'Int32'));
          assert.equal(saved[0].parameters[0].name, '自定义参数');
          assert.equal(saved[0].parameters[0].defaultValue, '7');
        }
      } else {
        assert.equal(file.presetStorage, 'custom-only');
        assert.equal(file.systemOverrides, undefined, 'Read-only movement system rows are never saved as overrides');
      }
    }
    assert.equal(files.size, 3 + customStyleCategories.length, 'Every modified category, including select styles, must be flushed before leaving');
    console.log('PASS real v-model saves editable system values separately from fully editable custom entries while preserving fixed labels and central seeds');

    await activate('公共事件'); await click(root, '删除公共事件预设 1', true);
    await activate('实体'); await click(root, '删除人物预设 1', true);
    await activate('技能动画'); await click(root, '删除技能动画预设 1', true);
    for (const category of customStyleCategories) {
      await activate(category.title); await click(root, `删除${category.title}预设 1`, true);
    }
    await instance.prepareToLeave(); await settle();
    for (const [file, raw] of files) {
      const saved = JSON.parse(raw);
      assert.deepEqual(saved.presets, [], 'Deleting custom rows must leave the custom list empty');
      if (file.endsWith('/movementMethods.json')) {
        assert.equal(saved.presetStorage, 'custom-only');
        assert.equal(saved.systemOverrides, undefined);
      } else {
        assert.equal(saved.presetStorage, 'system-overrides');
        assert.equal(saved.systemOverrides.length, 1, 'Custom deletion must retain edited system values and parameter definitions');
      }
    }
    assert.ok(card(root, '系统公共事件预设 1'));
    assert.ok(card(root, '系统人物预设 1'));
    assert.ok(card(root, '系统技能动画预设 1'));
    assert.equal(input(root, '公共事件 1 代号'), undefined);
    const savedWrites = writes.length;
    await activate('公共事件');
    await toggleParameters(details[0]);
    await toggleParameters(details[0]);
    await instance.prepareToLeave();
    assert.equal(writes.length, savedWrites, 'Folding parameter settings must never schedule a data save');
    console.log('PASS custom entries can be added, edited and deleted without removing system rows or changing their stored value overrides');

    app.unmount(); mounted.splice(mounted.indexOf(app), 1);
    const reopened = mount(); await settle();
    assert.equal(input(reopened.root, '系统公共事件 1 代号'), undefined);
    assert.ok(text(card(reopened.root, '系统公共事件预设 1')).includes(config.publicEvents.presets[0].alias));
    assert.equal(input(reopened.root, '系统公共事件 1 名称').value, 'NOLOC_WorkspaceSkill');
    assert.equal(input(reopened.root, '系统人物 1 guid').value, '1234567890');
    assert.equal(input(reopened.root, '系统技能动画 1 配置 ID').value, '42');
    assert.equal(input(reopened.root, '系统对话类型 1 类型值').value, 'NOLOC_Workspace_dialogueStyles');
    assert.ok(text(card(reopened.root, '系统选项卡样式预设 1')).includes('Default_UI'), 'An empty saved select-style custom list must retain the built-in default');
    assert.ok(text(card(reopened.root, '系统移动方式预设 1')).includes('行走'), 'An empty movement custom list must retain read-only system choices');
    assert.equal(input(reopened.root, '移动方式 1 显示名称'), undefined);
    assert.equal(input(reopened.root, '选项卡样式 1 显示名称'), undefined);
    for (const title of ['对话类型', '选项卡样式']) {
      const panel = stylePanel(card(reopened.root, `系统${title}预设 1`)), expected = expectedStyleParameters.get(title);
      assert.equal(panel.open, false, 'Reopening resets only the parameter fold state');
      assert.deepEqual(styleRows(panel).map((row, index) => input(row, `系统${title} 1 参数 ${index + 1} 名称`).value), expected.names);
      assert.deepEqual(styleRows(panel).map((row, index) => input(row, `系统${title} 1 参数 ${index + 1} 默认值`).value), expected.defaults);
      assert.equal(input(card(reopened.root, '系统选项卡样式预设 1'), '系统选项卡样式 1 类型值'), undefined);
    }
    const reopenedPanel = all(reopened.root, node => node.tag === 'div' && hasClass(node, 'public-parameters'))[0];
    assert.equal(reopenedPanel.style.display, 'none');
    assert.equal(input(reopenedPanel, '公共事件参数默认值').value, '120');
    assert.match(text(parameterToggle(reopenedPanel)), /3 项/);
    await toggleParameters(reopenedPanel);
    const reopenedRow = all(reopenedPanel, node => node.tag === 'div' && hasClass(node, 'public-param-row'))[0];
    const reopenedRules = visibilityRules(reopenedRow);
    assert.equal(reopenedRules.length, 2);
    assert.equal(input(reopenedRules[0], '显示条件匹配值').value, '2');
    assert.equal(select(reopenedRules[1], '显示条件匹配值').props.value, 1, 'Reopening must retain the Bool condition matching 是');
    await toggleParameters(reopenedPanel);
    assert.equal(writes.length, savedWrites, 'Reopening the editor must not rewrite saved snapshots');
    console.log('PASS reopening restores fixed system labels, edited values and collapsed parameter settings, with deleted custom entries absent');

    const SelectEditor = require(path.join(base, 'DialogueEditor/components/clip-editors/SelectClipEditor.vue')).default;
    const newClip = style => vue.reactive({ id: 'test-select', style, options: [], params: [] });
    function mountSelectConsumer(workspaceId, clip) {
      let state;
      const Consumer = vue.defineComponent({ setup() {
        state = useStylePresets('selectStyles');
        vue.provide('selectStyleOptions', state.options);
        vue.provide('selectStylePresetsReady', state.ready);
        return () => vue.h(SelectEditor, { clip });
      } });
      const consumerRoot = element('root'), consumerApp = renderer.createApp(Consumer);
      consumerApp.provide('storage', storage); consumerApp.provide('selectedWorkspaceId', vue.ref(workspaceId));
      consumerApp.mount(consumerRoot); mounted.push(consumerApp);
      return { app: consumerApp, root: consumerRoot, state };
    }
    const clip = newClip('Default_UI'), consumer = mountSelectConsumer(workspace.value, clip);
    const other = mountSelectConsumer('other-select-workspace', newClip('Default_UI'));
    await settle();
    const selectField = surface => select(surface, '选项样式');
    const optionLabels = surface => selectField(surface).props.options.map(option => option.label);
    assert.deepEqual(optionLabels(consumer.root), ['默认样式（Default_UI）']);
    const reopenedNav = find(reopened.root, node => node.tag === 'nav' && node.props['aria-label'] === '预设分类');
    dispatch(find(reopenedNav, node => node.tag === 'button' && text(node) === '选项卡样式'), 'click'); await vue.nextTick();
    assert.deepEqual([...clip.params], ['0', '3'], 'Opening a loaded system option style supplies its declared defaults');
    assert.equal(input(consumer.root, '选项卡参数 选项数量').value, '3');
    assert.equal(all(consumer.root, node => node.tag === 'button' && /添加入参|删除参数|上移参数|下移参数/.test(text(node) + (node.props['aria-label'] ?? ''))).length, 0, 'Nodes fill declared parameters without changing the parameter definition list');
    const optionSource = select(consumer.root, '选项卡参数 获取方式预设值');
    assert.ok(optionSource);
    assert.deepEqual(optionSource.props.options.map(option => option.label), ['GUID', 'String']);
    await chooseLabel(optionSource, 'String');
    await enter(input(consumer.root, '选项卡参数 选项数量'), '9');
    assert.deepEqual([...clip.params], ['1', '9'], 'Option manual fields and reference selections copy integer strings into the clip');
    await enter(input(reopened.root, '系统选项卡样式 1 参数 2 默认值'), '6');
    await reopened.instance.prepareToLeave(); await settle();
    assert.deepEqual([...clip.params], ['1', '9'], 'Saving a preset retains a node parameter snapshot and its entered values');
    await click(consumer.root, '应用预设参数（恢复默认值）');
    assert.deepEqual([...clip.params], ['0', '6'], 'Explicit reapplication reads updated definitions and resets to their defaults');

    const DialogueEditor = require(path.join(base, 'DialogueEditor/components/clip-editors/DialogueClipEditor.vue')).default;
    const dialogueClip = vue.reactive({ id: 'test-dialogue', style: 'NOLOC_Workspace_dialogueStyles', nodeGraphEvent: [],
      content: '', speaker: '', subtitle: '', advanceMode: 'PlayerInput', autoContinue: -1 });
    let dialogueState;
    const DialogueConsumer = vue.defineComponent({ setup() {
      dialogueState = useStylePresets('dialogueStyles');
      vue.provide('dialogueStyleOptions', dialogueState.options);
      vue.provide('dialogueStylePresetsReady', dialogueState.ready);
      return () => vue.h(DialogueEditor, { clip: dialogueClip });
    } });
    const dialogueRoot = element('root'), dialogueApp = renderer.createApp(DialogueConsumer);
    dialogueApp.provide('storage', storage); dialogueApp.provide('selectedWorkspaceId', vue.ref(workspace.value));
    dialogueApp.mount(dialogueRoot); mounted.push(dialogueApp); await settle();
    assert.deepEqual([...dialogueClip.nodeGraphEvent], ['42', '12']);
    assert.equal(input(dialogueRoot, '对话参数 次数').value, '12');
    assert.equal(all(dialogueRoot, node => node.tag === 'button' && /添加入参|删除参数|上移参数|下移参数/.test(text(node) + (node.props['aria-label'] ?? ''))).length, 0);
    const dialogueSource = select(dialogueRoot, '对话参数 配置编号预设值');
    assert.ok(dialogueSource.props.options.some(option => option.value === '42'));
    const alternateConfig = dialogueSource.props.options.find(option => option.value !== '42' && !option.disabled);
    assert.ok(alternateConfig, 'Referenced skill presets provide other integer configuration records');
    dialogueSource.props.choose(alternateConfig.value); await vue.nextTick();
    await enter(input(dialogueRoot, '对话参数 次数'), '-5');
    assert.deepEqual([...dialogueClip.nodeGraphEvent], [alternateConfig.value, '-5']);
    dispatch(find(reopenedNav, node => node.tag === 'button' && text(node) === '对话类型'), 'click'); await vue.nextTick();
    await enter(input(reopened.root, '系统对话类型 1 参数 1 默认值'), '120');
    await reopened.instance.prepareToLeave(); await settle();
    assert.deepEqual([...dialogueClip.nodeGraphEvent], [alternateConfig.value, '-5'], 'Dialogue values stay intact when the workspace preset changes');
    await click(dialogueRoot, '应用预设参数（恢复默认值）');
    assert.deepEqual([...dialogueClip.nodeGraphEvent], ['120', '12']);
    assert.equal(dialogueClip.parameterPreset.parameters[0].defaultValue, '120');
    assert.ok(select(dialogueRoot, '对话参数 配置编号预设值').props.options.some(option => option.value === '120' && option.disabled), 'An unmatched referenced default stays visible as the saved current value');
    console.log('PASS dialogue and option nodes show named manual and referenced integer fields, copy defaults after loading, preserve entered snapshots and explicitly reapply changed definitions');
    dispatch(find(reopenedNav, node => node.tag === 'button' && text(node) === '选项卡样式'), 'click'); await vue.nextTick();
    await click(reopened.root, '＋ 新建选项卡样式预设');
    assert.equal(input(reopened.root, '选项卡样式 1 显示名称').value, '', 'New select-style names come from blank central defaults');
    assert.equal(input(reopened.root, '选项卡样式 1 类型值').value, '');
    await enter(input(reopened.root, '选项卡样式 1 显示名称'), '工作区选项');
    await enter(input(reopened.root, '选项卡样式 1 类型值'), 'Custom_UI');
    const beforeBroadcast = writes.length;
    await reopened.instance.prepareToLeave(); await settle();
    assert.deepEqual(optionLabels(consumer.root), ['默认样式（Default_UI）', '工作区选项（Custom_UI）'], 'Saved select presets refresh an already mounted clip editor');
    assert.deepEqual(optionLabels(other.root), ['默认样式（Default_UI）'], 'Select presets are isolated by workspace');
    assert.equal(writes.length, beforeBroadcast + 1, 'Consumers must not write the received snapshot back');
    await chooseLabel(selectField(consumer.root), '工作区选项（Custom_UI）');
    assert.equal(clip.style, 'Custom_UI', 'Selecting a custom preset stores the actual style value in the clip');
    await enter(input(reopened.root, '选项卡样式 1 类型值'), 'Custom_UI_v2');
    await reopened.instance.prepareToLeave(); await settle();
    assert.equal(clip.style, 'Custom_UI', 'Changing a preset never rewrites saved clip styles');
    assert.ok(optionLabels(consumer.root).some(label => label.includes('Custom_UI（当前值）')), 'A saved value absent from presets remains selectable');
    await chooseLabel(selectField(consumer.root), '工作区选项（Custom_UI_v2）');
    assert.equal(clip.style, 'Custom_UI_v2');
    await click(reopened.root, '删除选项卡样式预设 1', true);
    await reopened.instance.prepareToLeave(); await settle();
    assert.equal(clip.style, 'Custom_UI_v2');
    assert.deepEqual(optionLabels(consumer.root), ['Custom_UI_v2（当前值）', '默认样式（Default_UI）']);
    consumer.app.unmount(); mounted.splice(mounted.indexOf(consumer.app), 1);
    const reopenedConsumer = mountSelectConsumer(workspace.value, clip); await settle();
    assert.deepEqual(optionLabels(reopenedConsumer.root), ['Custom_UI_v2（当前值）', '默认样式（Default_UI）'], 'Reloading keeps unregistered historical styles and the immutable default');
    console.log('PASS select presets refresh mounted clip editors, select actual values, isolate workspaces and retain historical values through edits, deletion and reload');

    const legacyFile = '/legacy-select-workspace/selectStyles.json';
    const seed = config.selectStyles.presets[0], editedSeed = { ...seed, label: '旧系统副本', value: 'Legacy_UI' };
    const existingCustom = { id: `custom:${seed.id}`, label: '既有预设', value: 'Existing_UI' };
    const legacyRaw = encodeStylePresets('selectStyles', [editedSeed, existingCustom]);
    files.set(legacyFile, legacyRaw);
    const legacy = mountSelectConsumer('legacy-select-workspace', newClip('Legacy_UI')); await settle();
    assert.equal(files.get(legacyFile), legacyRaw, 'Reading a legacy snapshot must preserve its original bytes until edited');
    assert.deepEqual(JSON.parse(JSON.stringify(legacy.state.systemPresets.value)), [seed]);
    assert.deepEqual(JSON.parse(JSON.stringify(legacy.state.customPresets.value)), [
      { ...editedSeed, id: `custom:${seed.id}:copy` }, { ...existingCustom, parameters: [] },
    ], 'Edited legacy system snapshots migrate to custom rows without colliding with existing IDs');
    assert.deepEqual(optionLabels(legacy.root), ['默认样式（Default_UI）', '旧系统副本（Legacy_UI）', '既有预设（Existing_UI）']);
    legacy.state.customPresets.value[0].label = '保留旧值'; await legacy.state.flush();
    const migrated = JSON.parse(files.get(legacyFile));
    assert.equal(migrated.presetStorage, 'system-overrides'); assert.deepEqual(migrated.systemOverrides, []);
    assert.deepEqual(migrated.presets.map(preset => preset.id), [`custom:${seed.id}:copy`, existingCustom.id]);
    assert.equal(migrated.presets[0].value, 'Legacy_UI');
    files.set('/corrupt-select-workspace/selectStyles.json', 'broken select preset bytes');
    const corrupt = mountSelectConsumer('corrupt-select-workspace', newClip('Legacy_UI')); await settle();
    assert.equal(corrupt.state.ready.value, false); assert.ok(corrupt.state.error.value);
    await corrupt.state.flush();
    assert.equal(files.get('/corrupt-select-workspace/selectStyles.json'), 'broken select preset bytes');
    console.log('PASS select legacy edited snapshots migrate to custom entries with stable existing IDs, while corrupt files retain their bytes');
  } finally { for (const app of mounted.reverse()) app.unmount(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  for (const [extension, loader] of Object.entries(originalExtensions)) {
    if (loader) Module._extensions[extension] = loader;
    else delete Module._extensions[extension];
  }
  if (originalDocument === undefined) delete global.document;
  else global.document = originalDocument;
});
