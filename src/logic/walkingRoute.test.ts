import { describe, expect, it } from "vitest";
import layoutJson from "../../data/venue-layout.json";
import type { Point, Rect, VenueLayout } from "../types.ts";
import type { RouteStop } from "./route.ts";
import { createWalkGrid, planWalkingRoute } from "./walkingRoute.ts";

const layout = layoutJson as VenueLayout;
const boothRect = (code: string): Rect => {
  const booth = layout.booths.find((b) => b.code === code);
  if (!booth) throw new Error(code);
  return { x: booth.x, y: booth.y, w: booth.w, h: booth.h };
};
const stopOf = (code: string, special = false): RouteStop => {
  const r = boothRect(code);
  return { boothId: "b-" + code, code, point: { x: r.x + r.w / 2, y: r.y + r.h / 2 }, special };
};
const obstacles: Rect[] = [
  ...layout.booths.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
  ...layout.landmarks.flatMap((l) => l.rects),
];

// 線分 a-b が矩形の内部を通るか（辺に触れるだけなら通らない扱い）
function crossesRect(a: Point, b: Point, r: Rect): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i += 1) {
    const x = a.x + (b.x - a.x) * i / steps;
    const y = a.y + (b.y - a.y) * i / steps;
    if (x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5) return true;
  }
  return false;
}
const length = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

describe("walkingRoute（通路沿いの回る順番）", () => {
  const grid = createWalkGrid(layout);

  it("94 ブースすべてに、入口から歩いて届く立ち寄り点がある", () => {
    const unreachable = layout.booths.map((b) => b.code).filter((code) => grid.visitPoint(code) === null);
    expect(unreachable).toEqual([]);
  });

  it("全ブースを回っても、線はどのブース・協賛・宅配・トイレの矩形も横切らない", () => {
    const route = planWalkingRoute(grid, layout.booths.map((b) => stopOf(b.code)), { frontLoadSpecial: false });
    expect(route.unreachable).toEqual([]);
    const crossings: string[] = [];
    route.legs.forEach((leg, legIndex) => {
      leg.slice(1).forEach((p, i) => {
        for (const r of obstacles) if (crossesRect(leg[i], p, r)) crossings.push(`leg${legIndex}: ${JSON.stringify(r)}`);
      });
    });
    expect(crossings.slice(0, 5)).toEqual([]);
  });

  it("区間はつながっていて、入口から始まり、立ち寄り点を順に通って、出口で終わる", () => {
    const route = planWalkingRoute(grid, ["A3", "Ba1", "Ca10"].map((c) => stopOf(c)), { frontLoadSpecial: false });
    expect(route.stops).toHaveLength(3);
    expect(route.legs).toHaveLength(4);
    route.stops.forEach((stop, i) => {
      expect(same(route.legs[i].at(-1)!, stop.visitPoint)).toBe(true);
      expect(same(route.legs[i + 1][0], stop.visitPoint)).toBe(true);
    });
    expect(Math.hypot(route.legs[0][0].x - layout.entrance.x, route.legs[0][0].y - layout.entrance.y)).toBeLessThan(12);
    expect(Math.hypot(route.legs.at(-1)!.at(-1)!.x - layout.exit.x, route.legs.at(-1)!.at(-1)!.y - layout.exit.y)).toBeLessThan(12);
  });

  it("立ち寄り点はブースの外で、ブースのすぐそば（12px 以内）", () => {
    for (const code of ["A1", "Ba3", "Cc10", "Ca10", "Ce3"]) {
      const p = grid.visitPoint(code)!;
      const r = boothRect(code);
      const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
      const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
      expect(dx > 0 || dy > 0).toBe(true);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(12);
    }
  });

  it("入口から A4 へは、ブースのかたまりを回り込むので直線より長い（Ca10 は入口が通路の延長上なので直線で届く）", () => {
    const route = planWalkingRoute(grid, [stopOf("A4")], { frontLoadSpecial: false });
    const visit = route.stops[0].visitPoint;
    const straight = Math.hypot(visit.x - route.legs[0][0].x, visit.y - route.legs[0][0].y);
    expect(length(route.legs[0])).toBeGreaterThan(straight);
  });

  it("通路をはさんで向かい合う A1・A3（上の通路）と Ba1・Ba3（下の通路）は、同じ通路どうしを続けて回る", () => {
    const route = planWalkingRoute(grid, ["Ba1", "A1", "Ba3", "A3"].map((c) => stopOf(c)), { frontLoadSpecial: false });
    const order = route.stops.map((s) => s.code);
    const adjacent = (a: string, b: string) => Math.abs(order.indexOf(a) - order.indexOf(b)) === 1;
    expect(adjacent("A1", "A3") && adjacent("Ba1", "Ba3")).toBe(true);
  });

  it("新作・限定を先に回ると、印のあるブースが前にそろう（入れ替えの後も）", () => {
    const stops = [stopOf("Ca1"), stopOf("A6", true), stopOf("Ba1"), stopOf("Cc20", true), stopOf("A1")];
    const route = planWalkingRoute(grid, stops, { frontLoadSpecial: true });
    expect(route.stops.slice(0, 2).map((s) => s.code).sort()).toEqual(["A6", "Cc20"]);
  });

  it("立ち寄り点はブースの正面の通路側（壁際や背中合わせのすき間には立ち寄らない）", () => {
    const below = (code: string) => grid.visitPoint(code)!.y > boothRect(code).y + boothRect(code).h;
    const above = (code: string) => grid.visitPoint(code)!.y < boothRect(code).y;
    // A 列は奥の壁を背にした大ブース。裏（壁との 27px のすき間）には立ち寄らない。ブースどうしの間（44〜87px）は正面の通路と同じくらい広いので、横からでもよい
    const notBehind = (code: string) => grid.visitPoint(code)!.y > boothRect(code).y;
    expect(["A1", "A2", "A3", "A4", "A5", "A6"].filter((c) => !notBehind(c))).toEqual([]);
    expect(["Bb1", "Bb5"].filter((c) => !above(c))).toEqual([]);
    expect(["Ba1", "Ba4", "Cc3"].filter((c) => (c.startsWith("Ba") ? !below(c) : !above(c)))).toEqual([]);
    expect(["Ca10", "Cb5"].filter((c) => (c.startsWith("Ca") ? !above(c) : !below(c)))).toEqual([]);
  });

  it("止まる所が無ければ線を引かない", () => {
    expect(planWalkingRoute(grid, [], { frontLoadSpecial: false })).toEqual({ stops: [], legs: [], unreachable: [] });
  });

  it("同じブースの組をもう一度計算しても、探索は増えない（立ち寄り点ごとに使い回す）", () => {
    const fresh = createWalkGrid(layout);
    const stops = ["A2", "Bb5", "Cc3"].map((c) => stopOf(c));
    planWalkingRoute(fresh, stops, { frontLoadSpecial: false });
    const after1 = fresh.searchCount;
    planWalkingRoute(fresh, stops, { frontLoadSpecial: true });
    expect(fresh.searchCount).toBe(after1);
    planWalkingRoute(fresh, [...stops, stopOf("Ca2")], { frontLoadSpecial: false });
    expect(fresh.searchCount).toBe(after1 + 1);
  });

  it("性能: 20 か所の計算が 50ms 以内（格子を作った後）", () => {
    const fresh = createWalkGrid(layout);
    const codes = layout.booths.filter((_, i) => i % 4 === 0).slice(0, 20).map((b) => b.code);
    const start = performance.now();
    planWalkingRoute(fresh, codes.map((c) => stopOf(c)), { frontLoadSpecial: false });
    expect(performance.now() - start).toBeLessThan(50);
  });
});
