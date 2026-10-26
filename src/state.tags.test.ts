import { describe, expect, it } from "vitest";
import { defaultState, parseState, serializeState } from "./state.ts";

const known = new Set(["p01"]);

describe("parseState（特徴タグの絞り込み）", () => {
  it("初期値はタグの指定なし", () => {
    expect(defaultState.filters.tags).toEqual([]);
  });
  it("正しい値は書いて読むと同じ", () => {
    const state = { ...defaultState, filters: { ...defaultState.filters, tags: ["新作", "持ち帰り"] } };
    expect(parseState(serializeState(state), known)).toEqual(state);
  });
  it("知らないタグ・文字列でないもの・重複は捨てる。tags が無い古い保存でも読める", () => {
    const s = parseState(JSON.stringify({ ...defaultState, filters: { ...defaultState.filters, tags: ["新作", "謎", 3, "新作"] } }), known);
    expect(s.filters.tags).toEqual(["新作"]);
    const { tags: _omit, ...oldFilters } = defaultState.filters;
    expect(parseState(JSON.stringify({ ...defaultState, filters: oldFilters }), known).filters.tags).toEqual([]);
  });
});
