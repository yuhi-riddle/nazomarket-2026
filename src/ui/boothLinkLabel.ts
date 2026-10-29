export type BoothLinkKind = "site" | "x" | "instagram" | "source";

const shopHosts = ["booth.pm", "stores.jp", "thebase.in", "base.shop"];
const xHosts = new Set(["x.com", "twitter.com"]);
const xReservedPaths = new Set([
  "compose", "explore", "hashtag", "home", "i", "intent", "login", "messages", "notifications", "search", "settings", "share",
]);
const instagramReservedPaths = new Set(["accounts", "direct", "explore", "p", "reel", "reels", "stories"]);

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** 用途を断定せず、URLから分かるリンク先だけを表示する。 */
export function boothLinkLabel(url: string, kind: BoothLinkKind): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (kind === "x" && xHosts.has(host) && segments.length === 1 && !xReservedPaths.has(segments[0].toLowerCase())) {
      return "@" + decodePathSegment(segments[0]);
    }
    if (kind === "instagram" && host === "instagram.com" && segments.length === 1 && !instagramReservedPaths.has(segments[0].toLowerCase())) {
      return "@" + decodePathSegment(segments[0]);
    }

    const path = parsed.pathname.replace(/\/+$/, "");
    const destination = host + path + parsed.search;
    if (kind === "site" && shopHosts.some((shopHost) => isHostOrSubdomain(host, shopHost))) {
      return "ショップ · " + destination;
    }
    return destination;
  } catch {
    return "リンク先を確認";
  }
}
