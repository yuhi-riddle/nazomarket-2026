import { describe, expect, it } from "vitest";
import { boothPayment } from "./boothPayment.ts";

describe("boothPayment", () => {
  it("全商品が同じ支払い方法ならそのまま並べる", () => {
    expect(boothPayment([["現金", "PayPay"], ["現金", "PayPay"]])).toEqual({
      text: "支払い: 現金・PayPay",
      cashOnly: false,
      unknown: false,
    });
  });

  it("現金だけのブースは cashOnly にする", () => {
    expect(boothPayment([["現金のみ"], ["現金"]])).toEqual({
      text: "支払い: 現金のみ",
      cashOnly: true,
      unknown: false,
    });
  });

  it("どの商品も分からなければ未確認", () => {
    expect(boothPayment([null, []])).toEqual({ text: "支払い: 未確認", cashOnly: false, unknown: true });
  });

  it("一部の商品だけ分かるときは注記を付け、cashOnly にはしない", () => {
    expect(boothPayment([["現金のみ"], null])).toEqual({
      text: "支払い: 現金のみ（一部未確認）",
      cashOnly: false,
      unknown: false,
    });
  });

  it("商品で違うときは出てくる方法をまとめて注記する", () => {
    expect(boothPayment([["現金"], ["現金", "クレジットカード"]])).toEqual({
      text: "支払い: 現金・クレジットカード（商品により異なる）",
      cashOnly: false,
      unknown: false,
    });
  });
});
