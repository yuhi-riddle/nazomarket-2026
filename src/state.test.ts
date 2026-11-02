import { describe, expect, it } from "vitest";
import { defaultState, parseState, serializeState, showBoothInCatalog, STORAGE_KEY } from "./state.ts";

const known = new Set(["p01", "p02", "no10-1"]);

describe("showBoothInCatalog", () => {
  it("一覧に移り、ほかの条件を外して団体だけに絞る", () => {
    const next = showBoothInCatalog({ ...defaultState, tab: "map", sort: "priceAsc", filters: { ...defaultState.filters, q: "謎", tags: ["新作"] } }, "no03");
    expect(next.tab).toBe("catalog");
    expect(next.sort).toBe("priceAsc");
    expect(next.filters).toEqual({ ...defaultState.filters, boothId: "no03" });
  });
  it("おすすめ順は最大10件しか出ないので、ブース順に変える", () => {
    expect(showBoothInCatalog({ ...defaultState, sort: "recommended" }, "no03").sort).toBe("booth");
  });
  it("団体の指定は保存から戻さない（次に開いたときは全商品）", () => {
    const saved = serializeState({ ...defaultState, filters: { ...defaultState.filters, boothId: "no03" } });
    expect(parseState(saved, known).filters.boothId).toBeNull();
  });
});

describe("parseState", () => {
  it("保存が無い・壊れている・版が違うときは初期値", () => {
    expect(parseState(null, known)).toEqual(defaultState);
    expect(parseState("{not json", known)).toEqual(defaultState);
    expect(parseState(JSON.stringify({ version: 999, budget: 5000 }), known)).toEqual(defaultState);
    expect(parseState("[]", known)).toEqual(defaultState);
  });
  it("正しい値はそのまま戻る（書いて読むと同じ）", () => {
    const state = {
      ...defaultState,
      tab: "cart" as const,
      day: "sun" as const,
      budget: 15000,
      items: [{ productId: "p01", qty: 2, bought: true }],
      sort: "priceAsc" as const,
      filters: { ...defaultState.filters, q: "封筒", categories: ["kit" as const], difficulties: [3 as const, "unknown" as const], day: "sun" as const },
    };
    expect(parseState(serializeState(state), known)).toEqual(state);
  });
  it("おかしな値は項目ごとに初期値へ戻し、ほかの項目は残す", () => {
    const raw = JSON.stringify({
      version: 1,
      tab: "nope",
      day: "mon",
      budget: -100,
      sort: "random",
      items: [
        { productId: "p01", priority: "must", qty: 500, bought: "yes" },
        { productId: "gone", priority: "must", qty: 1, bought: false },
        { productId: "p02", priority: "someday", qty: 1, bought: false },
        { productId: "no10-1", priority: "maybe", qty: 0, bought: true },
        { productId: "p01", priority: "want", qty: 1, bought: false },
        "garbage",
      ],
      filters: { q: 42, priceMin: "x", priceMax: 3000, difficulties: [1, 9, "unknown"], categories: ["kit", "food"], areas: ["Ca", 3], newOnly: "true", onlyGoingDay: true },
    });
    const s = parseState(raw, known);
    expect(s.tab).toBe(defaultState.tab);
    expect(s.day).toBe("sat");
    expect(s.budget).toBeNull();
    expect(s.sort).toBe("booth");
    expect(s.items).toEqual([
      { productId: "p01", qty: 99, bought: false },
      { productId: "p02", qty: 1, bought: false },
      { productId: "no10-1", qty: 1, bought: true },
    ]);
    expect(s.filters).toEqual({
      ...defaultState.filters,
      priceMax: 3000,
      difficulties: [1, "unknown"],
      categories: ["kit"],
      day: "sat",
    });
  });
  it("タグの組み合わせ方は保存して戻し、無い・おかしい値は「または」にする", () => {
    const state = { ...defaultState, filters: { ...defaultState.filters, tags: ["新作"], tagMatch: "all" as const } };
    expect(parseState(serializeState(state), known).filters.tagMatch).toBe("all");
    const read = (filters: unknown) => parseState(JSON.stringify({ version: 1, filters }), known).filters.tagMatch;
    expect(read({ tags: ["新作"] })).toBe("any");
    expect(read({ tagMatch: "nope" })).toBe("any");
  });
  it("古い保存の優先度は読み捨て、優先度が無い項目も読む。当日タブはリストタブとして開く", () => {
    const raw = JSON.stringify({
      version: 1,
      tab: "today",
      items: [{ productId: "p01", priority: "want", qty: 1, bought: false }, { productId: "p02", qty: 2, bought: true }],
    });
    const s = parseState(raw, known);
    expect(s.tab).toBe("cart");
    expect(s.items).toEqual([{ productId: "p01", qty: 1, bought: false }, { productId: "p02", qty: 2, bought: true }]);
  });
  it("保存キーは版付き", () => {
    expect(STORAGE_KEY).toBe("nazomarket2026:v1");
  });
  it("以前の行く日フィルターを選択済みの日に引き継ぎ、リストと予算も残す", () => {
    const saved = JSON.stringify({ version: 1, day: "sun", budget: 8000,
      items: [{ productId: "p01", qty: 2, bought: true }], filters: { onlyGoingDay: true } });
    const state = parseState(saved, known);
    expect(state.filters.day).toBe("sun");
    expect(state.budget).toBe(8000);
    expect(state.items).toEqual([{ productId: "p01", qty: 2, bought: true }]);
  });
  it("以前の曜日タグを日付フィルターに引き継ぎ、見えないタグは残さない", () => {
    const state = parseState(JSON.stringify({ version: 1, filters: { tags: ["土曜だけ", "新作"] } }), known);
    expect(state.filters.day).toBe("sat");
    expect(state.filters.tags).toEqual(["新作"]);
  });
});
