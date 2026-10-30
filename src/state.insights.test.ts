import { describe, expect, it } from "vitest";
import { defaultPrefs } from "./logic/insights.ts";
import { defaultState, parseState, serializeState } from "./state.ts";

const known = new Set(["p01"]);

describe("parseState（おすすめの予算はリストの予算だけ）", () => {
  it("おすすめの条件に予算の項目は持たない", () => {
    expect(defaultState.prefs).not.toHaveProperty("budget");
    expect(defaultState.prefs).not.toHaveProperty("budgetFromCart");
  });
  it("古い保存に予算の項目があっても読み捨てる", () => {
    const old = { ...defaultPrefs, budget: 4000, budgetFromCart: false };
    const prefs = parseState(JSON.stringify({ ...defaultState, prefs: old }), known).prefs;
    expect(prefs).toEqual(defaultPrefs);
    expect(prefs).not.toHaveProperty("budget");
  });
});

describe("parseState（遊び方の条件はなくした）", () => {
  it("おすすめの条件に遊び方の項目は持たない", () => {
    expect(defaultState.prefs).not.toHaveProperty("playStyle");
  });
  it("古い保存に遊び方があっても読み捨てる", () => {
    const prefs = parseState(JSON.stringify({ ...defaultState, prefs: { ...defaultPrefs, playStyle: "takeHome" } }), known).prefs;
    expect(prefs).toEqual(defaultPrefs);
  });
});

describe("parseState（おすすめの好み）", () => {
  it("初期値は指定なし", () => {
    expect(defaultState.prefs).toEqual(defaultPrefs);
  });
  it("正しい値は書いて読むと同じ", () => {
    const state = {
      ...defaultState,
      prefs: { ...defaultPrefs, difficultyMin: 2 as const, difficultyMax: 4 as const, categories: ["kit" as const, "booklet" as const] },
    };
    expect(parseState(serializeState(state), known)).toEqual(state);
  });
  it("おかしな値は項目ごとに指定なしへ戻す。行く日は保存しない", () => {
    const s = parseState(
      JSON.stringify({
        ...defaultState,
        prefs: { difficultyMin: 7, difficultyMax: 3, categories: ["kit", "x"], playStyle: "somewhere", day: "sun" },
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
