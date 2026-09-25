import MarkdownIt from "markdown-it";
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });
export function renderAnnouncement(source: string, baseUrl: string) {
  const tokens = markdown.parse(source, {});
  function visit(items: typeof tokens) {
    for (const token of items) {
      const attribute = token.type === "image" ? "src" : token.type === "link_open" ? "href" : null;
      if (attribute) {
        const raw = String(token.attrGet(attribute) || "");
        try {
          const url = new URL(raw, baseUrl);
          const allowed = ["http:", "https:"].includes(url.protocol) ||
            (attribute === "href" && url.protocol === "mailto:");
          token.attrSet(attribute, allowed ? url.href : "");
          if (token.type === "link_open" && allowed) {
            token.attrSet("target", "_blank");
            token.attrSet("rel", "noopener noreferrer");
          }
          if (token.type === "image") {
            token.attrSet("loading", "lazy");
            token.attrSet("referrerpolicy", "no-referrer");
          }
        } catch { token.attrSet(attribute, ""); }
      }
      if (token.children) visit(token.children);
    }
  }
  visit(tokens);
  return markdown.renderer.render(tokens, markdown.options, {});
}
