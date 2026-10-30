import { describe, expect, it } from "vitest";
import { productImage } from "./remoteImage.ts";

const source = (url: string) => ({ url, retrievedAt: "2026-10-30" });

describe("productImage", () => {
  it("画像が無ければ null", () => {
    expect(productImage({ id: "no10-1", imageUrl: null, sources: [] })).toBeNull();
  });

  it("X 以外の画像は元の URL をそのまま使い、出典は出さない", () => {
    expect(productImage({
      id: "p01",
      imageUrl: "https://www.scrapmagazine.com/s/nazomarket/img/booth/no01/product/p01_photo1.png",
      sources: [source("https://www.scrapmagazine.com/s/nazomarket/")],
    })).toEqual({
      src: "https://www.scrapmagazine.com/s/nazomarket/img/booth/no01/product/p01_photo1.png",
      credit: null,
    });
  });

  it("X の画像は公開ページ内の保存先を使い、X の投稿を出典にする", () => {
    expect(productImage({
      id: "no55-1",
      imageUrl: "https://pbs.twimg.com/media/HVyURoibUAAV3oN?format=jpg&name=small",
      sources: [
        source("https://paddle.example.com/"),
        source("https://x.com/paddle_pj/status/2115731112836349974"),
      ],
    })).toEqual({
      src: "remote-images/no55-1.jpg",
      credit: { account: "paddle_pj", url: "https://x.com/paddle_pj/status/2115731112836349974" },
    });
  });

  it("twitter.com の投稿も出典として扱う", () => {
    expect(productImage({
      id: "no20-3",
      imageUrl: "https://pbs.twimg.com/media/ABC?format=jpg&name=small",
      sources: [source("https://twitter.com/some_team/status/123")],
    })?.credit).toEqual({ account: "some_team", url: "https://twitter.com/some_team/status/123" });
  });

  it("X の投稿が出典に無ければ、出典は null（画像は保存先を使う）", () => {
    expect(productImage({
      id: "no20-3",
      imageUrl: "https://pbs.twimg.com/media/ABC?format=jpg&name=small",
      sources: [source("https://x.com/some_team"), source("https://example.com/")],
    })).toEqual({ src: "remote-images/no20-3.jpg", credit: null });
  });
});
