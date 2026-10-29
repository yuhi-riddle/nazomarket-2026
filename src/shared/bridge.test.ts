import { describe, expect, it } from "vitest";
import type { SharedListState, SharedOperation } from "../../shared-worker/src/domain.ts";
import {
  projectSharedCart,
  sharedCopyBatch,
  sharedOperationsForCartChange,
  sharedOperationsForPersonalCart,
} from "./bridge.ts";

const initial: SharedListState = {
  revision: 3,
  budgetYen: 8_000,
  items: [{ id: "p18", productId: "p18", name: "共有名", priceYen: 1_000, quantity: 2, purchased: false }],
};

describe("shared cart bridge", () => {
  it("projects queued changes onto the latest shared snapshot", () => {
    const operations: SharedOperation[] = [
      { type: "set-quantity", itemId: "p18", quantity: 4 },
      { type: "set-purchased", itemId: "p18", purchased: true },
      { type: "set-budget", budgetYen: 5_000 },
      { type: "add", item: { id: "p02", productId: "p02", name: "追加品", priceYen: 700, quantity: 1 } },
    ];

    expect(projectSharedCart(initial, operations)).toEqual({
      items: [
        { productId: "p18", qty: 4, bought: true },
        { productId: "p02", qty: 1, bought: false },
      ],
      budget: 5_000,
      itemIds: new Map([["p18", "p18"], ["p02", "p02"]]),
    });
  });

  it("refuses to hide shared items that the current catalog UI cannot represent", () => {
    expect(projectSharedCart({
      ...initial,
      items: [{ ...initial.items[0]!, productId: "not-in-catalog" }],
    })).toBeNull();
    expect(projectSharedCart({
      ...initial,
      items: [{ ...initial.items[0]!, productId: null }],
    })).toBeNull();
  });

  it("turns item, quantity, purchase, and budget changes into explicit operations", () => {
    expect(sharedOperationsForCartChange(
      { items: [{ productId: "p18", qty: 2, bought: false }], budget: 8_000 },
      { items: [{ productId: "p18", qty: 3, bought: true }, { productId: "p02", qty: 1, bought: false }], budget: 5_000 },
      new Map([["p18", "shared-p18"]]),
    )).toEqual([
      { type: "set-quantity", itemId: "shared-p18", quantity: 3 },
      { type: "set-purchased", itemId: "shared-p18", purchased: true },
      { type: "add", item: { id: "p02", productId: "p02", name: expect.any(String), priceYen: expect.any(Number), quantity: 1 } },
      { type: "set-budget", budgetYen: 5_000 },
    ]);
  });

  it("marks a newly added already-purchased item after adding it", () => {
    expect(sharedOperationsForCartChange(
      { items: [], budget: null },
      { items: [{ productId: "p18", qty: 2, bought: true }], budget: null },
      new Map(),
    )).toEqual([
      { type: "add", item: { id: "p18", productId: "p18", name: expect.any(String), priceYen: expect.any(Number), quantity: 2 } },
      { type: "set-purchased", itemId: "p18", purchased: true },
    ]);
  });

  it("turns a personal cart into ordered shared operations, including bought state and budget", () => {
    expect(sharedOperationsForPersonalCart([
      { productId: "p18", qty: 2, bought: true },
      { productId: "p02", qty: 3, bought: false },
    ], 7_500)).toEqual([
      { type: "add", item: { id: "p18", productId: "p18", name: expect.any(String), priceYen: expect.any(Number), quantity: 2 } },
      { type: "set-purchased", itemId: "p18", purchased: true },
      { type: "add", item: { id: "p02", productId: "p02", name: expect.any(String), priceYen: expect.any(Number), quantity: 3 } },
      { type: "set-budget", budgetYen: 7_500 },
    ]);
  });

  it("limits one shared-copy batch to 120 writes", () => {
    const operations: SharedOperation[] = Array.from({ length: 125 }, (_, index) => ({
      type: "set-budget",
      budgetYen: index,
    }));
    expect(sharedCopyBatch(operations, 0)).toHaveLength(120);
    expect(sharedCopyBatch(operations, 120)).toHaveLength(5);
  });

  it("uses the shared server item id when removing a catalog product", () => {
    expect(sharedOperationsForCartChange(
      { items: [{ productId: "p18", qty: 1, bought: false }], budget: null },
      { items: [], budget: null },
      new Map([["p18", "room-item"]]),
    )).toEqual([{ type: "remove", itemId: "room-item" }]);
  });
});
