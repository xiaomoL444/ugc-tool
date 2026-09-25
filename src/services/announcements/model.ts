export interface Announcement {
  id: string;
  title: string;
  date: string;
  content: string;
  revision: string;
}
export function parseAnnouncementIndex(value: unknown): Announcement[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { announcements?: unknown }).announcements)) {
    throw new Error("Invalid announcement index");
  }
  const seen = new Set<string>();
  return (value as { announcements: unknown[] }).announcements.map(item => {
    if (!item || typeof item !== "object") throw new Error("Invalid announcement");
    const entry = item as Record<string, unknown>;
    for (const key of ["id", "title", "date", "content", "revision"]) {
      if (typeof entry[key] !== "string" || !(entry[key] as string).trim()) throw new Error("Missing announcement field: " + key);
    }
    const { id, title, date, content, revision } = entry as unknown as Announcement;
    if (seen.has(id)) throw new Error("Duplicate announcement id");
    // Paths are relative to the announcement directory, never arbitrary fetch URLs.
    if (!/\.md$/i.test(content) || content.startsWith("/") ||
        content.split("/").some(part => !part || part === "." || part === "..") ||
        /[\\:%?#]/.test(content)) throw new Error("Invalid Markdown path");
    if (!Number.isFinite(Date.parse(date))) throw new Error("Invalid announcement date");
    seen.add(id);
    return { id, title, date, content, revision };
  });
}
export function announcementVersion(item: Announcement): string {
  return JSON.stringify([item.revision, item.content]);
}
export function parseReadState(raw: string | null): Record<string, string> {
  try {
    const data: unknown = JSON.parse(raw || "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === "string"));
  } catch { return {}; }
}
