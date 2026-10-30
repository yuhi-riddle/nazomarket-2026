import { productById } from "../data.ts";
import type { CartItem } from "../logic/cart.ts";
import type { SharedListItem, SharedListState, SharedOperation } from "./types.ts";

export type SharedCartProjection = {
  items: CartItem[];
  budget: number | null;
  itemIds: Map<string, string>;
};

export const SHARED_WRITE_LIMIT_PER_MINUTE = 120;
export const SHARED_WRITE_WINDOW_MS = 60_000;

function applyOperation(
  items: SharedListItem[],
  budget: number | null,
  operation: SharedOperation,
): { items: SharedListItem[]; budget: number | null } | null {
  switch (operation.type) {
    case "add":
      if (items.some((item) => item.id === operation.item.id)) return null;
      return { items: [...items, { ...operation.item, purchased: false }], budget };
    case "remove": {
      const index = items.findIndex((item) => item.id === operation.itemId);
      if (index < 0) return null;
      return { items: items.filter((item) => item.id !== operation.itemId), budget };
    }
    case "set-quantity": {
      if (!items.some((item) => item.id === operation.itemId)) return null;
      return {
        items: items.map((item) => item.id === operation.itemId ? { ...item, quantity: operation.quantity } : item),
        budget,
      };
    }
    case "set-purchased": {
      if (!items.some((item) => item.id === operation.itemId)) return null;
      return {
        items: items.map((item) => item.id === operation.itemId ? { ...item, purchased: operation.purchased } : item),
        budget,
      };
    }
    case "set-budget":
      return { items, budget: operation.budgetYen };
  }
}

export function projectSharedCart(
  snapshot: SharedListState,
  operations: SharedOperation[] = [],
): SharedCartProjection | null {
  let items = snapshot.items.map((item) => ({ ...item }));
  let budget = snapshot.budgetYen;
  for (const operation of operations) {
    const next = applyOperation(items, budget, operation);
    if (!next) return null;
    items = next.items;
    budget = next.budget;
  }

  const seenProducts = new Set<string>();
  const itemIds = new Map<string, string>();
  const cartItems: CartItem[] = [];
  for (const item of items) {
    if (item.productId === null || !productById.has(item.productId) || item.quantity > 99 || seenProducts.has(item.productId)) {
      return null;
    }
    seenProducts.add(item.productId);
    itemIds.set(item.productId, item.id);
    cartItems.push({ productId: item.productId, qty: item.quantity, bought: item.purchased });
  }
  return { items: cartItems, budget, itemIds };
}

function itemIdForProduct(productId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(productId)) {
    throw new Error("このアイテムIDは共有リストで扱えません。");
  }
  return productId;
}

export function sharedOperationsForCartChange(
  previous: { items: CartItem[]; budget: number | null },
  next: { items: CartItem[]; budget: number | null },
  itemIds: ReadonlyMap<string, string>,
): SharedOperation[] {
  const previousByProduct = new Map(previous.items.map((item) => [item.productId, item]));
  const nextByProduct = new Map(next.items.map((item) => [item.productId, item]));
  const operations: SharedOperation[] = [];

  for (const item of previous.items) {
    if (nextByProduct.has(item.productId)) continue;
    const itemId = itemIds.get(item.productId);
    if (!itemId) throw new Error("共有アイテムの識別子を読み取れません。");
    operations.push({ type: "remove", itemId });
  }

  for (const item of next.items) {
    const previousItem = previousByProduct.get(item.productId);
    if (!previousItem) {
      const product = productById.get(item.productId);
      if (!product || [...product.name].length > 100 || (product.price !== null && product.price > 1_000_000_000)) {
        throw new Error("このアイテム情報は共有リストで扱えません。");
      }
      operations.push({
        type: "add",
        item: {
          id: itemIdForProduct(item.productId),
          productId: item.productId,
          name: product.name,
          priceYen: product.price,
          quantity: item.qty,
        },
      });
      if (item.bought) operations.push({ type: "set-purchased", itemId: itemIdForProduct(item.productId), purchased: true });
      continue;
    }

    const itemId = itemIds.get(item.productId);
    if (!itemId) throw new Error("共有アイテムの識別子を読み取れません。");
    if (previousItem.qty !== item.qty) operations.push({ type: "set-quantity", itemId, quantity: item.qty });
    if (previousItem.bought !== item.bought) operations.push({ type: "set-purchased", itemId, purchased: item.bought });
  }

  if (previous.budget !== next.budget) operations.push({ type: "set-budget", budgetYen: next.budget });
  return operations;
}

export function sharedOperationsForPersonalCart(items: CartItem[], budget: number | null): SharedOperation[] {
  return sharedOperationsForCartChange(
    { items: [], budget: null },
    { items, budget },
    new Map(),
  );
}

export function sharedCopyBatch(
  operations: SharedOperation[],
  offset: number,
  limit = SHARED_WRITE_LIMIT_PER_MINUTE,
): SharedOperation[] {
  const start = Math.max(0, Math.floor(offset));
  return operations.slice(start, start + Math.max(0, Math.floor(limit)));
}
