import { describe, expect, it } from "vitest";
import { buildCatalog, countActiveFilters, emptyFilters, filterCatalog, normalizeForSearch, sortCatalog } from "./catalog.ts";
import { booths, layout, product } from "./test-helpers.ts";

const products = [
  product({ id: "p01", boothId: "no03", name: "封筒の謎", price: 2000, difficulty: { level: 4, source: "official", basis: "b" }, isNew: true }),
  product({ id: "p02", boothId: "no01", name: "ナゾトキ缶バッジ", price: 500, category: "goods", difficulty: { level: null, source: "unknown", basis: null } }),
  product({ id: "no02-1", boothId: "no02", name: "スマホ謎", price: null, category: "online", difficulty: { level: 2, source: "estimated", basis: "b" } }),
  product({ id: "no05-1", boothId: "no05", name: "土曜の謎", price: 3500, days: ["sat"], limited: "数量限定" }),
  product({ id: "no07-1", boothId: "no07", name: "どこかの謎", price: 1500, oneLiner: "パズル本" }),
];
const catalog = buildCatalog(products, booths, layout);
const ids = (xs: { product: { id: string } }[]) => xs.map((x) => x.product.id);

describe("buildCatalog", () => {
  it("商品に団体とエリアを付ける（ブース番号が無ければエリアは null）", () => {
    const v = catalog.find((x) => x.product.id === "p01")!;
    expect(v.booth.name).toBe("謎屋");
    expect(v.area).toBe("Ca");
    expect(catalog.find((x) => x.product.id === "no07-1")!.area).toBeNull();
  });
});

describe("normalizeForSearch", () => {
  it("全角半角・大文字小文字・カタカナとひらがなの違いを無くす", () => {
    expect(normalizeForSearch("ナゾトキ ＡＢＣ")).toBe(normalizeForSearch("なぞとき abc"));
  });
});

describe("filterCatalog", () => {
  it("条件なしなら全部", () => {
    expect(filterCatalog(catalog, emptyFilters)).toHaveLength(5);
  });
  it("キーワードは商品名・一言・説明・団体名・ブース番号を見て、空白区切りは全部含むもの", () => {
    expect(ids(filterCatalog(catalog, { ...emptyFilters, q: "なぞとき" }))).toEqual(["p02"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, q: "謎屋" }))).toEqual(["p01"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, q: "ca1" }))).toEqual(["p01"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, q: "パズル" }))).toEqual(["no07-1"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, q: "謎 土曜" }))).toEqual(["no05-1"]);
  });
  it("価格帯を指定すると価格不明は外れる", () => {
    expect(ids(filterCatalog(catalog, { ...emptyFilters, priceMin: 1000, priceMax: 2000 }))).toEqual(["p01", "no07-1"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, priceMax: 600 }))).toEqual(["p02"]);
  });
  it("難易度は複数選べて、unknown は難易度不明を指す", () => {
    expect(ids(filterCatalog(catalog, { ...emptyFilters, difficulties: [2, "unknown"] }))).toEqual(["p02", "no02-1"]);
  });
  it("カテゴリ・行く日・新作のみ・エリア", () => {
    expect(ids(filterCatalog(catalog, { ...emptyFilters, categories: ["goods", "online"] }))).toEqual(["p02", "no02-1"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, day: "sun" }))).not.toContain("no05-1");
    expect(ids(filterCatalog(catalog, { ...emptyFilters, newOnly: true }))).toEqual(["p01"]);
    expect(ids(filterCatalog(catalog, { ...emptyFilters, areas: ["A"] }))).toEqual(["p02", "no02-1"]);
  });
  it("有効な条件の数を数える（キーワード・価格帯はそれぞれ1つ）", () => {
    expect(countActiveFilters(emptyFilters)).toBe(0);
    expect(countActiveFilters({ ...emptyFilters, q: " ", priceMin: 1, priceMax: 2, categories: ["kit", "goods"], newOnly: true })).toBe(3);
  });
});

describe("sortCatalog", () => {
  it("ブース順はマップ凡例の順（A→Ba→Bb→Ca→…、同じ列は番号順）、番号なしは最後", () => {
    expect(ids(sortCatalog(catalog, "booth"))).toEqual(["p02", "no02-1", "p01", "no05-1", "no07-1"]);
  });
  it("価格順は価格不明を最後に", () => {
    expect(ids(sortCatalog(catalog, "priceAsc"))).toEqual(["p02", "no07-1", "p01", "no05-1", "no02-1"]);
    expect(ids(sortCatalog(catalog, "priceDesc"))).toEqual(["no05-1", "p01", "no07-1", "p02", "no02-1"]);
  });
  it("難易度順は難易度不明を最後に、同じ難易度はブース順", () => {
    expect(ids(sortCatalog(catalog, "difficultyAsc"))).toEqual(["no02-1", "no05-1", "no07-1", "p01", "p02"]);
    expect(ids(sortCatalog(catalog, "difficultyDesc"))).toEqual(["p01", "no05-1", "no07-1", "no02-1", "p02"]);
  });
  it("元の配列を変えない", () => {
    const before = ids(catalog);
    sortCatalog(catalog, "priceDesc");
    expect(ids(catalog)).toEqual(before);
  });
});
