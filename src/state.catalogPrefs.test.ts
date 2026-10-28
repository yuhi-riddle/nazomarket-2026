import { describe, expect, it } from "vitest";
import { defaultState, parseState } from "./state.ts";

const known = new Set(["p01"]);

describe("parseState（おすすめタブを一覧に統合）", () => {
  it("おすすめタブを開いていた保存は、一覧をおすすめ順で開く", () => {
    const s = parseState(JSON.stringify({ ...defaultState, tab: "insights", sort: "priceAsc" }), known);
    expect(s.tab).toBe("catalog");
    expect(s.sort).toBe("recommended");
  });
  it("並び順のおすすめ順・団体順は書いて読んでも残る", () => {
    for (const sort of ["recommended", "organization"] as const) {
      expect(parseState(JSON.stringify({ ...defaultState, sort }), known).sort).toBe(sort);
    }
  });
});
