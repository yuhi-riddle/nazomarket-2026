import type { Day, Point, VenueLayout } from "../types.ts";
import type { ProductView } from "./catalog.ts";
import type { CartItem } from "./cart.ts";

export type RouteStop = {
  boothId: string;
  code: string;
  point: Point;
  special: boolean;
};

export type BuildRouteOptions = { onlyUnbought?: boolean };
export type BuildRouteResult = { stops: RouteStop[]; unplaced: string[]; notSoldThatDay: string[] };

export function buildRouteStops(
  items: CartItem[],
  catalog: ProductView[],
  layout: VenueLayout,
  day: Day,
  options: BuildRouteOptions = {},
): BuildRouteResult {
  const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
  const layoutByCode = new Map(layout.booths.map((booth, index): [string, { index: number; booth: VenueLayout["booths"][number] }] => [
    booth.code,
    { index, booth },
  ]));
  const grouped = new Map<string, { view: ProductView; special: boolean; layoutIndex: number }>();
  const unplaced = new Set<string>();
  const notSoldThatDay: string[] = [];

  for (const item of items) {
    if (options.onlyUnbought && item.bought) continue;
    const view = viewById.get(item.productId);
    if (!view) continue;
    const layoutEntry = view.booth.boothCode ? layoutByCode.get(view.booth.boothCode) : undefined;
    const mappedLabel = layoutEntry?.booth.labels[day];
    if (!view.product.days.includes(day) || !view.booth.days.includes(day) || (layoutEntry && mappedLabel === null)) {
      notSoldThatDay.push(item.productId);
      continue;
    }
    if (!view.booth.boothCode || !layoutEntry) {
      unplaced.add(view.booth.id);
      continue;
    }

    const existing = grouped.get(view.booth.id);
    const itemSpecial = view.product.isNew === true || Boolean(view.product.limited);
    if (existing) {
      existing.special ||= itemSpecial;
    } else {
      grouped.set(view.booth.id, {
        view,
        special: itemSpecial,
        layoutIndex: layoutEntry.index,
      });
    }
  }

  const stops = [...grouped.values()]
    .sort((a, b) => a.layoutIndex - b.layoutIndex)
    .map(({ view, special }) => {
      const booth = layoutByCode.get(view.booth.boothCode as string)!.booth;
      return {
        boothId: view.booth.id,
        code: booth.code,
        point: { x: booth.x + booth.w / 2, y: booth.y + booth.h / 2 },
        special,
      };
    });

  return { stops, unplaced: [...unplaced], notSoldThatDay };
}
