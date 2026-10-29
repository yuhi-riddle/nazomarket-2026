import { describe, expect, it } from "vitest";
import { venueMapLabelText } from "./venueMap.ts";

describe("venueMapLabelText", () => {
  it("省略で1文字しか残らない幅ではブース番号を出す", () => {
    expect(venueMapLabelText("SCRAP", "A3", 2)).toEqual({ text: "A3", isCode: true });
  });

  it("2文字をそのまま表示できる幅では団体名を残す", () => {
    expect(venueMapLabelText("九州", "A3", 2)).toEqual({ text: "九州", isCode: false });
  });

  it("2文字以上を残せる幅では団体名を省略して出す", () => {
    expect(venueMapLabelText("SCRAP", "A3", 3)).toEqual({ text: "SC…", isCode: false });
  });

  it("幅に収まる団体名は省略しない", () => {
    expect(venueMapLabelText("SCRAP", "A3", 5)).toEqual({ text: "SCRAP", isCode: false });
  });

  it("名前がない場合や1文字分しか入らない場合はブース番号を出す", () => {
    expect(venueMapLabelText(null, "A3", 5)).toEqual({ text: "A3", isCode: true });
    expect(venueMapLabelText("SCRAP", "A3", 1)).toEqual({ text: "A3", isCode: true });
  });
});
