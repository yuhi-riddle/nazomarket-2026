import { describe, expect, it } from "vitest";
import { defaultState, parseState, serializeState, STORAGE_KEY } from "./state.ts";

const known = new Set(["p01", "p02", "no10-1"]);

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
      items: [{ productId: "p01", priority: "must" as const, qty: 2, bought: true }],
      sort: "priceAsc" as const,
      filters: { ...defaultState.filters, q: "封筒", categories: ["kit" as const], difficulties: [3 as const, "unknown" as const], onlyGoingDay: true },
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
      { productId: "p01", priority: "must", qty: 99, bought: false },
      { productId: "no10-1", priority: "maybe", qty: 1, bought: true },
    ]);
    expect(s.filters).toEqual({
      ...defaultState.filters,
      priceMax: 3000,
      difficulties: [1, "unknown"],
      categories: ["kit"],
      areas: ["Ca"],
      onlyGoingDay: true,
    });
  });
  it("保存キーは版付き", () => {
    expect(STORAGE_KEY).toBe("nazomarket2026:v1");
  });
});
