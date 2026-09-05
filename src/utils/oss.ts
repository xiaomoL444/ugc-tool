// 本地通过 vue.config.js 的同源代理读取，避免开发地址/端口受 OSS 的 CORS 白名单限制。
export const OSS_BASE_URL = process.env.VUE_APP_OSS_BASE || (
  process.env.NODE_ENV === "development"
    ? "/ugc-tool-data"
    : "https://oss.xiaomol444.xyz/ugc-tool-data"
);

function normalizeSegment(part: string | number) {
  return String(part)
    .split("/")
    .map((seg) => seg.trim())
    .filter(Boolean);
}

function joinUrl(base: string, ...parts: Array<string | number>) {
  const prefix = base.replace(/\/+$/g, "");
  const segs = parts.flatMap(normalizeSegment).map((seg) => encodeURIComponent(seg));
  return segs.length ? `${prefix}/${segs.join("/")}` : prefix;
}

export class OssClient {
  readonly project: string;
  readonly base: string;

  constructor(project: string, base: string = OSS_BASE_URL) {
    this.project = normalizeSegment(project).join("/");
    this.base = base.replace(/\/+$/g, "");
  }

  /** `https://oss.../ugc-tool-data/EffectPlayer` */
  get root() {
    return joinUrl(this.base, this.project);
  }

  /** 拼接可直接给 img/audio/fetch 用的完整 URL */
  path(...segments: Array<string | number>) {
    return joinUrl(this.base, this.project, ...segments);
  }

  url(...segments: Array<string | number>) {
    return this.path(...segments);
  }

  /** 进入子目录，例如 oss.dir("icon").path("10.png") */
  dir(...segments: Array<string | number>) {
    const next = [this.project, ...segments.flatMap(normalizeSegment)]
      .filter(Boolean)
      .join("/");
    return new OssClient(next, this.base);
  }

  async json<T = unknown>(...segments: Array<string | number>) {
    const res = await fetch(this.path(...segments));
    if (!res.ok) throw new Error(`OSS GET ${res.status}: ${this.path(...segments)}`);
    return (await res.json()) as T;
  }

  async text(...segments: Array<string | number>) {
    const res = await fetch(this.path(...segments));
    if (!res.ok) throw new Error(`OSS GET ${res.status}: ${this.path(...segments)}`);
    return res.text();
  }

  async blob(...segments: Array<string | number>) {
    const res = await fetch(this.path(...segments));
    if (!res.ok) throw new Error(`OSS GET ${res.status}: ${this.path(...segments)}`);
    return res.blob();
  }

  async exists(...segments: Array<string | number>) {
    try {
      const res = await fetch(this.path(...segments), { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }
}

const clients = new Map<string, OssClient>();

/** `const oss = createOss("EffectPlayer")` */
export function createOss(project: string, base: string = OSS_BASE_URL) {
  const key = `${base}::${project}`;
  const cached = clients.get(key);
  if (cached) return cached;
  const client = new OssClient(project, base);
  clients.set(key, client);
  return client;
}

export const oss = createOss;
