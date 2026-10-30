import { describe, expect, it } from "vitest";
import { normalizeSharedOperation, normalizeSharedState } from "./types.ts";

describe("共有状態と操作の検証", () => {
  it("メンバー予算と担当IDを持つ新しい状態を受け入れる", () => {
    const state = {
      revision: 4,
      members: [{ id: "member-1", name: "  あき  ", budgetYen: 5000 }],
      items: [{
        id: "item-1",
        productId: "p18",
        name: "  謎のキット  ",
        priceYen: 1200,
        quantity: 2,
        purchased: false,
        ownerId: "member-1",
      }],
    };

    expect(normalizeSharedState(state)).toEqual({
      revision: 4,
      members: [{ id: "member-1", name: "あき", budgetYen: 5000 }],
      items: [{
        id: "item-1",
        productId: "p18",
        name: "謎のキット",
        priceYen: 1200,
        quantity: 2,
        purchased: false,
        ownerId: "member-1",
      }],
    });
  });

  it("部屋予算つきの旧状態や必須フィールドのない状態を拒否する", () => {
    expect(normalizeSharedState({ revision: 0, budgetYen: 5000, items: [] })).toBeNull();
    expect(normalizeSharedState({ revision: 0, members: [], items: [] })).not.toBeNull();
    expect(normalizeSharedState({ revision: 0, members: [], items: [], budgetYen: null })).toBeNull();
    expect(normalizeSharedState({
      revision: 0,
      members: [{ id: "member-1", name: "あき" }],
      items: [],
    })).toBeNull();
    expect(normalizeSharedState({
      revision: 0,
      members: [],
      items: [{ id: "item-1", productId: "p18", name: "品", priceYen: 100, quantity: 1, purchased: false }],
    })).toBeNull();
  });

  it("メンバーと担当の全操作を受け入れ、set-budgetは拒否する", () => {
    const operations = [
      { type: "add-member", member: { id: "member-1", name: "あき" } },
      { type: "rename-member", memberId: "member-1", name: "れん" },
      { type: "remove-member", memberId: "member-1" },
      { type: "set-member-budget", memberId: "member-1", budgetYen: 5000 },
      { type: "set-member-budget", memberId: "member-1", budgetYen: null },
      { type: "set-owner", itemId: "item-1", ownerId: "member-1" },
      { type: "set-owner", itemId: "item-1", ownerId: null },
      { type: "add", item: { id: "item-1", productId: "p18", name: "品", priceYen: 100, quantity: 1, ownerId: "member-1" } },
      { type: "remove", itemId: "item-1" },
      { type: "set-quantity", itemId: "item-1", quantity: 2 },
      { type: "set-purchased", itemId: "item-1", purchased: true },
    ];

    for (const operation of operations) expect(normalizeSharedOperation(operation)).not.toBeNull();
    expect(normalizeSharedOperation({ type: "set-budget", budgetYen: 5000 })).toBeNull();
  });
});
