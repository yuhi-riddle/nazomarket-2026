import { describe, expect, it } from "vitest";
import { limitedPrice } from "./limitedPrice.ts";

describe("limitedPrice", () => {
  it("限定価格の補足から、見出しと通常価格を取り出す", () => {
    expect(limitedPrice(3000, "ナゾマスペシャルプライス（通常3,300円）")).toEqual({ label: "限定価格", regularPrice: 3300 });
    expect(limitedPrice(2000, "ナゾマ限定価格（通常2,200円）")).toEqual({ label: "限定価格", regularPrice: 2200 });
    expect(limitedPrice(3000, "会場限定価格(通常3,200円→3,000円)")).toEqual({ label: "限定価格", regularPrice: 3200 });
    expect(limitedPrice(1500, "ナゾマ特別価格1,500円（通常価格2,000円）")).toEqual({ label: "限定価格", regularPrice: 2000 });
    expect(limitedPrice(4900, "ナゾマ限定価格（定価5,200円）")).toEqual({ label: "限定価格", regularPrice: 5200 });
    expect(limitedPrice(1400, "ナゾトキマーケット会場価格（通常1,600円）")).toEqual({ label: "限定価格", regularPrice: 1600 });
    expect(limitedPrice(2700, "ナゾマのイベント価格2,700円(税込)。希望小売価格は2,750円(税込)。")).toEqual({ label: "限定価格", regularPrice: 2750 });
  });

  it("先行販売の価格は先行価格と出す", () => {
    expect(limitedPrice(1200, "ナゾトキマーケット先行販売価格（一般販売1,500円）")).toEqual({ label: "先行価格", regularPrice: 1500 });
    expect(limitedPrice(3000, "先行特別価格（通常3,500円）")).toEqual({ label: "先行価格", regularPrice: 3500 });
    expect(limitedPrice(1000, "先行販売限定価格。オンラインショップでの販売は後日開始予定（価格・日付未定）")).toEqual({ label: "先行価格", regularPrice: null });
  });

  it("通常価格が書かれていなくても限定だと分かれば出す", () => {
    expect(limitedPrice(1000, "会場限定価格（祝井ゆん本人の10/26の投稿）")).toEqual({ label: "限定価格", regularPrice: null });
    expect(limitedPrice(1000, "ナゾトキマーケットでは特別割引価格（通常価格は告知になし）")).toEqual({ label: "限定価格", regularPrice: null });
  });

  it("投稿に限定価格とあれば、別に書かれた通常価格も拾う", () => {
    expect(limitedPrice(1500, "投稿画像の表示価格。投稿に「会場限定価格で販売します」とある。通常価格は1,980円(候補メモの値)")).toEqual({ label: "限定価格", regularPrice: 1980 });
  });

  it("通常価格が今の価格以下なら通常価格は出さない", () => {
    expect(limitedPrice(2000, "ナゾマ限定価格（通常2,000円）")).toEqual({ label: "限定価格", regularPrice: null });
    expect(limitedPrice(null, "ナゾマ限定価格（通常2,000円）")).toEqual({ label: "限定価格", regularPrice: null });
  });

  it("この会場の限定価格ではない補足には出さない", () => {
    for (const note of [
      null,
      "M3先行販売価格は1,500円、一般販売価格2,000円",
      "XEOXY ONLINE SHOPの表記価格。会場価格は未確認",
      "イベント公式サイトのキット価格(税込)。ナゾトキマーケット会場での販売価格は未確認",
      "会場価格は夕立工房のお品書き(10/31)の単品価格。好きな3点で3,000円、5点まとめ買いで4,500円",
      "通常版3,400円。公式サイト限定の特装版は4,620円（会場での取り扱いは未確認）",
      "定価(税込)",
      "告知に価格の記載なし",
      "2作同時購入で通常3,300円から300円引き",
      "単品合計25,200円から2,000円引き",
      "ナゾマ会場価格は通常と同じ1,000円",
      "ナゾトキマーケットのイベント価格",
    ]) {
      expect(limitedPrice(1000, note), String(note)).toBeNull();
    }
  });
});
