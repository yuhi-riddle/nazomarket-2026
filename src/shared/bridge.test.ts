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
  members: [
    { id: "member-1", name: "あき", budgetYen: 8000 },
    { id: "member-2", name: "れん", budgetYen: 4000 },
  ],
  items: [{ id: "p18", productId: "p18", name: "共有名", priceYen: 1_000, quantity: 2, purchased: false, ownerId: "member-1" }],
};

describe("共有リストのbridge", () => {
  it("手元で当てられない送信待ちの操作（名前の重複など）は飛ばし、共同リストの表示は保つ", () => {
    const operations: SharedOperation[] = [
      { type: "add-member", member: { id: "member-3", name: "あき" } },
      { type: "set-quantity", itemId: "p18", quantity: 3 },
    ];

    const projection = projectSharedCart(initial, operations, "member-1");
    expect(projection).not.toBeNull();
    expect(projection?.items).toEqual([{ productId: "p18", qty: 3, bought: false }]);
    expect(projection?.members.map((member) => member.id)).toEqual(["member-1", "member-2"]);
  });

  it("送信待ちのメンバー操作も最新状態へ順に当て、担当対応表を返す", () => {
    const operations: SharedOperation[] = [
      { type: "set-quantity", itemId: "p18", quantity: 4 },
      { type: "set-purchased", itemId: "p18", purchased: true },
      { type: "add-member", member: { id: "member-3", name: "みな" } },
      { type: "rename-member", memberId: "member-2", name: "蓮" },
      { type: "set-member-budget", memberId: "member-1", budgetYen: 5000 },
      { type: "set-owner", itemId: "p18", ownerId: "member-2" },
      { type: "add", item: { id: "p02", productId: "p02", name: "追加品", priceYen: 700, quantity: 1, ownerId: "member-2" } },
      { type: "remove-member", memberId: "member-2" },
    ];

    expect(projectSharedCart(initial, operations, "member-1")).toEqual({
      items: [
        { productId: "p18", qty: 4, bought: true },
        { productId: "p02", qty: 1, bought: false },
      ],
      budget: 5000,
      itemIds: new Map([["p18", "p18"], ["p02", "p02"]]),
      members: [
        { id: "member-1", name: "あき", budgetYen: 5000 },
        { id: "member-3", name: "みな", budgetYen: null },
      ],
      ownerByProductId: new Map([["p18", null], ["p02", null]]),
    });
  });

  it("選択中のメンバーがいなければ自分の予算をnullにする", () => {
    expect(projectSharedCart(initial, [], null)).toMatchObject({ budget: null, members: initial.members });
  });

  it("カタログで表せない共有アイテムを隠さず、projectionを失敗させる", () => {
    expect(projectSharedCart({
      ...initial,
      items: [{ ...initial.items[0]!, productId: "not-in-catalog" }],
    })).toBeNull();
    expect(projectSharedCart({
      ...initial,
      items: [{ ...initial.items[0]!, productId: null }],
    })).toBeNull();
  });

  it("リスト変更から追加操作を作り、新しい商品を選択中メンバーの担当にする", () => {
    expect(sharedOperationsForCartChange(
      { items: [{ productId: "p18", qty: 2, bought: false }] },
      { items: [{ productId: "p18", qty: 3, bought: true }, { productId: "p02", qty: 1, bought: false }] },
      new Map([["p18", "shared-p18"]]),
      "member-1",
    )).toEqual([
      { type: "set-quantity", itemId: "shared-p18", quantity: 3 },
      { type: "set-purchased", itemId: "shared-p18", purchased: true },
      { type: "add", item: { id: "p02", productId: "p02", name: expect.any(String), priceYen: expect.any(Number), quantity: 1, ownerId: "member-1" } },
    ]);
  });

  it("メンバー未選択なら追加アイテムの担当を未定にする", () => {
    expect(sharedOperationsForCartChange(
      { items: [] },
      { items: [{ productId: "p18", qty: 1, bought: false }] },
      new Map(),
      null,
    )).toEqual([
      { type: "add", item: { id: "p18", productId: "p18", name: expect.any(String), priceYen: expect.any(Number), quantity: 1, ownerId: null } },
    ]);
  });

  it("個人リストをコピーするとき全アイテムを自分の担当にする", () => {
    expect(sharedOperationsForPersonalCart([
      { productId: "p18", qty: 2, bought: true },
      { productId: "p02", qty: 3, bought: false },
    ], "member-1")).toEqual([
      { type: "add", item: { id: "p18", productId: "p18", name: expect.any(String), priceYen: expect.any(Number), quantity: 2, ownerId: "member-1" } },
      { type: "set-purchased", itemId: "p18", purchased: true },
      { type: "add", item: { id: "p02", productId: "p02", name: expect.any(String), priceYen: expect.any(Number), quantity: 3, ownerId: "member-1" } },
    ]);
  });

  it("1回の共有コピーを120操作までに分ける", () => {
    const operations: SharedOperation[] = Array.from({ length: 125 }, (_, index) => ({
      type: "set-member-budget",
      memberId: "member-1",
      budgetYen: index,
    }));
    expect(sharedCopyBatch(operations, 0)).toHaveLength(120);
    expect(sharedCopyBatch(operations, 120)).toHaveLength(5);
  });

  it("商品を削除するとき共有サーバーのアイテムIDを使う", () => {
    expect(sharedOperationsForCartChange(
      { items: [{ productId: "p18", qty: 1, bought: false }] },
      { items: [] },
      new Map([["p18", "room-item"]]),
      "member-1",
    )).toEqual([{ type: "remove", itemId: "room-item" }]);
  });
});
