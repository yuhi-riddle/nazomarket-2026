import type { Booth, Product } from "../types.ts";
import { playStyleOf } from "./insights.ts";

export const FEATURE_TAGS = [
  "新作",
  "限定",
  "持ち帰り",
  "その場で遊べる",
  "1人で遊べる",
  "千円以下",
  "土曜だけ",
  "日曜だけ",
] as const;

export function featureTags(product: Product): string[] {
  const tags: string[] = [];
  if (product.isNew === true) tags.push("新作");
  if (product.limited) tags.push("限定");

  const playStyle = playStyleOf(product);
  if (playStyle === "takeHome") tags.push("持ち帰り");
  if (playStyle === "onsite") tags.push("その場で遊べる");

  const minimumPlayers = product.players?.match(/^\s*(\d+)\s*(?:人|[〜～~\-－–—])/u)?.[1];
  if (minimumPlayers !== undefined && Number(minimumPlayers) === 1) tags.push("1人で遊べる");
  if (product.price !== null && product.price <= 1_000) tags.push("千円以下");
  if (product.days.length === 1) {
    if (product.days[0] === "sat") tags.push("土曜だけ");
    if (product.days[0] === "sun") tags.push("日曜だけ");
  }
  return tags;
}

export function xTagsOf(product: Product, booth: Booth): string[] {
  return [...new Set([
    ...(product.hashtags ?? []).map(({ tag }) => tag),
    ...(booth.hashtags ?? []).map(({ tag }) => tag),
  ])];
}

export function xHashtagUrl(tag: string): string {
  return "https://x.com/hashtag/" + encodeURIComponent(tag) + "?f=live";
}
