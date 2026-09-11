// node scripts/test-effect-media-readiness.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
class Media extends EventTarget {
  readyState = 0;
  error = null;
  setAttribute() {}
  remove() {}
  emit(type, readyState = this.readyState) {
    this.readyState = readyState;
    this.dispatchEvent(new Event(type));
  }
}
const context = {
  exports: {},
  document: { createElement: () => new Media() },
  require(name) {
    if (name === 'vue') return { reactive: value => value };
    if (name === '@/utils/oss') return { createOss: () => ({ path: (...parts) => parts.join('/') }) };
    if (name === './mediaPool') return { createMediaPool: () => ({ acquire: (_key, create) => ({ value: create() }) }) };
    if (name === './synchronizedMedia') return { createSynchronizedMedia: () => ({ dispose() {} }) };
    throw new Error(name);
  },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/views/EffectPlayer/cachedEffectMedia.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, context);
const acquire = item => context.exports.acquireEffectMedia({ id: '30', ...item }, 'card').value;
const group = acquire({ standPath: '30.webm', tailPath: 'tail.webm', hasAudio: true, audioPath: '30.opus' });
assert.equal(group.state.ready, false);
assert.equal(group.stand.poster, undefined, 'A loading video does not display its icon as a poster');
group.stand.emit('canplay', 3);
group.tail.emit('canplay', 3);
assert.equal(group.state.ready, false, 'Ready videos must still wait for audio');
group.audio.emit('loadeddata', 2);
assert.equal(group.state.ready, false, 'A first frame alone is insufficient');
group.audio.emit('canplay', 3);
assert.equal(group.state.ready, true);
group.stand.emit('loadeddata', 2);
assert.equal(group.state.ready, true, 'A loaded group stays visible during loop seeking');
group.audio.error = new Error('Failed');
group.audio.emit('error');
assert.equal(group.state.ready, false, 'An unavailable track hides the incomplete group');
group.audio.error = null;
group.audio.emit('emptied', 0);
group.audio.emit('canplay', 3);
assert.equal(group.state.ready, true, 'Retry restores the group when all tracks are ready');
group.dispose();
group.audio.emit('emptied', 0);
assert.equal(group.state.ready, true, 'Disposal removes readiness listeners');
const single = acquire({ standPath: '30.webm' });
single.stand.emit('canplay', 3);
assert.equal(single.state.ready, true, 'Absent optional tracks do not block preview');
const tailFirst = acquire({ standPath: '30.webm', tailPath: 'tail.webm' });
tailFirst.tail.emit('canplay', 3);
assert.equal(tailFirst.state.ready, false, 'A ready tail still waits for the main video');
tailFirst.stand.emit('canplay', 3);
assert.equal(tailFirst.state.ready, true);
console.log('PASS all-track readiness, no loading poster, optional tracks, loops, errors, retries, cleanup');
