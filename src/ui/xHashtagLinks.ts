import { xHashtagUrl } from "../logic/tags.ts";
import { el, safeExternalLink } from "./dom.ts";

export function xHashtagLinks(tags: string[], className: string): HTMLElement | undefined {
  if (!tags.length) return undefined;
  const section = el("section", className);
  section.append(el("h3", "", "X で探す"));
  const list = el("div", "x-hashtag-list");
  for (const tag of tags) {
    const link = safeExternalLink(xHashtagUrl(tag), "#" + tag, "x-hashtag-link");
    if (!link) continue;
    link.setAttribute("aria-label", "#" + tag + " を X で検索（新しいタブ）");
    list.append(link);
  }
  if (!list.childElementCount) return undefined;
  section.append(list);
  return section;
}
