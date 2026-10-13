/* Generate the editor's flat Vue I18n catalogs from reviewed maintenance data.
 * node scripts/build-client-ui-i18n.cjs build <translation-source-dir> <resource-i18n-dir> <bundled-dir>
 * node scripts/build-client-ui-i18n.cjs collect <source-map.json> <output.json> [scan-root ...]
 * node scripts/build-client-ui-i18n.cjs native <source-map.json> <resources> <output.json> [native-selections.json]
 * Build never writes the maintenance source-map or selects native translations.
 * Every output path is explicit; temporary verification outputs belong outside the repository.
 */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createI18n } = require('vue-i18n');
const { parse: parseSfc } = require('@vue/compiler-sfc');
const { parse: parseTemplate } = require(require.resolve('@vue/compiler-dom', { paths: [path.dirname(require.resolve('@vue/compiler-sfc'))] }));

const namespace = 'clientUIAnimationEditor';
const languages = ['zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ru-ru'];
const projectRoot = path.resolve(__dirname, '..');
const keyPattern = /^clientUIAnimationEditor\.(?:ui(?:\.[a-z][A-Za-z0-9]*)+|category\.\d+)$/;
const placeholderPattern = /\{(\w+)\}/g;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function sourceEntries(sourceMap) {
  if (!sourceMap || typeof sourceMap !== 'object' || !Array.isArray(sourceMap.sources)) {
    throw new Error('Maintenance source-map must contain a sources array');
  }
  const seen = new Set();
  for (const entry of sourceMap.sources) {
    if (!entry || typeof entry.key !== 'string' || !keyPattern.test(entry.key)) {
      throw new Error(`Invalid stable UI key: ${entry?.key}`);
    }
    if (seen.has(entry.key)) throw new Error(`Duplicate UI key: ${entry.key}`);
    seen.add(entry.key);
    if (typeof entry.source !== 'string' || !entry.source.trim()) {
      throw new Error(`Missing source provenance: ${entry.key}`);
    }
  }
  for (const key of seen) {
    const segments = key.split('.');
    for (let length = 1; length < segments.length; length++) {
      const prefix = segments.slice(0, length).join('.');
      if (seen.has(prefix)) throw new Error(`UI key is also a namespace prefix: ${prefix} -> ${key}`);
    }
  }
  return sourceMap.sources;
}

function placeholders(text) {
  // Repeated parameters are significant: {name}{name} differs from {name}.
  return [...text.matchAll(placeholderPattern)].map(match => match[1]).sort();
}

function escapeUiMessage(text) {
  // Vue's literal backslash contains two backslashes and renders one.
  const literalBackslash = "{'" + String.fromCharCode(92, 92) + "'}";
  // One pass avoids escaping the braces introduced by literal interpolation.
  return text.replace(/\{\w+\}|[\\@{}|]/g, token => {
    if (/^\{\w+\}$/.test(token)) return token;
    if (token === '\\') return literalBackslash;
    return `{'${token}'}`;
  });
}

function prepareCatalogs(sourceMap) {
  const entries = sourceEntries(sourceMap);
  const catalogs = Object.fromEntries(languages.map(locale => [locale, {}]));
  for (const entry of entries) {
    if (!entry.translations || typeof entry.translations !== 'object') {
      throw new Error(`Missing reviewed translations: ${entry.key}`);
    }
    const chinese = entry.translations['zh-cn'];
    if (typeof chinese !== 'string' || !chinese.trim()) {
      throw new Error(`Empty translation: zh-cn / ${entry.key}`);
    }
    const expectedParameters = JSON.stringify(placeholders(chinese));
    for (const locale of languages) {
      const raw = entry.translations[locale];
      if (typeof raw !== 'string' || !raw.trim()) {
        throw new Error(`Empty translation: ${locale} / ${entry.key}`);
      }
      if (JSON.stringify(placeholders(raw)) !== expectedParameters) {
        throw new Error(`Placeholder mismatch: ${locale} / ${entry.key}`);
      }
      catalogs[locale][entry.key] = escapeUiMessage(raw);
    }
  }

  // Check the real compiler, including literals next to named interpolation.
  // flatJson expands its input in place; keep generated dictionaries flat.
  const runtimeCatalogs = Object.fromEntries(languages.map(locale => [locale, { ...catalogs[locale] }]));
  const i18n = createI18n({ legacy: false, locale: 'zh-cn', fallbackLocale: false, flatJson: true, missingWarn: false, fallbackWarn: false, messages: runtimeCatalogs });
  try {
    for (const locale of languages) {
      i18n.global.locale.value = locale;
      for (const entry of entries) {
        const raw = entry.translations[locale];
        const params = Object.fromEntries(placeholders(raw).map(name => [name, `__parameter_${name}__`]));
        const expected = raw.replace(placeholderPattern, (_, name) => params[name]);
        let actual;
        try {
          actual = i18n.global.t(entry.key, params);
        } catch (error) {
          throw new Error(`Vue I18n compilation failed: ${locale} / ${entry.key}: ${error.message}`);
        }
        if (actual !== expected) {
          throw new Error(`Vue I18n output changed the text: ${locale} / ${entry.key}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
        }
      }
    }
  } finally {
    i18n.dispose();
  }
  return catalogs;
}

function assertOutputOutsideSource(sourceDirectory, outputDirectory) {
  const relative = path.relative(path.resolve(sourceDirectory), path.resolve(outputDirectory));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error(`Generated catalogs must be outside the maintenance directory: ${outputDirectory}`);
  }
}

function build(translationSourceDirectory, resourceDirectory, bundledDirectory) {
  if ([translationSourceDirectory, resourceDirectory, bundledDirectory].some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('Build requires explicit translation-source, resource-i18n, and bundled directories');
  }
  assertOutputOutsideSource(translationSourceDirectory, resourceDirectory);
  assertOutputOutsideSource(translationSourceDirectory, bundledDirectory);
  const sourceMap = readJson(path.join(translationSourceDirectory, 'source-map.json'));
  const catalogs = prepareCatalogs(sourceMap);
  for (const directory of [resourceDirectory, bundledDirectory]) fs.mkdirSync(directory, { recursive: true });
  for (const locale of languages) {
    const bytes = JSON.stringify(catalogs[locale], null, 2) + '\n';
    for (const directory of [resourceDirectory, bundledDirectory]) {
      fs.writeFileSync(path.join(directory, `${locale}.json`), bytes, 'utf8');
    }
  }
  const nativeEntries = sourceMap.sources.filter(entry => entry.origin === 'native-textmap').length;
  return { namespace, languages: [...languages], entries: sourceMap.sources.length, nativeEntries, editorEntries: sourceMap.sources.length - nativeEntries, catalogs };
}

function collect(sourceMapPath, scanRoots) {
  if (typeof sourceMapPath !== 'string' || !sourceMapPath.trim()) throw new Error('Collect requires an explicit maintained source-map path');
  const entries = sourceEntries(readJson(sourceMapPath));
  const maintained = new Map(entries.map(entry => [entry.key, entry]));
  const references = new Map();
  const defaultRoots = [
    path.join(projectRoot, 'src/views/ClientUIAnimationEditor'),
    path.join(projectRoot, 'src/i18n/index.ts'),
    path.join(projectRoot, 'src/configs/routes.ts'),
    path.join(projectRoot, 'src/configs/homePage.json'),
  ].filter(file => fs.existsSync(file));
  const roots = scanRoots === undefined ? defaultRoots : Array.isArray(scanRoots) ? scanRoots : [scanRoots];
  const add = (key, file, line) => {
    if (typeof key !== 'string' || (!key.startsWith(`${namespace}.ui.`) && !key.startsWith(`${namespace}.category.`))) return;
    const location = `${path.relative(projectRoot, file).replace(/\\/g, '/')}:${line}`;
    const locations = references.get(key) ?? [];
    if (!locations.includes(location)) locations.push(location);
    references.set(key, locations);
  };
  function scanScript(content, file, offset = 0) {
    const ast = ts.createSourceFile(`${file}.ts`, content, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        add(node.text, file, offset + ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  function scanFile(file) {
    const source = fs.readFileSync(file, 'utf8');
    if (/\.[cm]?[jt]sx?$/.test(file)) return scanScript(source, file);
    if (file.endsWith('.json')) {
      function visit(value) {
        if (typeof value === 'string') {
          const position = source.indexOf(JSON.stringify(value));
          add(value, file, source.slice(0, Math.max(position, 0)).split('\n').length);
        } else if (value && typeof value === 'object') {
          for (const item of Object.values(value)) visit(item);
        }
      }
      visit(JSON.parse(source.replace(/^\uFEFF/, '')));
      return;
    }
    if (!file.endsWith('.vue')) return;
    const { descriptor, errors } = parseSfc(source, { filename: file });
    if (errors.length) throw new Error(`${file}: ${errors.join(', ')}`);
    for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
      scanScript(block.content, file, block.loc.start.line - 1);
    }
    if (!descriptor.template) return;
    const ast = parseTemplate(descriptor.template.content);
    function visit(node) {
      if (node.type === 5) scanScript(`(${node.content.content})`, file, descriptor.template.loc.start.line + node.loc.start.line - 2);
      for (const prop of node.props ?? []) {
        if (prop.type === 7 && prop.exp) scanScript(`(${prop.exp.content})`, file, descriptor.template.loc.start.line + prop.loc.start.line - 2);
        else if (prop.type === 6 && prop.value) add(prop.value.content, file, descriptor.template.loc.start.line + prop.loc.start.line - 1);
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(ast);
  }
  const visited = new Set();
  function walk(root) {
    const file = path.resolve(root);
    if (visited.has(file)) return;
    visited.add(file);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) {
        if (!['node_modules', '.git', 'dist'].includes(name)) walk(path.join(file, name));
      }
    } else if (stat.isFile() && /\.(vue|json|[cm]?[jt]sx?)$/.test(file)) scanFile(file);
  }
  for (const root of roots) walk(root);
  const messages = [...references].sort(([a], [b]) => a.localeCompare(b)).map(([key, locations]) => ({ key, source: maintained.get(key)?.source ?? null, locations }));
  return { version: 1, namespace, messages, references: messages, missingKeys: messages.filter(entry => !maintained.has(entry.key)).map(entry => entry.key), unusedKeys: entries.filter(entry => !references.has(entry.key)).map(entry => entry.key) };
}

function alignNative(sourceMap, resources, selections = {}) {
  const entries = sourceEntries(sourceMap).map(entry => ({ ...entry, candidates: (entry.candidates ?? []).map(candidate => ({ ...candidate, translations: { ...candidate.translations } })) }));
  const bySource = new Map();
  for (const entry of entries) {
    const matches = bySource.get(entry.source) ?? [];
    matches.push(entry);
    bySource.set(entry.source, matches);
  }
  const suffixes = { 'zh-cn': 'CHS', 'zh-tw': 'CHT', 'en-us': 'EN', 'ja-jp': 'JP', 'ru-ru': 'RU' };
  const candidateFile = candidate => candidate.file ?? `TextMap/${candidate.stem}CHS.json`;
  for (const stem of ['TextMap_Medium', 'TextMap']) {
    const tables = Object.fromEntries(languages.map(locale => [locale, readJson(path.join(resources, 'TextMap', `${stem}${suffixes[locale]}.json`))]));
    for (const [id, chinese] of Object.entries(tables['zh-cn'])) {
      const matches = bySource.get(chinese);
      if (!matches) continue;
      const file = `TextMap/${stem}CHS.json`;
      const candidate = { id, file, translations: Object.fromEntries(languages.map(locale => [locale, tables[locale][id] ?? null])) };
      for (const entry of matches) {
        // Preserve existing evidence verbatim even if a newer native dump differs.
        if (!entry.candidates.some(existing => String(existing.id) === id && candidateFile(existing) === file)) entry.candidates.push(candidate);
      }
    }
  }
  const entryKeys = new Set(entries.map(entry => entry.key));
  for (const key of Object.keys(selections)) {
    if (!entryKeys.has(key)) throw new Error(`Native selection must use a maintained full UI key: ${key}`);
  }
  for (const entry of entries) {
    const review = selections[entry.key];
    if (!review) continue; // Never reselect or overwrite an already reviewed tuple.
    if (review.use === 'editor') {
      if (entry.native) entry.native = { ...entry.native, used: false };
      entry.origin = 'editor-translation';
    } else if (review.id !== undefined) {
      const file = review.file ?? (review.stem ? `TextMap/${review.stem}CHS.json` : undefined);
      const candidates = entry.candidates.filter(candidate => String(candidate.id) === String(review.id) && (!file || candidateFile(candidate) === file));
      if (candidates.length !== 1 || !languages.every(locale => typeof candidates[0].translations[locale] === 'string' && candidates[0].translations[locale].trim())) {
        throw new Error(`Reviewed native key is ambiguous, missing, or incomplete: ${entry.key}`);
      }
      const selected = candidates[0];
      entry.native = { id: selected.id, file: candidateFile(selected), translations: { ...selected.translations }, used: true };
      entry.origin = 'native-textmap';
    } else throw new Error(`Invalid native selection: ${entry.key}`);
    entry.selectionReview = { ...review };
    // Explicitly chosen provenance does not replace maintained UI translations.
  }
  return { ...sourceMap, sources: entries };
}

function write(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'build' && args.length === 3) {
    const report = build(...args);
    console.log(`Built ${report.entries} complete UI keys in ${report.languages.length} languages`);
  } else if (command === 'collect' && args.length >= 2) {
    if (path.resolve(args[0]) === path.resolve(args[1])) throw new Error('Collect cannot overwrite its maintained source-map');
    const report = collect(args[0], args.length > 2 ? args.slice(2) : undefined);
    write(args[1], report);
    console.log(`Found ${report.messages.length} referenced keys; missing ${report.missingKeys.length}; unused ${report.unusedKeys.length}`);
    if (report.missingKeys.length) process.exitCode = 1;
  } else if (command === 'native' && [3, 4].includes(args.length)) {
    if (path.resolve(args[0]) === path.resolve(args[2])) throw new Error('Native alignment cannot overwrite its maintained source-map');
    const report = alignNative(readJson(args[0]), args[1], args[3] ? readJson(args[3]) : {});
    write(args[2], report);
    console.log(`Retained ${report.sources.filter(entry => entry.native?.used).length} reviewed native tuples; preserved all maintained translations`);
  } else {
    throw new Error('Usage: build <translation-source-dir> <resource-i18n-dir> <bundled-dir> | collect <source-map.json> <output.json> [scan-root ...] | native <source-map.json> <resources> <output.json> [native-selections.json]');
  }
}

module.exports = { namespace, languages, build, collect, alignNative, escapeUiMessage };
