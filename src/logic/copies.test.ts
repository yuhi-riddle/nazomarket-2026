import { describe, expect, it } from "vitest";
import { copiesLabel } from "./copies.ts";

describe("copiesLabel（販売数の短い表示）", () => {
  it("先頭に書かれた部数・個数を「限定N部」にまとめる", () => {
    expect(copiesLabel("限定300部")).toBe("限定300部");
    expect(copiesLabel("150部")).toBe("限定150部");
    expect(copiesLabel("限定60部（取り置きは終了。当日在庫のみ）")).toBe("限定60部");
    expect(copiesLabel("限定300個（取り置きは締切。当日分は土曜80部、日曜20部ほど。再販は未定）")).toBe("限定300個");
    expect(copiesLabel("限定1,000部")).toBe("限定1,000部");
  });
  it("「合計Nセット」も拾う", () => {
    expect(copiesLabel("ナゾトキマーケット限定、2日間合計10セット")).toBe("限定10セット");
  });
  it("目安や内訳だけの書き方は出さない", () => {
    expect(copiesLabel("100個以上を用意")).toBeNull();
    expect(copiesLabel("ナゾマ現地引換の先行予約チケット(7日・8日 各50個)、オンライン先行100個")).toBeNull();
    expect(copiesLabel("ナゾマ限定価格")).toBeNull();
    expect(copiesLabel(null)).toBeNull();
    expect(copiesLabel("")).toBeNull();
  });
});
