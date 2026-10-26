import { describe, expect, it } from "vitest";
import { defaultPrefs } from "./logic/insights.ts";
import { defaultState, parseState, serializeState } from "./state.ts";

const known = new Set(["p01"]);

describe("parseState（おすすめの予算の出どころ）", () => {
  it("初期値はリストの残り予算を使う", () => {
    expect(defaultState.prefs.budgetFromCart).toBe(true);
  });
  it("「指定なし」（残り予算を使わない）は書いて読んでも残る", () => {
    const state = { ...defaultState, prefs: { ...defaultPrefs, budget: null, budgetFromCart: false } };
    expect(parseState(serializeState(state), known).prefs).toEqual({ ...defaultPrefs, budget: null, budgetFromCart: false });
  });
  it("真偽値でなければ初期値。古い保存（項目なし）も初期値", () => {
    const read = (v: unknown) => parseState(JSON.stringify({ ...defaultState, prefs: { ...defaultPrefs, budgetFromCart: v } }), known).prefs.budgetFromCart;
    expect(read("no")).toBe(true);
    const { budgetFromCart: _omit, ...old } = defaultPrefs as typeof defaultPrefs & { budgetFromCart?: boolean };
    expect(parseState(JSON.stringify({ ...defaultState, prefs: old }), known).prefs.budgetFromCart).toBe(true);
  });
});

describe("parseState（おすすめの好み）", () => {
  it("初期値は指定なし", () => {
    expect(defaultState.prefs).toEqual(defaultPrefs);
  });
  it("正しい値は書いて読むと同じ", () => {
    const state = {
      ...defaultState,
      prefs: { ...defaultPrefs, budget: 4000, difficultyMin: 2 as const, difficultyMax: 4 as const, categories: ["kit" as const, "booklet" as const], playStyle: "takeHome" as const },
    };
    expect(parseState(serializeState(state), known)).toEqual(state);
  });
  it("おかしな値は項目ごとに指定なしへ戻す。行く日は保存しない", () => {
    const s = parseState(
      JSON.stringify({
        ...defaultState,
        prefs: { budget: -1, difficultyMin: 7, difficultyMax: 3, categories: ["kit", "x"], playStyle: "somewhere", day: "sun" },
      }),
      known,
    );
    expect(s.prefs).toEqual({ ...defaultPrefs, difficultyMax: 3, categories: ["kit"] });
  });
  it("下限が上限より大きければ入れ替える", () => {
    const s = parseState(JSON.stringify({ ...defaultState, prefs: { ...defaultPrefs, difficultyMin: 5, difficultyMax: 2 } }), known);
    expect([s.prefs.difficultyMin, s.prefs.difficultyMax]).toEqual([2, 5]);
  });
});
