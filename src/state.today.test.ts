import { describe, expect, it } from "vitest";
import { defaultState, parseState, serializeState } from "./state.ts";

const known = new Set(["p01"]);

describe("parseState（当日・回り方の設定）", () => {
  it("初期値: ナゾコレの点数は未設定、買ったものも表示、回る順番は表示・新作限定は寄せない", () => {
    expect(defaultState.nazocolle).toEqual({ pointsPerDraw: null });
    expect(defaultState.today).toEqual({ hideBought: false });
    expect(defaultState.route).toEqual({ show: true, frontLoadSpecial: false });
  });
  it("正しい値は書いて読むと同じ", () => {
    const state = {
      ...defaultState,
      nazocolle: { pointsPerDraw: 3 },
      today: { hideBought: true },
      route: { show: false, frontLoadSpecial: true },
    };
    expect(parseState(serializeState(state), known)).toEqual(state);
  });
  it("ナゾコレの点数は 1〜20 の整数だけ。ほかは未設定に戻す", () => {
    const read = (v: unknown) =>
      parseState(JSON.stringify({ ...defaultState, nazocolle: { pointsPerDraw: v } }), known).nazocolle.pointsPerDraw;
    expect(read(5)).toBe(5);
    expect(read(0)).toBeNull();
    expect(read(21)).toBeNull();
    expect(read(2.5)).toBeNull();
    expect(read("3")).toBeNull();
  });
  it("真偽値でない設定は初期値に戻す", () => {
    const s = parseState(
      JSON.stringify({ ...defaultState, today: { hideBought: "yes" }, route: { show: 0, frontLoadSpecial: true } }),
      known,
    );
    expect(s.today).toEqual({ hideBought: false });
    expect(s.route).toEqual({ show: true, frontLoadSpecial: true });
  });
  it("この項目が無い古い保存でも読める（ほかの項目は残る）", () => {
    const old = { version: 1, budget: 8000 };
    const s = parseState(JSON.stringify(old), known);
    expect(s.budget).toBe(8000);
    expect(s.route).toEqual(defaultState.route);
  });
});
