import { describe, expect, it } from "vitest";
import { buildCatalog, countActiveFilters, emptyFilters, filterCatalog } from "./catalog.ts";
import { FEATURE_TAGS, featureTags, xHashtagUrl, xTagsOf } from "./tags.ts";
import { booth, layout, product } from "./test-helpers.ts";

const src = [{ url: "https://x.com/a/status/1", retrievedAt: "2026-10-26" }];

describe("featureTags", () => {
  it("商品の値から特徴タグを決まった順で付ける", () => {
    const p = product({
      id: "p01",
      boothId: "no01",
      isNew: true,
      limited: "各日30部",
      category: "kit",
      players: "1人用",
      price: 1000,
      days: ["sat"],
    });
    expect(featureTags(p)).toEqual(["新作", "限定", "持ち帰り", "1人で遊べる", "千円以下"]);
  });
  it("その場で遊べるものを表示し、曜日はタグにしない", () => {
    expect(featureTags(product({ id: "a", boothId: "no01", category: "online", playMinutes: { min: 20, max: 20 }, price: 1500, days: ["sun"] }))).toEqual([
      "その場で遊べる",
    ]);
    expect(featureTags(product({ id: "b", boothId: "no01", category: "goods", playMinutes: null, price: null, players: null }))).toEqual([]);
  });
  it("人数が1人から遊べるとき（「1人用」「1〜4人」）だけ。「2〜4人」「10人」は付けない", () => {
    expect(featureTags(product({ id: "e", boothId: "no01", category: "goods", playMinutes: null, players: "10人" }))).not.toContain("1人で遊べる");
    expect(featureTags(product({ id: "c", boothId: "no01", category: "goods", playMinutes: null, players: "1〜4人" }))).toContain("1人で遊べる");
    expect(featureTags(product({ id: "d", boothId: "no01", category: "goods", playMinutes: null, players: "2〜4人" }))).not.toContain("1人で遊べる");
  });
  it("FEATURE_TAGS は画面に並べる順の一覧", () => {
    expect(FEATURE_TAGS).toEqual(["新作", "限定", "持ち帰り", "その場で遊べる", "1人で遊べる", "千円以下"]);
  });
});

describe("特徴タグで絞り込む", () => {
  const products = [
    product({ id: "p01", boothId: "no01", isNew: true, category: "kit" }),
    product({ id: "p02", boothId: "no01", isNew: true, category: "online", playMinutes: { min: 10, max: 10 } }),
    product({ id: "p03", boothId: "no01", isNew: null, category: "kit" }),
  ];
  const catalog = buildCatalog(products, [booth({ id: "no01", boothCode: "A1" })], layout);
  const ids = (views: ReturnType<typeof filterCatalog>) => views.map((v) => v.product.id);

  it("選んだタグを全部持つ商品だけ残す", () => {
    expect(ids(filterCatalog(catalog, { ...emptyFilters, tags: ["新作"] }))).toEqual(["p01", "p02"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, tags: ["新作", "持ち帰り"] }))).toEqual(["p01"]);
  });
  it("タグの指定なしなら全部。タグ1つにつき条件1つと数える", () => {
    expect(emptyFilters.tags).toEqual([]);
    expect(ids(filterCatalog(catalog, emptyFilters))).toHaveLength(3);
    expect(countActiveFilters({ ...emptyFilters, tags: ["新作", "限定"] })).toBe(2);
  });
});

describe("X で探す用のタグ", () => {
  it("商品のタグ → 団体のタグの順に、同じタグは1回だけ", () => {
    const p = product({ id: "p01", boothId: "no01", hashtags: [{ tag: "封入謎", sources: src }, { tag: "ナゾトキマーケット", sources: src }] });
    const b = booth({ id: "no01", hashtags: [{ tag: "ナゾトキマーケット", sources: src }, { tag: "立川茜", sources: src }] });
    expect(xTagsOf(p, b)).toEqual(["封入謎", "ナゾトキマーケット", "立川茜"]);
  });
  it("タグが無ければ空", () => {
    expect(xTagsOf(product({ id: "p01", boothId: "no01" }), booth({ id: "no01" }))).toEqual([]);
  });
  it("X のハッシュタグ検索（新しい順）の URL を作る。日本語や記号はエンコードする", () => {
    expect(xHashtagUrl("封入謎")).toBe("https://x.com/hashtag/%E5%B0%81%E5%85%A5%E8%AC%8E?f=live");
    expect(xHashtagUrl("a/b c")).toBe("https://x.com/hashtag/a%2Fb%20c?f=live");
  });
});
