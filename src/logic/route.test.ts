import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.ts";
import { buildRouteStops, planRoute, type RouteStop } from "./route.ts";
import { booths, layout, product } from "./test-helpers.ts";

const stop = (code: string, x: number, y: number, priority: RouteStop["priority"], special = false): RouteStop => ({
  boothId: code,
  code,
  point: { x, y },
  priority,
  special,
});

describe("planRoute", () => {
  const entrance = { x: 100, y: 0 };

  it("優先度の高い順。同じ優先度の中は入口から最近傍法で並べる", () => {
    const stops = [
      stop("far", 0, 0, "must"),
      stop("near", 90, 0, "must"),
      stop("mid", 50, 0, "must"),
      stop("w1", 95, 0, "want"),
    ];
    expect(planRoute(stops, entrance, { frontLoadSpecial: false }).map((s) => s.code)).toEqual(["near", "mid", "far", "w1"]);
  });
  it("次の優先度は、前の優先度の最後のブースから最近傍法で続ける", () => {
    const stops = [stop("m", 0, 0, "must"), stop("w-near-entrance", 99, 0, "want"), stop("w-near-m", 5, 0, "want")];
    expect(planRoute(stops, entrance, { frontLoadSpecial: false }).map((s) => s.code)).toEqual(["m", "w-near-m", "w-near-entrance"]);
  });
  it("新作・限定を前に寄せると、同じ優先度の中で印のあるブースを先に回る", () => {
    const stops = [stop("plain", 90, 0, "must"), stop("special", 10, 0, "must", true), stop("w", 50, 0, "want", true)];
    expect(planRoute(stops, entrance, { frontLoadSpecial: true }).map((s) => s.code)).toEqual(["special", "plain", "w"]);
    expect(planRoute(stops, entrance, { frontLoadSpecial: false }).map((s) => s.code)).toEqual(["plain", "special", "w"]);
  });
  it("距離が同じならブース番号の小さい方（入力順ではなく code の自然順）", () => {
    const stops = [stop("Ca10", 110, 0, "must"), stop("Ca2", 90, 0, "must")];
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
    { productId: "p02", priority: "maybe" as const, qty: 1, bought: false },
    { productId: "p01", priority: "want" as const, qty: 1, bought: false },
    { productId: "p03", priority: "must" as const, qty: 1, bought: true },
    { productId: "p05", priority: "must" as const, qty: 1, bought: false },
    { productId: "p06", priority: "must" as const, qty: 1, bought: false },
    { productId: "p07", priority: "want" as const, qty: 1, bought: false },
  ];

  it("ブースごとに1つ。優先度はそのブースの商品の一番高いもの、印は新作か限定があるか。座標はブースの中心", () => {
    const r = buildRouteStops(items, catalog, layout, "sat");
    expect(r.stops).toEqual([
      { boothId: "no01", code: "A1", point: { x: 95, y: 5 }, priority: "want", special: true },
      { boothId: "no03", code: "Ca1", point: { x: 95, y: 55 }, priority: "must", special: true },
      { boothId: "no05", code: "Cc6", point: { x: 55, y: 35 }, priority: "must", special: false },
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
