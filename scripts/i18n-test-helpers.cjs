/* Validate ordinary translated strings and standard Error objects. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { isNativeError } = require('node:util/types');

function publicI18n() {
  const previous = require.extensions['.ts'];
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
  try { return require('../src/i18n/index.ts'); }
  finally {
    if (previous) require.extensions['.ts'] = previous;
    else delete require.extensions['.ts'];
  }
}

function messageText(message) {
  assert.equal(typeof message, 'string', 'Generated messages are ordinary translated strings');
  return message;
}

function messageTexts(messages) {
  assert.ok(Array.isArray(messages), 'Message collections are ordinary arrays');
  assert.equal(Object.hasOwn(messages, 'messages'), false, 'There is no parallel source-string array');
  assert.ok(messages.every(message => typeof message === 'string'), 'Warnings and errors are ordinary translated strings');
  return messages.map(messageText);
}

function errorMatches(pattern) {
  return error => {
    assert.ok(isNativeError(error), 'Business validation rejects with a native Error across VM realms');
    assert.equal(Object.hasOwn(error, 'messageDescriptor'), false, 'Errors have no separate descriptor channel');
    assert.match(messageText(error.message), pattern);
    return true;
  };
}

// Load the real entry with JSON interop before an individual test installs its
// minimal TypeScript loader. This matches the application's compiled imports.
publicI18n();

module.exports = { messageText, messageTexts, errorMatches, publicI18n };
