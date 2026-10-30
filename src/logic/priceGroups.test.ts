import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.ts";
import { splitUnknownPrice } from "./priceGroups.ts";
import { booths, layout, product } from "./test-helpers.ts";

describe("splitUnknownPrice", () => {
  const catalog = buildCatalog([
    product({ id: "a", boothId: "no01", price: 3000 }),
    product({ id: "b", boothId: "no01", price: null }),
    product({ id: "c", boothId: "no01", price: 500 }),
  ], booths, layout);

  it("価格が分かるものは並びを保ったまま前に、価格不明は別にまとめる", () => {
    const { known, unknown } = splitUnknownPrice(catalog);
    expect(known.map((view) => view.product.id)).toEqual(["a", "c"]);
    expect(unknown.map((view) => view.product.id)).toEqual(["b"]);
  });
});
