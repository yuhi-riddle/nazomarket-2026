import { describe, expect, it } from "vitest";
import { mapSelectionSummary } from "./mapSelectionSummary.ts";

describe("mapSelectionSummary", () => {
  it("団体名とリスト件数・未購入件数を短くまとめる", () => {
    expect(mapSelectionSummary("Bb9", "ナゾトキキセベと歩こう", [
      { bought: false },
      { bought: true },
    ])).toBe("Bb9 ナゾトキキセベ… ・リスト2件（未購入1件）");
  });

  it("短い団体名は省略せず、商品がなければ0件と表示する", () => {
    expect(mapSelectionSummary("A3", "SCRAP", [])).toBe("A3 SCRAP ・リスト0件（未購入0件）");
  });
});
