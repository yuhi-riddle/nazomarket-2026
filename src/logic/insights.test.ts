import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.ts";
import {
  areaMatchCounts,
  categoryDistribution,
  defaultPrefs,
  difficultyDistribution,
  newShare,
  playStyleOf,
  priceDistribution,
  recommend,
  scoreProduct,
  SCORE_RULES,
} from "./insights.ts";
import { booths, layout, product } from "./test-helpers.ts";

const products = [
  product({ id: "p01", boothId: "no01", price: 800, category: "goods", difficulty: { level: null, source: "unknown", basis: null }, isNew: true }),
  product({ id: "p02", boothId: "no02", price: 1000, category: "online", playMinutes: 20, difficulty: { level: 2, source: "estimated", basis: "b" } }),
  product({ id: "p03", boothId: "no03", price: 2999, category: "kit", playMinutes: 120, difficulty: { level: 4, source: "official", basis: "b" }, isNew: false, limited: "数量限定" }),
  product({ id: "p04", boothId: "no04", price: 5200, category: "booklet", playMinutes: 240, difficulty: { level: 5, source: "official", basis: "b" } }),
  product({ id: "p05", boothId: "no05", price: null, category: "kit", playMinutes: null, difficulty: { level: 3, source: "estimated", basis: "b" }, days: ["sat"] }),
];
const catalog = buildCatalog(products, booths, layout);
const view = (id: string) => catalog.find((v) => v.product.id === id)!;

describe("分布", () => {
  it("価格は1,000円刻み（5,000円〜はまとめる）と価格不明", () => {
    expect(priceDistribution(products)).toEqual({
      bins: [
        { label: "〜999円", count: 1 },
        { label: "1,000〜1,999円", count: 1 },
        { label: "2,000〜2,999円", count: 1 },
        { label: "3,000〜3,999円", count: 0 },
        { label: "4,000〜4,999円", count: 0 },
        { label: "5,000円〜", count: 1 },
      ],
      unknown: 1,
    });
  });
  it("カテゴリは決まった順で全種類", () => {
    expect(categoryDistribution(products)).toEqual([
      { category: "kit", count: 2 },
      { category: "booklet", count: 1 },
      { category: "online", count: 1 },
      { category: "goods", count: 1 },
      { category: "other", count: 0 },
    ]);
  });
  it("難易度は 1〜5 ごとに公式/推定の内訳と、不明の数", () => {
    expect(difficultyDistribution(products)).toEqual({
      levels: [
        { level: 1, official: 0, estimated: 0 },
        { level: 2, official: 0, estimated: 1 },
        { level: 3, official: 0, estimated: 1 },
        { level: 4, official: 1, estimated: 0 },
        { level: 5, official: 1, estimated: 0 },
      ],
      unknown: 1,
    });
  });
  it("新作の割合（新作・新作でない・不明）", () => {
    expect(newShare(products)).toEqual({ isNew: 1, notNew: 1, unknown: 3 });
  });
});

describe("playStyleOf", () => {
  it("スマホ・Web謎ならその場、キット・冊子は持ち帰り、ほかは不明", () => {
    expect(playStyleOf(view("p02").product)).toBe("onsite");
    expect(playStyleOf(view("p03").product)).toBe("takeHome");
    expect(playStyleOf(view("p01").product)).toBe("unknown");
  });
  it("所要時間が短いだけでは「その場」と決めない（家で遊ぶ短い謎もある）", () => {
    expect(playStyleOf({ ...view("p03").product, playMinutes: 15 })).toBe("takeHome");
    expect(playStyleOf({ ...view("p01").product, playMinutes: 15 })).toBe("unknown");
  });
});

describe("scoreProduct", () => {
  const prefs = { ...defaultPrefs, budget: 3000, difficultyMin: 3 as const, difficultyMax: 5 as const, categories: ["kit" as const], playStyle: "takeHome" as const };

  it("合う条件ごとに点を足し、理由を並べる", () => {
    expect(scoreProduct(view("p03"), prefs)).toEqual({
      view: view("p03"),
      score: 2 + 3 + 2 + 2 + 1,
      reasons: ["予算内", "好みの難易度", "好みのカテゴリ", "持ち帰って遊べる", "限定あり"],
    });
  });
  it("推定の難易度は1点低く、合わない難易度・遊び方は減点", () => {
    const p05 = scoreProduct(view("p05"), prefs)!;
    expect(p05.score).toBe(2 + 2 + 2);
    expect(p05.reasons).toEqual(["好みの難易度（推定）", "好みのカテゴリ", "持ち帰って遊べる"]);
    const p02 = scoreProduct(view("p02"), prefs)!;
    expect(p02.score).toBe(2 - 2 - 1);
  });
  it("予算を超えるもの・行く日に売っていないものは対象外（null）", () => {
    expect(scoreProduct(view("p04"), prefs)).toBeNull();
    expect(scoreProduct(view("p05"), { ...prefs, day: "sun" })).toBeNull();
  });
  it("条件を何も入れなければ新作・限定だけが点になる", () => {
    expect(scoreProduct(view("p01"), defaultPrefs)).toEqual({ view: view("p01"), score: 1, reasons: ["新作"] });
  });
});

describe("recommend", () => {
  const prefs = { ...defaultPrefs, budget: 3000, difficultyMin: 3 as const, difficultyMax: 5 as const, categories: ["kit" as const], playStyle: "takeHome" as const };

  it("点の高い順に上限件数まで。0点以下とリストに入っている商品は除く", () => {
    expect(recommend(catalog, prefs, new Set(), 3).map((s) => s.view.product.id)).toEqual(["p03", "p05", "p01"]);
    expect(recommend(catalog, prefs, new Set(["p03"]), 10).map((s) => s.view.product.id)).toEqual(["p05", "p01"]);
  });
  it("同点は価格の安い順（価格不明は後ろ）→ブース順", () => {
    expect(recommend(catalog, defaultPrefs, new Set(), 10).map((s) => s.view.product.id)).toEqual(["p01", "p03"]);
    const ties = buildCatalog(
      [
        product({ id: "t1", boothId: "no04", price: null, isNew: true }),
        product({ id: "t2", boothId: "no03", price: 1000, isNew: true }),
        product({ id: "t3", boothId: "no01", price: 1000, isNew: true }),
      ],
      booths,
      layout,
    );
    expect(recommend(ties, defaultPrefs, new Set(), 10).map((s) => s.view.product.id)).toEqual(["t3", "t2", "t1"]);
  });
});

describe("areaMatchCounts", () => {
  it("点がしきい値以上の商品をエリアごとに数える（エリア無しは数えない）", () => {
    const prefs = { ...defaultPrefs, budget: 3000, difficultyMin: 3 as const, difficultyMax: 5 as const, categories: ["kit" as const], playStyle: "takeHome" as const };
    const scored = recommend(catalog, prefs, new Set(), 100);
    expect(areaMatchCounts(scored, 4)).toEqual({ Ca: 1, Cc: 1 });
    expect(areaMatchCounts(scored, 3)).toEqual({ A: 1, Ca: 1, Cc: 1 });
  });
});

describe("SCORE_RULES", () => {
  it("画面に出す点数の説明がある", () => {
    expect(SCORE_RULES.length).toBeGreaterThanOrEqual(6);
    for (const r of SCORE_RULES) {
      expect(r.label).not.toBe("");
      expect(r.points).not.toBe("");
    }
  });
});
