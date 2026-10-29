import { describe, expect, it } from "vitest";
import { unconfirmedText } from "./unconfirmedText.ts";

describe("unconfirmedText", () => {
  it("build-data が付ける項目名をすべて日本語で出す", () => {
    expect(unconfirmedText(["price", "difficulty", "playMinutes", "players", "isNew", "imageUrl", "payment"]))
      .toBe("未確認: 価格・難易度・所要時間・人数・新作かどうか・画像・支払い");
  });

  it("知らない項目名は英語のまま出さない", () => {
    expect(unconfirmedText(["payment", "somethingNew"])).toBe("未確認: 支払い");
  });

  it("出す項目が無ければ空文字", () => {
    expect(unconfirmedText([])).toBe("");
    expect(unconfirmedText(["somethingNew"])).toBe("");
  });
});
