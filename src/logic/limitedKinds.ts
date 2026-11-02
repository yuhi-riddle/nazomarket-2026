import type { Product } from "../types.ts";
import { limitedPrice } from "./limitedPrice.ts";

export const LIMITED_KINDS = ["数量限定", "会場限定", "先行販売", "限定価格", "購入条件あり"] as const;
export type LimitedKind = (typeof LIMITED_KINDS)[number];

export function limitedKinds(product: Pick<Product, "limited" | "price" | "priceNote">): LimitedKind[] {
  const text = product.limited ?? "";
  const found = new Set<LimitedKind>();

  // 数量・単位の併記、または「数量限定」を数量の制限として扱う。
  if (/数量限定|(?:各色\s*)?\d[\d,]*\s*(?:部|冊|個|着|羽|枚|点|セット|組|本|名)(?!\s*同時)(?:ずつ|限定)?/u.test(text)) {
    found.add("数量限定");
  }

  // 「会場限定価格」は値段の話なので、価格の句を除いてから売り場の限定を見る
  const withoutPricePhrase = text.replace(/[^、。・\s]*(?:限定価格|特別(?:割引)?価格|スペシャルプライス|(?:会場|イベント)価格)/gu, "");
  // 「2日間のみ販売」は期間の話なので、買える人を限っている書き方だけを拾う
  const hasPurchaseCondition = /(?:だけ|のみ)(?:購入|買える)|(?:同時購入|購入時)(?:だけ|のみ)|(?:人|方|参加者|当選者)(?:だけ|のみ|限定)/u.test(text);
  const isPastAdvance = /先行販売後|先行発売後/u.test(text);
  if (hasPurchaseCondition) found.add("購入条件あり");
  if (/(?:会場|イベント)(?:\d+日間)?限定|(?:ナゾトキマーケット|ナゾマ|ナゾマケ)(?:会場)?限定|(?:ナゾトキマーケット|ナゾマ|ナゾマケ)でしか買えな|ここでしか(?:手に入ら|買えな)|(?:会場|イベント)でのみ/u.test(withoutPricePhrase)) {
    found.add("会場限定");
  }
  if (!isPastAdvance && /先行(?:販売|発売|予約)|最速販売|限定先行|(?:会場|イベント|ナゾトキマーケット)[^。]{0,20}新発売(?=[^。]*(?:通販|一般発売|後日))/u.test(text)) {
    found.add("先行販売");
  }
  if (/限定価格|特別(?:割引)?価格|スペシャルプライス/u.test(text)) found.add("限定価格");

  const price = limitedPrice(product.price, product.priceNote);
  if (price?.label === "限定価格" || /限定価格/u.test(product.priceNote ?? "")) found.add("限定価格");
  if (price?.label === "先行価格") found.add("先行販売");

  return LIMITED_KINDS.filter((kind) => found.has(kind));
}
