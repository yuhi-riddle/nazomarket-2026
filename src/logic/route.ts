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
export type PlanRouteOptions = { frontLoadSpecial: boolean };
export type BuildRouteResult = { stops: RouteStop[]; unplaced: string[]; notSoldThatDay: string[] };

const naturalCodeOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

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

function distanceSquared(a: Point, b: Point): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return x * x + y * y;
}

function nearestNeighbor(stops: RouteStop[], start: Point): RouteStop[] {
  const remaining = [...stops];
  const ordered: RouteStop[] = [];
  let current = start;
  while (remaining.length) {
    let nearestIndex = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      const candidateDistance = distanceSquared(current, remaining[index].point);
      const nearestDistance = distanceSquared(current, remaining[nearestIndex].point);
      if (candidateDistance < nearestDistance || (candidateDistance === nearestDistance
        && naturalCodeOrder.compare(remaining[index].code, remaining[nearestIndex].code) < 0)) {
        nearestIndex = index;
      }
    }
    const [next] = remaining.splice(nearestIndex, 1);
    ordered.push(next);
    current = next.point;
  }
  return ordered;
}

export function planRoute(stops: RouteStop[], entrance: Point, options: PlanRouteOptions): RouteStop[] {
  if (!options.frontLoadSpecial) return nearestNeighbor(stops, entrance);
  const special = nearestNeighbor(stops.filter((stop) => stop.special), entrance);
  const remaining = stops.filter((stop) => !stop.special);
  const lastPoint = special.at(-1)?.point ?? entrance;
  return [...special, ...nearestNeighbor(remaining, lastPoint)];
}
