import { describe, expect, it } from "vitest";
import {
  addItem,
  budgetStatus,
  cartTotals,
  daySummary,
  exportCartText,
  nazocolleProgress,
  removeItem,
  setPriority,
  setQty,
  toggleBought,
  type CartItem,
} from "./cart.ts";
import { buildCatalog } from "./catalog.ts";
import { booths, layout, product } from "./test-helpers.ts";

const prices: Record<string, number | null> = { a: 1000, b: 2500, c: null, d: 500 };
const priceOf = (id: string) => prices[id] ?? null;

const items: CartItem[] = [
  { productId: "a", priority: "must", qty: 2, bought: true },
  { productId: "b", priority: "want", qty: 1, bought: false },
  { productId: "c", priority: "want", qty: 1, bought: true },
  { productId: "d", priority: "maybe", qty: 3, bought: false },
];

describe("リストの操作", () => {
  it("追加は末尾に数量1・未購入で入り、同じ商品なら優先度だけ変える", () => {
    const one = addItem([], "a", "want");
    expect(one).toEqual([{ productId: "a", priority: "want", qty: 1, bought: false }]);
    expect(addItem(one, "a", "must")).toEqual([{ productId: "a", priority: "must", qty: 1, bought: false }]);
  });
  it("数量は1〜99に収める", () => {
    expect(setQty(items, "a", 0)[0].qty).toBe(1);
    expect(setQty(items, "a", 120)[0].qty).toBe(99);
    expect(setQty(items, "a", 4.7)[0].qty).toBe(4);
  });
  it("優先度の変更・削除・買った印の切り替え", () => {
    expect(setPriority(items, "d", "must")[3].priority).toBe("must");
    expect(removeItem(items, "b").map((i) => i.productId)).toEqual(["a", "c", "d"]);
    expect(toggleBought(items, "b")[1].bought).toBe(true);
    expect(toggleBought(items, "a")[0].bought).toBe(false);
  });
  it("元の配列を変えない", () => {
    const copy = structuredClone(items);
    addItem(items, "x", "must");
    setQty(items, "a", 5);
    toggleBought(items, "a");
    expect(items).toEqual(copy);
  });
});

describe("cartTotals", () => {
  const t = cartTotals(items, priceOf);
  it("優先度ごとの金額（価格×数量）と件数、価格不明の件数", () => {
    expect(t.byPriority.must).toEqual({ amount: 2000, items: 1, qty: 2, unknownPrice: 0 });
    expect(t.byPriority.want).toEqual({ amount: 2500, items: 2, qty: 2, unknownPrice: 1 });
    expect(t.byPriority.maybe).toEqual({ amount: 1500, items: 1, qty: 3, unknownPrice: 0 });
  });
  it("累計は 絶対だけ / できれば込み / 全部。価格不明は混ぜず件数を別に出す", () => {
    expect(t.cumulative).toEqual({ must: 2000, mustWant: 4500, all: 6000 });
    expect(t.unknownPrice).toBe(1);
    expect(t.items).toBe(4);
    expect(t.qty).toBe(7);
  });
  it("空のリスト", () => {
    expect(cartTotals([], priceOf).cumulative).toEqual({ must: 0, mustWant: 0, all: 0 });
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

describe("daySummary（当日モード）", () => {
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
  it("優先度ごとに ブース番号・団体・商品・価格×数量 を並べ、最後に合計を書く", () => {
    const text = exportCartText(
      [
        { productId: "p01", priority: "must", qty: 1, bought: false },
        { productId: "p02", priority: "must", qty: 1, bought: false },
        { productId: "p03", priority: "maybe", qty: 2, bought: true },
      ],
      catalog,
    );
    expect(text).toBe(
      [
        "ナゾトキマーケット2026 買うものリスト",
        "",
        "【絶対】",
        "・Ca1 謎屋「封筒の謎」2,000円",
        "・番号未定 場所未定「どこかの謎」価格不明",
        "【余裕があれば】",
        "・A1 ナゾトキ商店「缶バッジ」500円×2（買った）",
        "",
        "絶対だけで2,000円／できれば込みで2,000円／全部で3,000円（価格不明1件）",
      ].join("\n"),
    );
  });
});
