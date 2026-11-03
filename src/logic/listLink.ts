import type { CartItem } from "./cart.ts";

export type ImportedListItem = { productId: string; qty: number };

export function encodeListParam(items: readonly CartItem[]): string {
  return items.map(({ productId, qty }) => qty === 1 ? productId : `${productId}.${qty}`).join("_");
}

export function parseListParam(raw: string | null, knownIds: Set<string>): {
  items: ImportedListItem[];
  skipped: number;
} {
  if (!raw) return { items: [], skipped: 0 };

  const items: ImportedListItem[] = [];
  const indexById = new Map<string, number>();
  let skipped = 0;
  const parts = raw.split("_").slice(0, 500);

  for (const part of parts) {
    const match = /^([A-Za-z0-9-]+)(?:\.(\d{1,4}))?$/.exec(part);
    if (!match || !knownIds.has(match[1])) {
      skipped += 1;
      continue;
    }

    const productId = match[1];
    const parsedQty = match[2] === undefined ? 1 : Number(match[2]);
    const qty = Math.min(99, Math.max(1, parsedQty));
    const existingIndex = indexById.get(productId);
    if (existingIndex === undefined) {
      indexById.set(productId, items.length);
      items.push({ productId, qty });
    } else if (qty > items[existingIndex].qty) {
      items[existingIndex] = { productId, qty };
    }
  }

  return { items, skipped };
}

export function mergeImportedItems(current: CartItem[], imported: readonly ImportedListItem[]): CartItem[] {
  const merged = current.map((item) => ({ ...item }));
  const indexById = new Map(merged.map((item, index) => [item.productId, index]));

  for (const item of imported) {
    const existingIndex = indexById.get(item.productId);
    if (existingIndex === undefined) {
      indexById.set(item.productId, merged.length);
      merged.push({ productId: item.productId, qty: item.qty, bought: false });
      continue;
    }

    const existing = merged[existingIndex];
    if (!existing.bought && item.qty > existing.qty) {
      merged[existingIndex] = { ...existing, qty: item.qty };
    }
  }

  return merged;
}

export function createListShareUrl(href: string, items: readonly CartItem[]): string {
  const url = new URL(href);
  url.searchParams.delete("room");
  url.searchParams.delete("list");
  url.hash = "";
  url.searchParams.set("list", encodeListParam(items));
  return url.toString();
}
