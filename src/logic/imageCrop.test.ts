import { describe, expect, it } from "vitest";
import crops from "../../data/imageCrops.json";
import products from "../../data/products.json";
import { imageCropFor, imageCropLayout, type ImageCrop } from "./imageCrop.ts";

const crop: ImageCrop = { imageUrl: "https://example.com/a.png", left: 0.25, right: 0.25, top: 0, bottom: 0.2, width: 800, height: 500 };

describe("imageCropFor", () => {
  it("測ったときと同じ画像なら余白の値を返す", () => {
    expect(imageCropFor({ id: "a", imageUrl: crop.imageUrl }, { a: crop })).toEqual(crop);
  });

  it("画像が差し替わっていれば古い値を使わない", () => {
    expect(imageCropFor({ id: "a", imageUrl: "https://example.com/b.png" }, { a: crop })).toBeNull();
  });

  it("測っていない商品や画像のない商品は null", () => {
    expect(imageCropFor({ id: "b", imageUrl: crop.imageUrl }, { a: crop })).toBeNull();
    expect(imageCropFor({ id: "a", imageUrl: null }, { a: crop })).toBeNull();
  });
});

describe("imageCropLayout", () => {
  it("残す範囲が枠にぴったり収まる大きさと位置を返す", () => {
    expect(imageCropLayout(crop)).toEqual({
      aspectRatio: 1, // (800×0.5) / (500×0.8)
      widthPercent: 200,
      heightPercent: 125,
      leftPercent: -50,
      topPercent: 0,
    });
  });
});

describe("data/imageCrops.json", () => {
  it("すべて今の商品画像を測った値で、残す範囲が空にならない", () => {
    const byId = new Map(products.map((product) => [product.id, product]));
    for (const [id, entry] of Object.entries(crops as Record<string, ImageCrop>)) {
      expect(byId.get(id)?.imageUrl, id).toBe(entry.imageUrl);
      expect(entry.left + entry.right, id).toBeLessThan(1);
      expect(entry.top + entry.bottom, id).toBeLessThan(1);
    }
  });
});
