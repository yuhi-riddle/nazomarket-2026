import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.ts";
import { buildRouteStops, planRoute, type RouteStop } from "./route.ts";
import { booths, layout, product } from "./test-helpers.ts";

const stop = (code: string, x: number, y: number, special = false): RouteStop => ({
  boothId: code,
  code,
  point: { x, y },
  special,
});

describe("planRoute", () => {
  const entrance = { x: 100, y: 0 };

  it("入口から最近傍法で並べる（優先度は無い）", () => {
    const stops = [stop("far", 0, 0), stop("near", 90, 0), stop("mid", 50, 0), stop("w1", 95, 0)];
    expect(planRoute(stops, entrance, { frontLoadSpecial: false }).map((s) => s.code)).toEqual(["w1", "near", "mid", "far"]);
  });
  it("新作・限定を前に寄せると、印のあるブースを先に回り、残りはその続きから最近傍法", () => {
    const stops = [stop("plain", 90, 0), stop("special", 10, 0, true), stop("plain2", 5, 0)];
    expect(planRoute(stops, entrance, { frontLoadSpecial: true }).map((s) => s.code)).toEqual(["special", "plain2", "plain"]);
    expect(planRoute(stops, entrance, { frontLoadSpecial: false }).map((s) => s.code)).toEqual(["plain", "special", "plain2"]);
  });
  it("距離が同じならブース番号の小さい方（入力順ではなく code の自然順）", () => {
    const stops = [stop("Ca10", 110, 0), stop("Ca2", 90, 0)];
    expect(planRoute(stops, entrance, { frontLoadSpecial: false }).map((s) => s.code)).toEqual(["Ca2", "Ca10"]);
  });
  it("空なら空", () => {
    expect(planRoute([], entrance, { frontLoadSpecial: true })).toEqual([]);
  });
});

describe("buildRouteStops", () => {
  const catalog = buildCatalog(
    [
      product({ id: "p01", boothId: "no01", isNew: true }),
      product({ id: "p02", boothId: "no01" }),
      product({ id: "p03", boothId: "no03", limited: "数量限定" }),
      product({ id: "p05", boothId: "no05", days: ["sat"] }),
      product({ id: "p06", boothId: "no06", days: ["sun"] }),
      product({ id: "p07", boothId: "no07" }),
    ],
    booths,
    layout,
  );
  const items = [
    { productId: "p02", qty: 1, bought: false },
    { productId: "p01", qty: 1, bought: false },
    { productId: "p03", qty: 1, bought: true },
    { productId: "p05", qty: 1, bought: false },
    { productId: "p06", qty: 1, bought: false },
    { productId: "p07", qty: 1, bought: false },
  ];

  it("ブースごとに1つ。印は新作か限定があるか。座標はブースの中心", () => {
    const r = buildRouteStops(items, catalog, layout, "sat");
    expect(r.stops).toEqual([
      { boothId: "no01", code: "A1", point: { x: 95, y: 5 }, special: true },
      { boothId: "no03", code: "Ca1", point: { x: 95, y: 55 }, special: true },
      { boothId: "no05", code: "Cc6", point: { x: 55, y: 35 }, special: false },
    ]);
  });
  it("その日に売っていない商品と、ブース番号が無い団体は別に返す", () => {
    const r = buildRouteStops(items, catalog, layout, "sat");
    expect(r.notSoldThatDay).toEqual(["p06"]);
    expect(r.unplaced).toEqual(["no07"]);
  });
  it("日曜は入れ替わったブースの団体になる", () => {
    const r = buildRouteStops(items, catalog, layout, "sun");
    expect(r.stops.map((s) => s.boothId)).toEqual(["no01", "no03", "no06"]);
    expect(r.notSoldThatDay).toEqual(["p05"]);
  });
  it("買い終わった商品だけのブースは除く（onlyUnbought）", () => {
    const r = buildRouteStops(items, catalog, layout, "sat", { onlyUnbought: true });
    expect(r.stops.map((s) => s.boothId)).toEqual(["no01", "no05"]);
  });
});
