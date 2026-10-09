import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildAgentPrompt, runAssetAgent } from './agent-runtime.mjs';
import { validateModelResult } from './worker.mjs';

// Real local prompt and production runtime, with all provider replies injected.
// This verifies evidence retention beyond the former byte cap, not model understanding.
const sourcePrompt = await readFile(new URL('./SystemPrompt.md', import.meta.url), 'utf8');
const config = {
  upstream: 'https://provider.invalid/chat/completions', model: 'mock-budget-model',
  maxMessages: 12, maxCandidates: 50, maxQueryLength: 2000,
  maxOutputTokens: 5400, timeoutMs: 30000, agentTimeoutMs: 55000,
  inputRate: 0, outputRate: 0, costSafety: 1,
};
const request = { query: '装置反馈，先比较两种声音路线，再核对必要详情。',
  scope: 'sound', matchOn: 'audio', locale: 'zh-CN', includeEffectAudio: true,
  resultLimit: 10, previousIds: [], messages: [] };
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const toolResponse = calls => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls',
  message: { content: null, tool_calls: calls } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
const finalResponse = ids => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
  content: JSON.stringify({ answer: '这些真实声音可供比较，具体用途请结合场景试听。',
    matches: ids.map(resourceId => ({ resourceId, reason: '用途建议：已有音轨观察可考虑作为装置反馈。', matchType: 'suggestion' })) }),
} }], usage: { prompt_tokens: 100, completion_tokens: 30 } }));

function makeEffects(start, count) {
  return Array.from({ length: count }, (_, offset) => {
    const id = start + offset, audio = `AUDIO_${id}_短促金属共鸣。` + '音轨观察清脆起音然后迅速衰减。'.repeat(80);
    return { resourceId: `effect:${id}`, kind: 'effect', title: `装置状态候选${id}`,
      description: audio, shortDescription: audio, audioDescription: audio, audioShortDescription: audio,
      keywords: ['短促', '清脆', '金属感', '共鸣', '快速衰减', '明亮'],
      audioKeywords: ['短促', '清脆', '金属感', '共鸣', '快速衰减', '明亮'],
      suggestedUses: Array.from({ length: 4 }, (_, n) => `音轨用途${n}：` + '可以考虑用于装置状态确认。'.repeat(18)),
      audioSuggestedUses: Array.from({ length: 4 }, (_, n) => `音轨用途${n}：` + '可以考虑用于装置状态确认。'.repeat(18)),
      hasAudio: true, audioMatch: true, matchType: 'feature', duration: 0.7, descriptionLocale: 'zh-CN' };
  });
}
function toolValues(body) {
  return body.messages.filter(message => message.role === 'tool').map(message => ({
    callId: message.tool_call_id, value: JSON.parse(message.content),
  }));
}

test('multiple long search replies and five audio details preserve their summaries across model rounds', async t => {
  assert(Buffer.byteLength(sourcePrompt, 'utf8') >= 10000, 'Use the substantive local prompt, not a short fixture');
  assert.match(sourcePrompt, /严格\s*JSON\s*输出规则/u, 'Keep the strict JSON output section');
  assert.match(sourcePrompt, /完整\s*JSON\s*对象[\s\S]{0,100}只输出一个对象/u, 'Keep the single complete JSON object rule');
  assert.match(sourcePrompt, /searchType=both[\s\S]{0,200}searchType=feature/u, 'Keep both use-case and acoustic retrieval routes');
  const first = makeEffects(900000, 10), second = makeEffects(900100, 10);
  const ids = [...first, ...second].map(item => item.resourceId);
  const detailIds = first.slice(0, 5).map(item => item.resourceId);
  const details = first.slice(0, 5).map(item => ({ ...item, audioMatch: undefined,
    description: `VISUAL_${item.resourceId}_` + '白色光团扩散。'.repeat(90),
    fullDescription: 'VISUAL_DETAIL_' + '光团逐渐缩小消失。'.repeat(90),
    visualDescription: 'VISUAL_ONLY_' + '光团逐渐缩小消失。'.repeat(90),
    keywords: ['VISUAL_KEYWORD'], suggestedUses: ['VISUAL_USE'],
    audioDescription: item.audioDescription + '音轨原始长详情仍应留在known。'.repeat(30),
  }));
  const before = structuredClone({ first, second, details });
  const sent = []; let searchCalls = 0, detailCalls = 0;
  const completed = await runAssetAgent(request, buildAgentPrompt(request, config, sourcePrompt), config,
    { UPSTREAM_API_KEY: 'in-memory-mock-budget-key' }, {
      search: async args => {
        searchCalls++;
        return { catalogVersion: 'budget-fixture', mode: 'keyword', total: 10,
          items: args.query === '短促 金属' ? first : second, nextCursor: 'next-page' };
      },
      assets: async args => {
        detailCalls++; assert.deepEqual(args.ids, detailIds);
        return { catalogVersion: 'budget-fixture', items: details, missingIds: [] };
      },
    }, validateModelResult, async (_url, input) => {
      const body = JSON.parse(input.body); sent.push(body);
      if (sent.length === 1) return toolResponse([
        call('long-search-a', 'search_assets', { query: '短促 金属', searchType: 'feature', limit: 10 }),
        call('long-search-b', 'search_assets', { query: '清脆 共鸣', searchType: 'feature', limit: 10 }),
      ]);
      const values = toolValues(body);
      const searches = values.filter(row => row.callId.startsWith('long-search'));
      assert.equal(searches.length, 2);
      assert.deepEqual(searches.flatMap(row => row.value.items.map(item => item.resourceId)), ids);
      assert(searches.every(row => row.value.catalogVersion === 'budget-fixture' && row.value.total === 10 && row.value.nextCursor === 'next-page'));
      assert(searches.flatMap(row => row.value.items).every(item => item.audioMatch === true && item.hasAudio === true && item.matchType === 'feature'));
      assert(searches.every(row => !row.value.summariesShortened));
      assert(searches.flatMap(row => row.value.items).every(item => item.description.length === 260));
      if (sent.length === 2) return toolResponse([call('long-details', 'get_assets', { ids: detailIds })]);
      const detailValue = values.find(row => row.callId === 'long-details').value;
      assert.deepEqual(detailValue.items.map(item => item.resourceId), detailIds);
      assert.deepEqual(detailValue.missingIds, []);
      assert(!detailValue.summariesShortened);
      for (const item of detailValue.items) {
        assert.equal(item.audioMatch, true);
        assert(item.audioDescription.startsWith('AUDIO_'));
        assert.equal(item.audioDescription.length, 600);
        assert(item.description.startsWith('AUDIO_'));
        assert(!item.audioDescription.includes('VISUAL_'));
        assert(item.visualDescription.startsWith('VISUAL_'));
        assert(item.audioKeywords.every(word => !word.includes('VISUAL_')));
        assert(item.keywords.every(word => !word.includes('VISUAL_')));
        assert(item.suggestedUses.every(use => !use.includes('VISUAL_')));
      }
      assert.equal(body.tool_choice, 'none');
      return finalResponse(detailIds);
    }).catch(error => {
      error.message += ` (searches=${searchCalls}, details=${detailCalls}, modelRequests=${sent.length})`;
      if (sent.length === 2) error.message += ` lastPromptBytes=${Buffer.byteLength(JSON.stringify({ messages: sent[1].messages, tools: sent[1].tools }))}`;
      throw error;
    });
  assert.equal(sent.length, 3);
  assert.equal(searchCalls, 2);
  assert.equal(detailCalls, 1);
  assert.equal(completed.rounds, 3);
  assert.deepEqual([...completed.records.keys()], ids);
  assert.deepEqual(completed.result.matches.map(match => match.resourceId), detailIds);
  assert.deepEqual({ first, second, details }, before, 'Tool summaries must not modify handler source data');
  for (const item of second) assert.equal(completed.records.get(item.resourceId).audioDescription, item.audioDescription);
  for (const item of details) {
    const known = completed.records.get(item.resourceId);
    assert.equal(known.audioDescription, item.audioDescription);
    assert.equal(known.visualDescription, item.visualDescription);
    assert.deepEqual(known.audioKeywords, item.audioKeywords);
  }
  const beforeDetails = toolValues(sent[1]).filter(row => row.callId.startsWith('long-search')).map(row => row.value);
  const afterDetails = toolValues(sent[2]).filter(row => row.callId.startsWith('long-search')).map(row => row.value);
  assert.deepEqual(afterDetails, beforeDetails, 'Adding details must preserve the earlier search evidence');
  assert(Buffer.byteLength(JSON.stringify(sent[2]), 'utf8') > 30000, 'The long transcript should exceed the former cap');
  const finalSearchItems = afterDetails.flatMap(value => value.items);
  const finalDetailItems = toolValues(sent[2]).find(row => row.callId === 'long-details').value.items;
  t.diagnostic(JSON.stringify({ localPromptBytes: Buffer.byteLength(sourcePrompt, 'utf8'),
    modelRequestBytes: sent.map(body => Buffer.byteLength(JSON.stringify(body), 'utf8')),
    shortestSearchDescriptionChars: Math.min(...finalSearchItems.map(item => item.description.length)),
    shortestDetailAudioDescriptionChars: Math.min(...finalDetailItems.map(item => item.audioDescription.length)),
    shortestDetailVisualDescriptionChars: Math.min(...finalDetailItems.map(item => item.visualDescription.length)) }));
});

test('fifty long tool results reach the final model round without a 30 KB rejection or dropped identities', async () => {
  const items = makeEffects(910000, 50), snapshot = structuredClone(items);
  let modelRequests = 0;
  const completed = await runAssetAgent({ ...request, resultLimit: 50 },
    buildAgentPrompt({ ...request, resultLimit: 50 }, config, sourcePrompt), config,
    { UPSTREAM_API_KEY: 'in-memory-mock-budget-key' }, {
      search: async () => ({ catalogVersion: 'budget-fixture', mode: 'keyword', total: 50, items }),
    }, validateModelResult, async (_url, input) => {
      modelRequests++;
      if (modelRequests === 1) return toolResponse([call('fifty-identities', 'search_assets', { query: '金属', searchType: 'feature', limit: 50 })]);
      assert(Buffer.byteLength(input.body, 'utf8') > 30000);
      const values = toolValues(JSON.parse(input.body));
      assert.deepEqual(values[0].value.items.map(item => item.resourceId), items.map(item => item.resourceId));
      assert(values[0].value.items.every(item => item.description.length === 260 && item.keywords.length === 6));
      return finalResponse(items.map(item => item.resourceId));
    });
  assert.equal(modelRequests, 2);
  assert.equal(completed.rounds, 2);
  assert.equal(completed.result.matches.length, 50);
  assert.deepEqual(items, snapshot);
  assert.equal(new Set(items.map(item => item.resourceId)).size, 50);
});
