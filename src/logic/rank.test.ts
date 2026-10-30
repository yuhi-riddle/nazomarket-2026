import { describe, expect, it } from "vitest";
import { buildCatalog, sortCatalog } from "./catalog.ts";
import { defaultPrefs, rankForCatalog } from "./insights.ts";
import type { CartItem } from "./cart.ts";
import { booths, layout, product } from "./test-helpers.ts";

const products = [
  product({ id: "p01", boothId: "no01", price: 800, category: "goods", difficulty: { level: null, source: "unknown", basis: null }, isNew: true }),
  product({ id: "p02", boothId: "no02", price: 1000, category: "online", difficulty: { level: 2, source: "estimated", basis: "b" } }),
  product({ id: "p03", boothId: "no03", price: 3000, category: "kit", difficulty: { level: 4, source: "official", basis: "b" }, limited: "数量限定" }),
  product({ id: "p04", boothId: "no04", price: 5200, category: "booklet", difficulty: { level: 5, source: "official", basis: "b" } }),
  product({ id: "p05", boothId: "no05", price: null, category: "kit", difficulty: { level: 3, source: "estimated", basis: "b" }, days: ["sat"] }),
  product({ id: "p06", boothId: "no03", price: 2000, category: "kit", difficulty: { level: 1, source: "official", basis: "b" } }),
];
const catalog = buildCatalog(products, booths, layout);
const ids = (views: { product: { id: string } }[]) => views.map((v) => v.product.id);
const matchedIds = (r: ReturnType<typeof rankForCatalog>) => r.matched.map((s) => s.view.product.id);
const item = (productId: string, qty = 1): CartItem => ({ productId, qty, bought: false });

describe("rankForCatalog（一覧のおすすめ順）", () => {
  it("点数 1 以上は点数順で matched、それ以外は others にブース順。点数は返すが理由も付く", () => {
    const r = rankForCatalog(catalog, { ...defaultPrefs, categories: ["kit"] }, [], [], null);
    expect(matchedIds(r).slice(0, 2)).toEqual(["p03", "p06"]);
    expect(r.matched[0].reasons).toContain("指定したカテゴリ");
    expect(ids(r.others)).toEqual(ids(r.others).slice().sort((a, b) => ids(catalog).indexOf(a) - ids(catalog).indexOf(b)));
    expect([...matchedIds(r), ...ids(r.others)].sort()).toEqual(["p01", "p02", "p03", "p04", "p05", "p06"]);
  });

  it("予算: リストのほかの商品を引いた残りで判定し、予算超えはどちらにも入れない", () => {
    // 予算 5,000。リストに p02（1,000円）→ 残り 4,000。p04（5,200円）は超え、p03（3,000円）は入る
    const r = rankForCatalog(catalog, defaultPrefs, [item("p02")], [item("p02")], 5000);
    const all = [...matchedIds(r), ...ids(r.others)];
    expect(all).not.toContain("p04");
    expect(matchedIds(r)).toContain("p03");
    expect(r.matched.find((s) => s.view.product.id === "p03")!.reasons).toContain("予算内");
  });

  it("リストに入れた商品は、おすすめにもその他にも出さない", () => {
    const r = rankForCatalog(catalog, defaultPrefs, [item("p03"), item("p06", 2)], [item("p03"), item("p06", 2)], 50000);
    const all = [...matchedIds(r), ...ids(r.others)];
    expect(all).not.toContain("p03");
    expect(all).not.toContain("p06");
  });

  it("リストの商品は予算に含めて表示から外し、価格不明は予算で除かない", () => {
    const r = rankForCatalog(catalog, defaultPrefs, [item("p04")], [item("p04")], 5000);
    const all = [...matchedIds(r), ...ids(r.others)];
    expect(all).toEqual(["p05"]);
  });

  it("数量 2 以上も価格×数量で予算計算し、リストの商品は表示から外す", () => {
    const r = rankForCatalog(catalog, defaultPrefs, [item("p06", 3)], [item("p06", 3)], 5000);
    expect([...matchedIds(r), ...ids(r.others)]).toEqual(["p05"]);
  });

  it("価格不明は予算で除かず、予算の点も付けない", () => {
    const r = rankForCatalog(catalog, defaultPrefs, [], [], 100);
    expect([...matchedIds(r), ...ids(r.others)]).toContain("p05");
  });

  it("行く日に売っていない商品は除く", () => {
    const r = rankForCatalog(catalog, { ...defaultPrefs, day: "sun" }, [], [], null);
    expect([...matchedIds(r), ...ids(r.others)]).not.toContain("p05");
  });
});

describe("sortCatalog（団体順）", () => {
  it("団体名の五十音順（Intl.Collator ja）。同じ団体の中はブース順", () => {
    const sorted = sortCatalog(catalog, "organization");
    const names = sorted.map((v) => v.booth.name);
    const collator = new Intl.Collator("ja");
    expect(names).toEqual([...names].sort(collator.compare));
    const sameBooth = ids(sorted.filter((v) => v.booth.id === "no03"));
    expect(sameBooth).toEqual(["p03", "p06"]);
  });
});


describe("リストから推定するおすすめ", () => {
  const sample = buildCatalog([
    product({ id: "saved1", boothId: "no01", category: "kit", difficulty: { level: 4, source: "official", basis: null } }),
    product({ id: "saved2", boothId: "no02", category: "kit", difficulty: { level: 2, source: "estimated", basis: null } }),
    product({ id: "same", boothId: "no03", category: "kit", difficulty: { level: 3, source: "official", basis: null } }),
    product({ id: "near", boothId: "no04", category: "online", difficulty: { level: 4, source: "estimated", basis: null } }),
    product({ id: "far", boothId: "no05", category: "online", difficulty: { level: 5, source: "official", basis: null } }),
    product({ id: "unknown", boothId: "no01", category: "online", difficulty: { level: 3, source: "unknown", basis: null } }),
  ], booths, layout);
  const saved = [item("saved1", 5), { ...item("saved2"), bought: true }];
  const scored = (result: ReturnType<typeof rankForCatalog>, id: string) => result.matched.find((entry) => entry.view.product.id === id);

  it("購入済みも含めて商品ごとに推定し、同じカテゴリと平均に近い難易度に理由付きで加点する", () => {
    const result = rankForCatalog(sample, defaultPrefs, saved, saved, null);
    expect(scored(result, "same")).toMatchObject({ score: 2, reasons: ["リストと同じカテゴリ", "リストの難易度に近い"] });
    expect(scored(result, "near")).toMatchObject({ score: 1, reasons: ["リストの難易度に近い"] });
    expect(ids(result.others)).toContain("far");
    expect(ids(result.others)).toContain("unknown");
  });

  it("明示したカテゴリと難易度はリスト推定より優先する", () => {
    const result = rankForCatalog(sample, { ...defaultPrefs, categories: ["online"], difficultyMin: 5, difficultyMax: 5 }, saved, saved, null);
    expect(scored(result, "far")).toMatchObject({ score: 5, reasons: ["指定した難易度", "指定したカテゴリ"] });
    expect(ids(result.others)).toContain("same");
    expect(scored(result, "near")?.reasons ?? []).not.toContain("リストの難易度に近い");
  });

  it("片方だけ手動指定したとき、もう片方はリストから推定する", () => {
    const result = rankForCatalog(sample, { ...defaultPrefs, categories: ["online"] }, saved, saved, null);
    expect(scored(result, "same")).toMatchObject({ score: 1, reasons: ["リストの難易度に近い"] });
    expect(scored(result, "near")).toMatchObject({ score: 3, reasons: ["指定したカテゴリ", "リストの難易度に近い"] });
  });

  it("カテゴリが同数なら決めつけず、難易度不明と見つからない商品は推定に使わない", () => {
    const result = rankForCatalog(sample, defaultPrefs, [item("saved1"), item("unknown"), item("missing")], [item("saved1"), item("unknown"), item("missing")], null);
    expect(scored(result, "same")).toMatchObject({ score: 1, reasons: ["リストの難易度に近い"] });
    expect(ids(result.others)).not.toContain("unknown");
    const unknownOnly = rankForCatalog(sample, defaultPrefs, [item("unknown"), item("missing")], [item("unknown"), item("missing")], null);
    expect(scored(unknownOnly, "near")?.reasons ?? []).not.toContain("リストの難易度に近い");
  });

  it("リストの推定で予算超過や販売日外の商品を復活させない", () => {
    const result = rankForCatalog(sample, { ...defaultPrefs, day: "sun" }, saved, saved, 2500);
    expect([...matchedIds(result), ...ids(result.others)]).not.toContain("same");
    expect([...matchedIds(result), ...ids(result.others)]).not.toContain("far");
  });

  it("共同リストの予算から自分の担当だけを一度引き、他メンバーの担当額は引かない", () => {
    const sharedCatalog = buildCatalog([
      product({ id: "my-item", boothId: "no01", price: 3000 }),
      product({ id: "their-item", boothId: "no02", price: 5000 }),
      product({ id: "within-budget", boothId: "no03", price: 7000 }),
      product({ id: "over-budget", boothId: "no04", price: 7001 }),
    ], booths, layout);
    const tasteItems = [item("my-item"), item("their-item")];
    const myAssignedItems = [item("my-item")];
    const result = rankForCatalog(sharedCatalog, defaultPrefs, tasteItems, myAssignedItems, 10_000);
    const allIds = [...matchedIds(result), ...ids(result.others)];

    expect(allIds).toContain("within-budget");
    expect(allIds).not.toContain("over-budget");
    expect(result.matched.find((entry) => entry.view.product.id === "within-budget")?.reasons).toContain("予算内");
  });
});
