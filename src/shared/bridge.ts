import { applyOperation, parseSharedState, type SharedMember } from "../../shared-worker/src/domain.ts";
import { productById } from "../data.ts";
import type { CartItem } from "../logic/cart.ts";
import type { SharedListState, SharedOperation } from "./types.ts";

export type SharedCartProjection = {
  items: CartItem[];
  budget: number | null;
  itemIds: Map<string, string>;
  members: SharedMember[];
  ownerByProductId: Map<string, string | null>;
  meId: string | null;
};

export const SHARED_WRITE_LIMIT_PER_MINUTE = 120;
export const SHARED_WRITE_WINDOW_MS = 60_000;

export function projectSharedCart(
  snapshot: SharedListState,
  operations: SharedOperation[] = [],
  requestedMeId: string | null = null,
): SharedCartProjection | null {
  let state: SharedListState;
  try {
    state = parseSharedState(snapshot);
    for (const operation of operations) {
      state = applyOperation(state, { baseRevision: state.revision, operation });
    }
  } catch {
    return null;
  }

  const seenProducts = new Set<string>();
  const itemIds = new Map<string, string>();
  const ownerByProductId = new Map<string, string | null>();
  const cartItems: CartItem[] = [];
  for (const item of state.items) {
    if (item.productId === null || !productById.has(item.productId) || item.quantity > 99 || seenProducts.has(item.productId)) {
      return null;
    }
    seenProducts.add(item.productId);
    itemIds.set(item.productId, item.id);
    ownerByProductId.set(item.productId, item.ownerId);
    cartItems.push({ productId: item.productId, qty: item.quantity, bought: item.purchased });
  }

  const meId = requestedMeId !== null && state.members.some((member) => member.id === requestedMeId)
    ? requestedMeId
    : null;
  const projection: SharedCartProjection = {
    items: cartItems,
    budget: state.members.find((member) => member.id === meId)?.budgetYen ?? null,
    itemIds,
    members: state.members,
    ownerByProductId,
    meId,
  };
  // Keep the historical enumerable projection shape while exposing the selected member to the store.
  Object.defineProperty(projection, "meId", { value: meId, enumerable: false });
  return projection;
}

function itemIdForProduct(productId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(productId)) {
    throw new Error("このアイテムIDは共有リストで扱えません。");
  }
  return productId;
}

export function sharedOperationsForCartChange(
  previous: { items: CartItem[] },
  next: { items: CartItem[] },
  itemIds: ReadonlyMap<string, string>,
  meId: string | null = null,
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
          ownerId: meId,
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

  return operations;
}

export function sharedOperationsForPersonalCart(items: CartItem[], meId: string | null = null): SharedOperation[] {
  return sharedOperationsForCartChange({ items: [] }, { items }, new Map(), meId);
}

export function sharedCopyBatch(
  operations: SharedOperation[],
  offset: number,
  limit = SHARED_WRITE_LIMIT_PER_MINUTE,
): SharedOperation[] {
  const start = Math.max(0, Math.floor(offset));
  return operations.slice(start, start + Math.max(0, Math.floor(limit)));
}
