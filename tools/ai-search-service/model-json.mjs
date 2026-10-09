import { jsonrepair } from 'jsonrepair';

const MAX_MODEL_JSON_CHARS = 100000;

// Only model-authored final answers use this parser. HTTP envelopes, asset data,
// request bodies and tool arguments retain strict JSON.parse in their callers.
export function parseModelJSON(source) {
  if (typeof source !== 'string' || source.length > MAX_MODEL_JSON_CHARS) {
    throw new SyntaxError('Invalid model JSON input');
  }
  const text = source.replace(/^\uFEFF/, '').trim()
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch (parseError) {
    // The library can append missing data/brackets. Never accept an obviously
    // unfinished outer object/array as a complete answer; finish_reason is also
    // checked by the callers before this parser runs.
    const end = text[0] === '{' ? '}' : text[0] === '[' ? ']' : undefined;
    if (!end || !text.endsWith(end)) throw parseError;
    return JSON.parse(jsonrepair(text));
  }
}
