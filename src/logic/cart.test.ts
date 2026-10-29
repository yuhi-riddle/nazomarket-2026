import { describe, expect, it } from "vitest";
import {
  addItem,
  budgetStatus,
  cartTotals,
  daySummary,
  exportCartText,
  nazocolleProgress,
  removeItem,
  shouldHideCartGroup,
  toggleItem,
  setQty,
  toggleBought,
  type CartItem,
} from "./cart.ts";
import { buildCatalog } from "./catalog.ts";
import { booths, layout, product } from "./test-helpers.ts";

const prices: Record<string, number | null> = { a: 1000, b: 2500, c: null, d: 500 };
const priceOf = (id: string) => prices[id] ?? null;

const items: CartItem[] = [
  { productId: "a", qty: 2, bought: true },
  { productId: "b", qty: 1, bought: false },
  { productId: "c", qty: 1, bought: true },
  { productId: "d", qty: 3, bought: false },
];

describe("リストの操作", () => {
  it("追加は末尾に数量1・未購入で入り、同じ商品なら何も変えない", () => {
    const one = addItem([], "a");
    expect(one).toEqual([{ productId: "a", qty: 1, bought: false }]);
    expect(addItem(one, "a")).toEqual(one);
  });
  it("toggleItem は入っていなければ入れ、入っていれば外す", () => {
    const one = toggleItem([], "a");
    expect(one).toEqual([{ productId: "a", qty: 1, bought: false }]);
    expect(toggleItem(one, "a")).toEqual([]);
  });
  it("数量は1〜99に収める", () => {
    expect(setQty(items, "b", 0)[1].qty).toBe(1);
    expect(setQty(items, "b", 120)[1].qty).toBe(99);
    expect(setQty(items, "b", 4.7)[1].qty).toBe(4);
  });
  it("購入済みの商品は数量を変更しない", () => {
    expect(setQty(items, "a", 5)).toBe(items);
    expect(setQty(items, "a", 5)[0]?.qty).toBe(2);
  });
  it("購入済みの商品だけでできたブースは、買ったものを隠すときだけ隠す", () => {
    expect(shouldHideCartGroup([items[0]!, items[2]!], true)).toBe(true);
    expect(shouldHideCartGroup([items[0]!, items[1]!], true)).toBe(false);
    expect(shouldHideCartGroup([items[0]!, items[2]!], false)).toBe(false);
  });
  it("削除・買った印の切り替え", () => {
    expect(removeItem(items, "b").map((i) => i.productId)).toEqual(["a", "c", "d"]);
    expect(toggleBought(items, "b")[1].bought).toBe(true);
    expect(toggleBought(items, "a")[0].bought).toBe(false);
  });
  it("元の配列を変えない", () => {
    const copy = structuredClone(items);
    addItem(items, "x");
    toggleItem(items, "a");
    setQty(items, "a", 5);
    toggleBought(items, "a");
    expect(items).toEqual(copy);
  });
});

describe("cartTotals", () => {
  it("合計（価格×数量）と件数・点数。価格不明は混ぜず件数を別に出す", () => {
    expect(cartTotals(items, priceOf)).toEqual({ amount: 6000, unknownPrice: 1, items: 4, qty: 7 });
  });
  it("空のリスト", () => {
    expect(cartTotals([], priceOf)).toEqual({ amount: 0, unknownPrice: 0, items: 0, qty: 0 });
  });
});

describe("budgetStatus", () => {
  it("予算未設定・残り・ちょうど・超過", () => {
    expect(budgetStatus(3000, null)).toEqual({ kind: "none" });
    expect(budgetStatus(3000, 5000)).toEqual({ kind: "under", remaining: 2000 });
    expect(budgetStatus(5000, 5000)).toEqual({ kind: "under", remaining: 0 });
    expect(budgetStatus(6500, 5000)).toEqual({ kind: "over", over: 1500 });
  });
});

describe("daySummary（買った分）", () => {
  it("買った分の金額・点数、残り予算、まだ買っていない件数", () => {
    expect(daySummary(items, priceOf, 10000)).toEqual({
      spent: 2000,
      boughtQty: 3,
      boughtItems: 2,
      unknownPriceBought: 1,
      remaining: 8000,
      leftToBuy: 2,
    });
  });
  it("予算が無ければ残りは null、超えたらマイナス", () => {
    expect(daySummary(items, priceOf, null).remaining).toBeNull();
    expect(daySummary(items, priceOf, 1500).remaining).toBe(-500);
  });
});

describe("nazocolleProgress", () => {
  it("何点で1回か分からなければ回数は出さない", () => {
    expect(nazocolleProgress(3, { pointsPerDraw: null, maxDraws: 5 })).toEqual({ draws: null, nextIn: null, maxed: false });
  });
  it("分かっていれば、引ける回数と次の福引まであと何点かを出す（上限あり）", () => {
    expect(nazocolleProgress(3, { pointsPerDraw: 1, maxDraws: 5 })).toEqual({ draws: 3, nextIn: 1, maxed: false });
    expect(nazocolleProgress(3, { pointsPerDraw: 2, maxDraws: 5 })).toEqual({ draws: 1, nextIn: 1, maxed: false });
    expect(nazocolleProgress(0, { pointsPerDraw: 2, maxDraws: 5 })).toEqual({ draws: 0, nextIn: 2, maxed: false });
    expect(nazocolleProgress(7, { pointsPerDraw: 1, maxDraws: 5 })).toEqual({ draws: 5, nextIn: null, maxed: true });
  });
});

describe("exportCartText", () => {
  const catalog = buildCatalog(
    [
      product({ id: "p01", boothId: "no03", name: "封筒の謎", price: 2000 }),
      product({ id: "p02", boothId: "no07", name: "どこかの謎", price: null }),
      product({ id: "p03", boothId: "no01", name: "缶バッジ", price: 500 }),
    ],
    booths,
    layout,
  );
  it("ブース番号順に ブース番号・団体・商品・価格×数量 を並べ、最後に合計を書く（場所未定は最後）", () => {
    const text = exportCartText(
      [
        { productId: "p01", qty: 1, bought: false },
        { productId: "p02", qty: 1, bought: false },
        { productId: "p03", qty: 2, bought: true },
      ],
      catalog,
    );
    expect(text).toBe(
      [
        "ナゾトキマーケット2026 買うものリスト",
        "",
        "・A1 ナゾトキ商店「缶バッジ」500円×2（買った）",
        "・Ca1 謎屋「封筒の謎」2,000円",
        "・番号未定 場所未定「どこかの謎」価格不明",
        "",
        "合計3,000円（価格不明1件）",
      ].join("\n"),
    );
  });
});
