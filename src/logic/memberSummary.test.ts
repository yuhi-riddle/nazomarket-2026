import { describe, expect, it } from "vitest";
import type { SharedListState } from "../../shared-worker/src/domain.ts";
import { summarizeMembers } from "./memberSummary.ts";

describe("summarizeMembers", () => {
  it("担当ごとの金額・予算残り・超過と未定件数を集計する", () => {
    const state: SharedListState = {
      revision: 4,
      members: [
        { id: "member-1", name: "あき", budgetYen: 3000 },
        { id: "member-2", name: "れん", budgetYen: null },
      ],
      items: [
        { id: "item-1", productId: "p-a", name: "品A", priceYen: 1000, quantity: 2, purchased: false, ownerId: "member-1" },
        { id: "item-2", productId: "p-b", name: "品B", priceYen: 1500, quantity: 1, purchased: true, ownerId: "member-1" },
        { id: "item-3", productId: "p-c", name: "品C", priceYen: 700, quantity: 3, purchased: false, ownerId: "member-2" },
        { id: "item-4", productId: "p-d", name: "未定品", priceYen: 250, quantity: 2, purchased: false, ownerId: null },
        { id: "item-5", productId: "p-e", name: "価格不明", priceYen: null, quantity: 1, purchased: false, ownerId: null },
      ],
    };
    const prices: Record<string, number | null> = {
      "p-a": 1000,
      "p-b": 1500,
      "p-c": 700,
      "p-d": 250,
      "p-e": null,
    };

    expect(summarizeMembers(state, (productId) => prices[productId] ?? null)).toEqual({
      members: [
        { memberId: "member-1", name: "あき", total: 3500, budget: 3000, remaining: -500, over: 500 },
        { memberId: "member-2", name: "れん", total: 2100, budget: null, remaining: null, over: 0 },
      ],
      unassignedCount: 2,
      unassignedTotal: 500,
      total: 6100,
    });
  });

  it("メンバーがいないときも全体合計と未定分を返す", () => {
    const state: SharedListState = {
      revision: 0,
      members: [],
      items: [{ id: "item-1", productId: "p-a", name: "品A", priceYen: 900, quantity: 2, purchased: false, ownerId: null }],
    };

    expect(summarizeMembers(state, () => 900)).toEqual({
      members: [],
      unassignedCount: 1,
      unassignedTotal: 1800,
      total: 1800,
    });
  });
});
