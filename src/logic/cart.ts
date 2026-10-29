import type { ProductView } from "./catalog.ts";

export type CartItem = { productId: string; qty: number; bought: boolean };

export function addItem(items: CartItem[], productId: string): CartItem[] {
  if (items.some((item) => item.productId === productId)) return items;
  return [...items, { productId, qty: 1, bought: false }];
}

export function toggleItem(items: CartItem[], productId: string): CartItem[] {
  return items.some((item) => item.productId === productId)
    ? removeItem(items, productId)
    : addItem(items, productId);
}

export function setQty(items: CartItem[], productId: string, qty: number): CartItem[] {
  if (items.some((item) => item.productId === productId && item.bought)) return items;
  const safeQty = Number.isFinite(qty) ? Math.min(99, Math.max(1, Math.floor(qty))) : 1;
  return items.map((item) => item.productId === productId ? { ...item, qty: safeQty } : item);
}

export function shouldHideCartGroup(items: readonly CartItem[], hideBought: boolean): boolean {
  return hideBought && items.length > 0 && items.every((item) => item.bought);
}

export function removeItem(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.productId !== productId);
}

export function toggleBought(items: CartItem[], productId: string): CartItem[] {
  return items.map((item) => item.productId === productId ? { ...item, bought: !item.bought } : item);
}

export type CartTotals = { amount: number; unknownPrice: number; items: number; qty: number };

export function cartTotals(items: CartItem[], priceOf: (productId: string) => number | null): CartTotals {
  let amount = 0;
  let unknownPrice = 0;
  for (const item of items) {
    const price = priceOf(item.productId);
    if (price === null) unknownPrice += 1;
    else amount += price * item.qty;
  }
  return {
    amount,
    unknownPrice,
    items: items.length,
    qty: items.reduce((sum, item) => sum + item.qty, 0),
  };
}

export function budgetStatus(total: number, budget: number | null):
  | { kind: "none" }
  | { kind: "under"; remaining: number }
  | { kind: "over"; over: number } {
  if (budget === null) return { kind: "none" };
  if (total > budget) return { kind: "over", over: total - budget };
  return { kind: "under", remaining: budget - total };
}

export type DaySummary = {
  spent: number;
  boughtQty: number;
  boughtItems: number;
  unknownPriceBought: number;
  remaining: number | null;
  leftToBuy: number;
};

export function daySummary(items: CartItem[], priceOf: (productId: string) => number | null, budget: number | null): DaySummary {
  let spent = 0;
  let boughtQty = 0;
  let boughtItems = 0;
  let unknownPriceBought = 0;
  let leftToBuy = 0;
  for (const item of items) {
    if (!item.bought) {
      leftToBuy += 1;
      continue;
    }
    boughtItems += 1;
    boughtQty += item.qty;
    const price = priceOf(item.productId);
    if (price === null) unknownPriceBought += 1;
    else spent += price * item.qty;
  }
  return { spent, boughtQty, boughtItems, unknownPriceBought, remaining: budget === null ? null : budget - spent, leftToBuy };
}

export function nazocolleProgress(points: number, options: { pointsPerDraw: number | null; maxDraws: number | null }): {
  draws: number | null;
  nextIn: number | null;
  maxed: boolean;
} {
  if (options.pointsPerDraw === null || options.pointsPerDraw <= 0) return { draws: null, nextIn: null, maxed: false };
  const available = Math.max(0, Math.floor(points));
  const totalDraws = Math.floor(available / options.pointsPerDraw);
  const maxed = options.maxDraws !== null && totalDraws >= options.maxDraws;
  const draws = options.maxDraws === null ? totalDraws : Math.min(totalDraws, options.maxDraws);
  return {
    draws,
    nextIn: maxed ? null : options.pointsPerDraw - (available % options.pointsPerDraw),
    maxed,
  };
}

export function exportCartText(items: CartItem[], catalog: ProductView[]): string {
  const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
  const totals = cartTotals(items, (id) => viewById.get(id)?.product.price ?? null);
  const lines = ["ナゾトキマーケット2026 買うものリスト", ""];
  const ordered = [...items].sort((a, b) => {
    const aView = viewById.get(a.productId);
    const bView = viewById.get(b.productId);
    if (!aView || !bView) return aView ? -1 : bView ? 1 : 0;
    const areaDifference = aView.areaOrder - bView.areaOrder;
    if (areaDifference !== 0) return areaDifference;
    if (aView.boothNumber === null && bView.boothNumber !== null) return 1;
    if (aView.boothNumber !== null && bView.boothNumber === null) return -1;
    return (aView.boothNumber ?? 0) - (bView.boothNumber ?? 0) || aView.sourceIndex - bView.sourceIndex;
  });
  for (const item of ordered) {
    const view = viewById.get(item.productId);
    if (!view) continue;
    const code = view.booth.boothCode ?? "番号未定";
    const price = view.product.price === null ? "価格不明" : view.product.price.toLocaleString("ja-JP") + "円";
    lines.push("・" + code + " " + view.booth.name + "「" + view.product.name + "」" + price + (item.qty > 1 ? "×" + item.qty : "") + (item.bought ? "（買った）" : ""));
  }
  lines.push("");
  lines.push("合計" + totals.amount.toLocaleString("ja-JP") + "円" + (totals.unknownPrice ? "（価格不明" + totals.unknownPrice + "件）" : ""));
  return lines.join("\n");
}
