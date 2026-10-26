import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.ts";
import { buildRouteStops } from "./route.ts";
import { booths, layout, product } from "./test-helpers.ts";

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
