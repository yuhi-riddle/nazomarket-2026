import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.ts";
import { splitUnknownDifficulty } from "./difficultyGroups.ts";
import { booths, layout, product } from "./test-helpers.ts";

describe("splitUnknownDifficulty", () => {
  const catalog = buildCatalog([
    product({ id: "a", boothId: "no01", difficulty: { level: 5, source: "official", basis: "" } }),
    product({ id: "b", boothId: "no01", difficulty: { level: null, source: "unknown", basis: null } }),
    product({ id: "c", boothId: "no01", difficulty: { level: 2, source: "estimated", basis: "" } }),
  ], booths, layout);

  it("難易度が分かるものは並びを保ったまま前に、不明なものは別にまとめる", () => {
    const { known, unknown } = splitUnknownDifficulty(catalog);
    expect(known.map((view) => view.product.id)).toEqual(["a", "c"]);
    expect(unknown.map((view) => view.product.id)).toEqual(["b"]);
  });

  it("不明が無ければ unknown は空", () => {
    expect(splitUnknownDifficulty(catalog.slice(0, 1)).unknown).toEqual([]);
  });
});
