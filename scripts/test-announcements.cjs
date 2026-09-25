const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const originalTs = Module._extensions[".ts"];
const originalResolve = Module._resolveFilename;
Module._extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
Module._resolveFilename = function(request, parent, ...rest) {
  return originalResolve.call(this, request.startsWith("@/") ? path.join(root, "src", request.slice(2)) : request, parent, ...rest);
};
async function main() {
  const model = require("../src/services/announcements/model.ts");
  const { renderAnnouncement } = require("../src/services/announcements/markdown.ts");
  const index = JSON.parse(fs.readFileSync(path.join(root, "examples/Announcements/index.json"), "utf8"));
  const entries = model.parseAnnouncementIndex(index);
  assert.equal(entries[0].id, "welcome");
  assert.deepEqual(model.parseAnnouncementIndex({ announcements: [] }), []);
  for (const content of ["../secret.md", "/absolute.md", "https://evil.test/a.md", "a/../../b.md", "%2e%2e/a.md", "a.txt"]) {
    assert.throws(() => model.parseAnnouncementIndex({ announcements: [{ ...entries[0], content }] }));
  }
  assert.throws(() => model.parseAnnouncementIndex({ announcements: [entries[0], entries[0]] }));
  assert.throws(() => model.parseAnnouncementIndex({ announcements: [{ ...entries[0], revision: 2 }] }));
  assert.deepEqual(model.parseReadState("{broken"), {});
  assert.deepEqual(model.parseReadState("[]"), {});
  const html = renderAnnouncement('# Heading\n\n**bold**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![pic](../images/a.png)\n\n[link](./other.md)\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))', "https://oss.example/Announcements/posts/test.md");
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /src="https:\/\/oss.example\/Announcements\/images\/a.png"/);
  assert.match(html, /href="https:\/\/oss.example\/Announcements\/posts\/other.md"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert(!/<script|href="javascript:/i.test(html));
  const state = new Map();
  global.localStorage = { getItem: key => state.get(key) ?? null, setItem: (key, value) => state.set(key, value) };
  global.window = { location: { href: "https://tool.example/announcements" }, setTimeout, clearTimeout };
  const service = require("../src/services/announcements/index.ts");
  let requestCount = 0;
  let release;
  global.fetch = async () => { requestCount++; return new Promise(resolve => { release = resolve; }); };
  const first = service.refreshAnnouncements(true);
  const second = service.refreshAnnouncements(true);
  assert.equal(first, second, "Concurrent index requests are deduplicated");
  release({ ok: true, json: async () => index });
  await first;
  assert.equal(requestCount, 1);
  assert.equal(service.unreadCount.value, 2);
  service.markRead(entries[0]);
  assert.equal(service.unreadCount.value, 1);
  service.syncReadState();
  assert.equal(service.isUnread(entries[0]), false);
  assert.equal(service.isUnread({ ...entries[0], revision: "2" }), true);
  state.set(service.readStorageKey, JSON.stringify({ guide: model.announcementVersion(entries[1]) }));
  service.syncReadState();
  assert.equal(service.isUnread(entries[1]), false);
  let receivedUrl;
  global.fetch = async (url) => { receivedUrl = url; return { ok: true, text: async () => "# loaded" }; };
  assert.equal(await service.fetchAnnouncement(entries[0], new AbortController().signal), "# loaded");
  assert.equal(new URL(receivedUrl).searchParams.get("revision"), "1");
  global.fetch = async () => ({ ok: false, status: 503 });
  await service.refreshAnnouncements(true);
  assert.equal(service.indexFailed.value, true);
  assert.equal(service.announcements.value.length, 2, "A failed refresh preserves the existing index");
  await assert.rejects(service.fetchAnnouncement(entries[0], new AbortController().signal));
  global.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
  service.markRead(entries[0]);
  assert.equal(service.isUnread(entries[0]), false, "Storage denial preserves session read state");
  console.log("Announcement checks passed: index validation, Markdown safety and relative assets, unread revisions, persistence, request deduplication and errors.");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._resolveFilename = originalResolve;
  if (originalTs) Module._extensions[".ts"] = originalTs;
  else delete Module._extensions[".ts"];
});
