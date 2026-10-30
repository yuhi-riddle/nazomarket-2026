import { describe, expect, it } from "vitest";
import { difficultyTier } from "./difficultyTier.ts";

describe("difficultyTier", () => {
  it("1〜5 の整数はそのまま文字列で返す", () => {
    expect([1, 2, 3, 4, 5].map(difficultyTier)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("範囲外・小数・null・undefined は unknown", () => {
    expect([0, 6, 2.5, -1, null, undefined].map(difficultyTier)).toEqual([
      "unknown", "unknown", "unknown", "unknown", "unknown", "unknown",
    ]);
  });
});
