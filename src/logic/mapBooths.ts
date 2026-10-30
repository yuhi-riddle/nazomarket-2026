import type { Day, VenueLayout } from "../types.ts";
import type { CartItem } from "./cart.ts";
import type { ProductView } from "./catalog.ts";
import { buildRouteStops } from "./route.ts";

export function listedItemsForBooth(views: ProductView[], items: CartItem[]): CartItem[] {
  const itemById = new Map(items.map((item) => [item.productId, item]));
  return views.flatMap((view) => {
    const item = itemById.get(view.product.id);
    return item ? [item] : [];
  });
}

function itemsByBooth(
  items: CartItem[], catalog: ProductView[], layout: VenueLayout, day: Day,
  onlyUnbought: boolean,
): Map<string, CartItem[]> {
  const result = buildRouteStops(items, catalog, layout, day, { onlyUnbought });
  const validBooths = new Set(result.stops.map((stop) => stop.boothId));
  const notSold = new Set(result.notSoldThatDay);
  const views = new Map(catalog.map((view) => [view.product.id, view]));
  const grouped = new Map<string, CartItem[]>();
  for (const item of items) {
    if ((onlyUnbought && item.bought) || notSold.has(item.productId)) continue;
    const view = views.get(item.productId);
    const code = view?.booth.boothCode;
    if (!view || !code || !validBooths.has(view.booth.id)) continue;
    const group = grouped.get(code) ?? [];
    group.push(item);
    grouped.set(code, group);
  }
  return grouped;
}

export function unboughtItemsByBooth(
  items: CartItem[], catalog: ProductView[], layout: VenueLayout, day: Day,
): Map<string, CartItem[]> {
  return itemsByBooth(items, catalog, layout, day, true);
}

export type BoothListStatus = { status: "todo" | "clear"; unboughtQty: number };

export function boothListStatus(
  items: CartItem[], catalog: ProductView[], layout: VenueLayout, day: Day,
): Map<string, BoothListStatus> {
  const listedItems = itemsByBooth(items, catalog, layout, day, false);
  const result = new Map<string, BoothListStatus>();
  for (const [boothCode, boothItems] of listedItems) {
    const unboughtQty = boothItems.reduce((sum, item) => sum + (item.bought ? 0 : item.qty), 0);
    result.set(boothCode, {
      status: unboughtQty > 0 ? "todo" : "clear",
      unboughtQty,
    });
  }
  return result;
}
