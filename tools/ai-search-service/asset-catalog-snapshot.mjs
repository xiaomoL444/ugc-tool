// Store already verified runtime data in bounded structured values. No complete
// catalog is serialized, cloned, or cached by the storage layer while saving it.
export const ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES = 512 * 1024;
const PREFIX = 'asset-catalog-snapshot:v1:';
const MANIFEST_KEY = PREFIX + 'manifest';
const SCHEMA_VERSION = 1;
const storageOptions = { noCache: true };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);

export class AssetCatalogSnapshotError extends Error {
  constructor(code = 'ASSET_CATALOG_SNAPSHOT_INVALID') {
    super(code); this.name = 'AssetCatalogSnapshotError'; this.code = code;
  }
}
const invalid = () => { throw new AssetCatalogSnapshotError(); };
const tooLarge = () => { throw new AssetCatalogSnapshotError('ASSET_CATALOG_SNAPSHOT_TOO_LARGE'); };

// Calculate JSON UTF-8 size without allocating a serialized string. In
// particular, an oversized individual asset is rejected before serialization.
function boundedBytes(value, limit = ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES) {
  let bytes = 0;
  const path = new Set();
  const add = count => { bytes += count; if (bytes > limit) tooLarge(); };
  const string = text => {
    add(2);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { add(4); index += 1; }
        else add(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) add(6);
      else add(3);
    }
  };
  const visit = (item, depth) => {
    if (depth > 32) invalid();
    if (item === null || item === undefined) { add(4); return; }
    if (typeof item === 'string') { string(item); return; }
    if (typeof item === 'boolean') { add(item ? 4 : 5); return; }
    if (typeof item === 'number') { if (!Number.isFinite(item)) invalid(); add(String(item).length); return; }
    if (typeof item !== 'object' || path.has(item)) invalid();
    const array = Array.isArray(item);
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) invalid();
    path.add(item); add(2); let count = 0;
    if (array) {
      for (const child of item) { if (count++) add(1); visit(child, depth + 1); }
    } else {
      for (const key in item) {
        if (!own(item, key)) continue;
        if (count++) add(1); string(key); add(1); visit(item[key], depth + 1);
      }
    }
    path.delete(item);
  };
  visit(value, 0); return bytes;
}

function* postingEntries(postings) {
  for (const term in postings) if (own(postings, term)) yield [term, postings[term]];
}
const generationPrefix = generation => PREFIX + 'g:' + generation + ':';
const chunkKey = (generation, sourceIndex, kind, index) => generationPrefix(generation) + sourceIndex + ':' + kind + ':' + index;
const validCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
const validMarker = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
const validSync = (sync, markerVersion) => object(sync) && ['ready', 'stale'].includes(sync.status)
  && object(sync.hashes) && ['sound', 'effect', 'bgm'].every(kind => typeof sync.hashes[kind] === 'string' && sync.hashes[kind].length > 0)
  && ['checkedAt', 'markerCheckedAt', 'lastGoodAt', 'updatedAt'].every(key => sync[key] === undefined || (Number.isFinite(sync[key]) && sync[key] >= 0))
  && (sync.markerVersion === undefined || sync.markerVersion === markerVersion)
  && (sync.errorCode === undefined || typeof sync.errorCode === 'string');
const validDescriptor = descriptor => object(descriptor) && object(descriptor.header) && object(descriptor.lexicalHeader)
  && descriptor.lexicalHeader.format === 'uint32-base64-v1'
  && ['assets', 'docs', 'postings'].every(kind => object(descriptor[kind]) && validCount(descriptor[kind].chunks) && validCount(descriptor[kind].count));

export function createAssetCatalogSnapshotStore(storage, { baseIndexVersion } = {}) {
  if (!storage || !['get', 'put', 'delete', 'list'].every(method => typeof storage[method] === 'function')
      || typeof baseIndexVersion !== 'string' || !baseIndexVersion) throw new TypeError('Snapshot storage and baseIndexVersion are required');
  let queue = Promise.resolve();
  const serial = operation => {
    const result = queue.then(operation); queue = result.catch(() => {}); return result;
  };
  const validManifest = (manifest, base) => object(manifest) && manifest.schemaVersion === SCHEMA_VERSION
    && manifest.base === base && manifest.baseIndexVersion === baseIndexVersion
    && typeof manifest.generation === 'string' && /^[a-f0-9-]{36}$/i.test(manifest.generation)
    && validMarker(manifest.markerVersion) && validSync(manifest.sync, manifest.markerVersion)
    && Array.isArray(manifest.sources) && manifest.sources.length === 3 && manifest.sources.every(validDescriptor);
  const clean = async generation => {
    if (typeof generation !== 'string' || !/^[a-f0-9-]{36}$/i.test(generation)) return;
    const prefix = generationPrefix(generation);
    // list() returns values too; eight chunks bound the cleanup's live memory.
    for (;;) {
      const found = await storage.list({ prefix, limit: 8, ...storageOptions });
      const keys = [...found.keys()]; if (!keys.length) return;
      await storage.delete(keys);
    }
  };
  const writeGroups = async (generation, sourceIndex, kind, records) => {
    const overhead = boundedBytes({ kind, items: [] });
    let items = [], size = overhead, count = 0, chunks = 0;
    const flush = async () => {
      if (!items.length) return;
      await storage.put(chunkKey(generation, sourceIndex, kind, chunks++), { kind, items }, storageOptions);
      items = []; size = overhead;
    };
    for (const record of records) {
      const recordSize = boundedBytes(record, ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES - overhead);
      if (size + recordSize + (items.length ? 1 : 0) > ASSET_CATALOG_SNAPSHOT_CHUNK_BYTES) await flush();
      size += recordSize + (items.length ? 1 : 0); items.push(record); count += 1;
    }
    await flush(); return { chunks, count };
  };
  const readGroups = async (generation, sourceIndex, kind, descriptor, accept) => {
    if (!object(descriptor) || !validCount(descriptor.chunks) || !validCount(descriptor.count)) invalid();
    let count = 0;
    for (let index = 0; index < descriptor.chunks; index += 1) {
      const chunk = await storage.get(chunkKey(generation, sourceIndex, kind, index), storageOptions);
      if (!object(chunk) || chunk.kind !== kind || !Array.isArray(chunk.items) || !chunk.items.length) invalid();
      for (const record of chunk.items) { accept(record); count += 1; }
    }
    if (count !== descriptor.count) invalid();
  };
  return {
    readMetadata(base) {
      return serial(async () => {
        const manifest = await storage.get(MANIFEST_KEY, storageOptions);
        return validManifest(manifest, base) ? { sync: manifest.sync, markerVersion: manifest.markerVersion } : null;
      });
    },
    read(base) {
      return serial(async () => {
        const manifest = await storage.get(MANIFEST_KEY, storageOptions);
        if (!validManifest(manifest, base)) return null;
        try {
          const sources = [];
          for (let sourceIndex = 0; sourceIndex < manifest.sources.length; sourceIndex += 1) {
            const descriptor = manifest.sources[sourceIndex];
            const assets = [], docs = [], postings = {};
            await readGroups(manifest.generation, sourceIndex, 'assets', descriptor.assets, asset => { if (!object(asset)) invalid(); assets.push(asset); });
            await readGroups(manifest.generation, sourceIndex, 'docs', descriptor.docs, doc => { if (!Array.isArray(doc)) invalid(); docs.push(doc); });
            // Share common packed strings across chunks without retaining a
            // second term-sized table. This is the JSON reader's bounded FIFO.
            const postingValues = new Map();
            await readGroups(manifest.generation, sourceIndex, 'postings', descriptor.postings, entry => {
              if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string' || own(postings, entry[0])) invalid();
              let value = entry[1];
              const previous = postingValues.get(value);
              if (previous !== undefined) value = previous;
              else {
                if (postingValues.size >= 4096) postingValues.delete(postingValues.keys().next().value);
                postingValues.set(value, value);
              }
              Object.defineProperty(postings, entry[0], { value, enumerable: true, configurable: true, writable: true });
            });
            postingValues.clear();
            sources.push({ ...descriptor.header, assets, lexical: { ...descriptor.lexicalHeader, docs, postings } });
          }
          return { sources, sync: manifest.sync, markerVersion: manifest.markerVersion };
        } catch (error) {
          if (error instanceof AssetCatalogSnapshotError) return null;
          throw error;
        }
      });
    },
    updateSync(base, sync) {
      return serial(async () => {
        const manifest = await storage.get(MANIFEST_KEY, storageOptions);
        if (!validManifest(manifest, base)) return false;
        if (!validSync(sync, manifest.markerVersion)) invalid();
        const updated = { ...manifest, sync }; boundedBytes(updated);
        await storage.put(MANIFEST_KEY, updated, storageOptions);
        return true;
      });
    },
    write(base, { sources, sync, markerVersion }) {
      return serial(async () => {
        if (typeof base !== 'string' || !base || !Array.isArray(sources) || sources.length !== 3 || !validMarker(markerVersion) || !validSync(sync, markerVersion)) invalid();
        const previous = await storage.get(MANIFEST_KEY, storageOptions);
        const generation = crypto.randomUUID();
        let committed = false;
        try {
          const descriptors = [];
          for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
            const source = sources[sourceIndex];
            if (!object(source) || !Array.isArray(source.assets) || !object(source.lexical)
                || source.lexical.format !== 'uint32-base64-v1' || !Array.isArray(source.lexical.docs) || !object(source.lexical.postings)) invalid();
            const { assets, lexical, ...header } = source;
            const { docs, postings, ...lexicalHeader } = lexical;
            boundedBytes(header); boundedBytes(lexicalHeader);
            descriptors.push({ header, lexicalHeader,
              assets: await writeGroups(generation, sourceIndex, 'assets', assets),
              docs: await writeGroups(generation, sourceIndex, 'docs', docs),
              postings: await writeGroups(generation, sourceIndex, 'postings', postingEntries(postings)) });
          }
          const manifest = { schemaVersion: SCHEMA_VERSION, base, baseIndexVersion, generation, sources: descriptors, sync, markerVersion };
          boundedBytes(manifest);
          // A single atomic small-value write publishes the complete generation.
          await storage.put(MANIFEST_KEY, manifest, storageOptions); committed = true;
        } catch (error) {
          if (!committed) { try { await clean(generation); } catch { /* An orphan can be cleaned later; never mask the failed write. */ } }
          throw error;
        }
        // Reads and writes on this store share the queue, so no reader can still
        // be fetching the retired generation when its chunks are deleted.
        if (previous?.generation && previous.generation !== generation) {
          try { await clean(previous.generation); } catch { /* Publication succeeded; cleanup failure must not roll it back. */ }
        }
      });
    },
  };
}
