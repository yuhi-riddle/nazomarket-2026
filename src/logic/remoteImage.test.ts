import { describe, expect, it } from "vitest";
import { productImage } from "./remoteImage.ts";

describe("productImage", () => {
  it("画像が無ければ null", () => {
    expect(productImage({ id: "no10-1", imageUrl: null })).toBeNull();
  });

  it("X 以外の画像は元の URL をそのまま使う", () => {
    expect(productImage({
      id: "p01",
      imageUrl: "https://www.scrapmagazine.com/s/nazomarket/img/booth/no01/product/p01_photo1.png",
    })).toBe("https://www.scrapmagazine.com/s/nazomarket/img/booth/no01/product/p01_photo1.png");
  });

  it("X の画像は公開ページ内の保存先を使う", () => {
    expect(productImage({
      id: "no55-1",
      imageUrl: "https://pbs.twimg.com/media/HVyURoibUAAV3oN?format=jpg&name=small",
    })).toBe("remote-images/no55-1.jpg");
  });
});
