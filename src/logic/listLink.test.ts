import { describe, expect, it } from "vitest";
import { createListShareUrl, encodeListParam, mergeImportedItems, parseListParam } from "./listLink.ts";

const known = new Set(["p23", "p24", "p25", "p33", "no04-2"]);

describe("encodeListParam", () => {
  it("商品IDと個数だけを入れ、1個は省き、買った印は渡さない", () => {
    expect(encodeListParam([
      { productId: "p23", qty: 2, bought: false },
      { productId: "no04-2", qty: 1, bought: true },
    ])).toBe("p23.2_no04-2");
  });
});

describe("parseListParam", () => {
  it("書いたものを読むと同じ商品と個数に戻る", () => {
    expect(parseListParam("p23.2_no04-2", known)).toEqual({
      items: [{ productId: "p23", qty: 2 }, { productId: "no04-2", qty: 1 }],
      skipped: 0,
    });
  });
  it("空や無いときは0件", () => {
    expect(parseListParam(null, known)).toEqual({ items: [], skipped: 0 });
    expect(parseListParam("", known)).toEqual({ items: [], skipped: 0 });
  });
  it("知らない商品と壊れた部分は除いて数える", () => {
    expect(parseListParam("p23_gone.2_<script>_p24.abc", known)).toEqual({
      items: [{ productId: "p23", qty: 1 }],
      skipped: 3,
    });
  });
  it("個数は1〜99に収め、同じ商品は多いほうにまとめる", () => {
    expect(parseListParam("p23.0_p24.500_p25.2_p25.5", known).items).toEqual([
      { productId: "p23", qty: 1 },
      { productId: "p24", qty: 99 },
      { productId: "p25", qty: 5 },
    ]);
  });
  it("極端に長いリンクは先頭の500個までしか読まない", () => {
    const raw = Array.from({ length: 2000 }, () => "gone").join("_");
    expect(parseListParam(raw, known).skipped).toBe(500);
  });
});

describe("mergeImportedItems", () => {
  const current = [
    { productId: "p23", qty: 1, bought: false },
    { productId: "p24", qty: 3, bought: false },
    { productId: "p25", qty: 1, bought: true },
  ];
  it("今のリストを残し、同じ商品は多いほうに合わせ、新しい商品を後ろに足す", () => {
    expect(mergeImportedItems(current, [
      { productId: "p23", qty: 2 },
      { productId: "p24", qty: 1 },
      { productId: "p33", qty: 4 },
    ])).toEqual([
      { productId: "p23", qty: 2, bought: false },
      { productId: "p24", qty: 3, bought: false },
      { productId: "p25", qty: 1, bought: true },
      { productId: "p33", qty: 4, bought: false },
    ]);
  });
  it("買った商品は個数を変えない", () => {
    expect(mergeImportedItems(current, [{ productId: "p25", qty: 5 }])).toEqual(current);
  });
});

describe("createListShareUrl", () => {
  const items = [{ productId: "p23", qty: 2, bought: false }];
  it("共同リストの部屋と鍵をリンクに残さない", () => {
    expect(createListShareUrl("https://example.com/nazo/?room=abc#secret-key", items))
      .toBe("https://example.com/nazo/?list=p23.2");
  });
  it("前に受け取った内容やタブの指定を引き継がない", () => {
    expect(createListShareUrl("https://example.com/nazo/?list=p24#list", items))
      .toBe("https://example.com/nazo/?list=p23.2");
  });
});
