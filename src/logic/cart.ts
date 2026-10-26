import type { ProductView } from "./catalog.ts";

export type Priority = "must" | "want" | "maybe";
export type CartItem = { productId: string; priority: Priority; qty: number; bought: boolean };

export const PRIORITIES: ReadonlyArray<{ key: Priority; label: string }> = [
  { key: "must", label: "絶対" },
  { key: "want", label: "できれば" },
  { key: "maybe", label: "余裕があれば" },
];

export function addItem(items: CartItem[], productId: string, priority: Priority): CartItem[] {
  const index = items.findIndex((item) => item.productId === productId);
  if (index < 0) return [...items, { productId, priority, qty: 1, bought: false }];
  return items.map((item, itemIndex) => itemIndex === index ? { ...item, priority } : item);
}

export function setPriority(items: CartItem[], productId: string, priority: Priority): CartItem[] {
  return items.map((item) => item.productId === productId ? { ...item, priority } : item);
}

export function setQty(items: CartItem[], productId: string, qty: number): CartItem[] {
  const safeQty = Number.isFinite(qty) ? Math.min(99, Math.max(1, Math.floor(qty))) : 1;
  return items.map((item) => item.productId === productId ? { ...item, qty: safeQty } : item);
}

export function removeItem(items: CartItem[], productId: string): CartItem[] {
  return items.filter((item) => item.productId !== productId);
}

export function toggleBought(items: CartItem[], productId: string): CartItem[] {
  return items.map((item) => item.productId === productId ? { ...item, bought: !item.bought } : item);
}

export type PriorityTotal = { amount: number; items: number; qty: number; unknownPrice: number };
export type CartTotals = {
  byPriority: Record<Priority, PriorityTotal>;
  cumulative: { must: number; mustWant: number; all: number };
  unknownPrice: number;
  items: number;
  qty: number;
};

export function cartTotals(items: CartItem[], priceOf: (productId: string) => number | null): CartTotals {
  const byPriority: Record<Priority, PriorityTotal> = {
    must: { amount: 0, items: 0, qty: 0, unknownPrice: 0 },
    want: { amount: 0, items: 0, qty: 0, unknownPrice: 0 },
    maybe: { amount: 0, items: 0, qty: 0, unknownPrice: 0 },
  };
  for (const item of items) {
    const group = byPriority[item.priority];
    const price = priceOf(item.productId);
    group.items += 1;
    group.qty += item.qty;
    if (price === null) group.unknownPrice += 1;
    else group.amount += price * item.qty;
  }
  const must = byPriority.must.amount;
  const mustWant = must + byPriority.want.amount;
  return {
    byPriority,
    cumulative: { must, mustWant, all: mustWant + byPriority.maybe.amount },
    unknownPrice: byPriority.must.unknownPrice + byPriority.want.unknownPrice + byPriority.maybe.unknownPrice,
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

const priorityLabels: Record<Priority, string> = { must: "絶対", want: "できれば", maybe: "余裕があれば" };

export function exportCartText(items: CartItem[], catalog: ProductView[]): string {
  const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
  const totals = cartTotals(items, (id) => viewById.get(id)?.product.price ?? null);
  const lines = ["ナゾトキマーケット2026 買うものリスト", ""];
  for (const priority of ["must", "want", "maybe"] as const) {
    const group = items.filter((item) => item.priority === priority).sort((a, b) => {
      const aView = viewById.get(a.productId);
      const bView = viewById.get(b.productId);
      if (!aView || !bView) return aView ? -1 : bView ? 1 : 0;
      const areaDifference = aView.areaOrder - bView.areaOrder;
      if (areaDifference !== 0) return areaDifference;
      if (aView.boothNumber === null && bView.boothNumber !== null) return 1;
      if (aView.boothNumber !== null && bView.boothNumber === null) return -1;
      return (aView.boothNumber ?? 0) - (bView.boothNumber ?? 0) || aView.sourceIndex - bView.sourceIndex;
    });
    if (!group.length) continue;
    lines.push("【" + priorityLabels[priority] + "】");
    for (const item of group) {
      const view = viewById.get(item.productId);
      if (!view) continue;
      const code = view.booth.boothCode ?? "番号未定";
      const price = view.product.price === null ? "価格不明" : view.product.price.toLocaleString("ja-JP") + "円";
      lines.push("・" + code + " " + view.booth.name + "「" + view.product.name + "」" + price + (item.qty > 1 ? "×" + item.qty : "") + (item.bought ? "（買った）" : ""));
    }
  }
  lines.push("");
  lines.push(
    "絶対だけで" + totals.cumulative.must.toLocaleString("ja-JP") + "円／できれば込みで"
    + totals.cumulative.mustWant.toLocaleString("ja-JP") + "円／全部で" + totals.cumulative.all.toLocaleString("ja-JP")
    + "円" + (totals.unknownPrice ? "（価格不明" + totals.unknownPrice + "件）" : ""),
  );
  return lines.join("\n");
}
