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
    const r = rankForCatalog(catalog, { ...defaultPrefs, categories: ["kit"] }, [], null);
    expect(matchedIds(r).slice(0, 2)).toEqual(["p03", "p06"]);
    expect(r.matched[0].reasons).toContain("好みのカテゴリ");
    expect(ids(r.others)).toEqual(ids(r.others).slice().sort((a, b) => ids(catalog).indexOf(a) - ids(catalog).indexOf(b)));
    expect([...matchedIds(r), ...ids(r.others)].sort()).toEqual(["p01", "p02", "p03", "p04", "p05", "p06"]);
  });

  it("予算: リストのほかの商品を引いた残りで判定し、予算超えはどちらにも入れない", () => {
    // 予算 5,000。リストに p02（1,000円）→ 残り 4,000。p04（5,200円）は超え、p03（3,000円）は入る
    const r = rankForCatalog(catalog, defaultPrefs, [item("p02")], 5000);
    const all = [...matchedIds(r), ...ids(r.others)];
    expect(all).not.toContain("p04");
    expect(matchedIds(r)).toContain("p03");
    expect(r.matched.find((s) => s.view.product.id === "p03")!.reasons).toContain("予算内");
  });

  it("リストに入れた商品は、自分の分で残り予算が減っても消えない", () => {
    // 予算 5,000。p03（3,000円）をリストに入れると残り 2,000 になるが、p03 自身は表示し続ける
    const r = rankForCatalog(catalog, defaultPrefs, [item("p03")], 5000);
    expect([...matchedIds(r), ...ids(r.others)]).toContain("p03");
    expect(r.matched.find((s) => s.view.product.id === "p03")?.reasons ?? []).toContain("予算内");
  });

  it("ほかの商品だけで予算を超えているときは、リストに無い商品はすべて予算超え（価格不明は除く）", () => {
    const r = rankForCatalog(catalog, defaultPrefs, [item("p04")], 5000);
    const all = [...matchedIds(r), ...ids(r.others)];
    expect(all.filter((id) => id !== "p04" && id !== "p05")).toEqual([]);
    expect(all).toContain("p04");
    expect(all).toContain("p05");
  });

  it("数量 2 以上は 価格×数量 で判定する。リストに入っていても予算を超えれば「予算内」は付かない", () => {
    const r = rankForCatalog(catalog, defaultPrefs, [item("p06", 3)], 5000);
    const p06 = [...r.matched.map((s) => ({ id: s.view.product.id, reasons: s.reasons })), ...r.others.map((v) => ({ id: v.product.id, reasons: [] as string[] }))]
      .find((x) => x.id === "p06");
    expect(p06).toBeDefined();
    expect(p06!.reasons).not.toContain("予算内");
  });

  it("価格不明は予算で除かず、予算の点も付けない", () => {
    const r = rankForCatalog(catalog, defaultPrefs, [], 100);
    expect([...matchedIds(r), ...ids(r.others)]).toContain("p05");
  });

  it("行く日に売っていない商品は除く", () => {
    const r = rankForCatalog(catalog, { ...defaultPrefs, day: "sun" }, [], null);
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
