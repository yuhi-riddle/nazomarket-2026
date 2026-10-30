import { describe, expect, it } from "vitest";
import { defaultPrefs } from "./insights.ts";
import { hasRecommendationBasis } from "./recommendationBasis.ts";

describe("hasRecommendationBasis", () => {
  const item = { productId: "a", qty: 1, bought: false };

  it("リストが空で条件も予算も無いときは、おすすめの手がかりが無い", () => {
    expect(hasRecommendationBasis([], defaultPrefs, null)).toBe(false);
  });

  it("リストにアイテムがあれば手がかりになる", () => {
    expect(hasRecommendationBasis([item], defaultPrefs, null)).toBe(true);
  });

  it("予算・難易度・カテゴリ・遊び方のどれかが指定されていれば手がかりになる", () => {
    expect(hasRecommendationBasis([], defaultPrefs, 3000)).toBe(true);
    expect(hasRecommendationBasis([], { ...defaultPrefs, difficultyMin: 2 }, null)).toBe(true);
    expect(hasRecommendationBasis([], { ...defaultPrefs, difficultyMax: 4 }, null)).toBe(true);
    expect(hasRecommendationBasis([], { ...defaultPrefs, categories: ["kit"] }, null)).toBe(true);
    expect(hasRecommendationBasis([], { ...defaultPrefs, playStyle: "onsite" }, null)).toBe(true);
  });
});
