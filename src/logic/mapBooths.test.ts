import { describe, expect, it } from "vitest";
import { buildCatalog } from "./catalog.ts";
import { boothListStatus, listedItemsForBooth, unboughtItemsByBooth } from "./mapBooths.ts";
import { booth, booths, layout, product } from "./test-helpers.ts";

describe("unboughtItemsByBooth", () => {
  const catalog = buildCatalog([
    product({ id: "a", boothId: "no01" }),
    product({ id: "b", boothId: "no01" }),
    product({ id: "sat", boothId: "no05" }),
    product({ id: "sun", boothId: "no06" }),
    product({ id: "sat-only", boothId: "no01", days: ["sat"] }),
    product({ id: "unplaced", boothId: "no07" }),
    product({ id: "absent", boothId: "absent" }),
  ], [...booths, booth({ id: "absent", boothCode: "A2" })], {
    ...layout,
    booths: layout.booths.map((entry) => entry.code === "A2"
      ? { ...entry, labels: { ...entry.labels, sat: null } }
      : entry),
  });
  const map = { ...layout, booths: layout.booths.map((entry) => entry.code === "A2"
    ? { ...entry, labels: { ...entry.labels, sat: null } }
    : entry) };
  const item = (productId: string, bought = false) => ({ productId, qty: 1, bought });

  it("選択ブースの商品からリストに入っているものだけを返す", () => {
    const boothViews = catalog.filter((view) => view.booth.id === "no01");
    expect(listedItemsForBooth(boothViews, [item("b"), item("sat")])).toEqual([item("b")]);
  });

  it("未購入が残る間は色付けし、全て購入すると消え、チェックを外すと戻る", () => {
    expect(unboughtItemsByBooth([item("a", true), item("b")], catalog, map, "sat").get("A1")).toEqual([item("b")]);
    expect(unboughtItemsByBooth([item("a", true), item("b", true)], catalog, map, "sat").has("A1")).toBe(false);
    expect(unboughtItemsByBooth([item("a"), item("b", true)], catalog, map, "sat").get("A1")).toEqual([item("a")]);
  });

  it("日替わりブースは選択日の出展者と販売商品のみ判定する", () => {
    const items = [item("sat"), item("sun", true), item("sat-only"), item("absent"), item("unplaced"), item("missing")];
    const saturday = unboughtItemsByBooth(items, catalog, map, "sat");
    const sunday = unboughtItemsByBooth(items, catalog, map, "sun");
    expect([...saturday.keys()].sort()).toEqual(["A1", "Cc6"]);
    expect(saturday.get("Cc6")).toEqual([item("sat")]);
    expect([...sunday.keys()]).toEqual(["A2"]);
    expect(unboughtItemsByBooth([item("sat"), item("sun")], catalog, map, "sun").get("Cc6")).toEqual([item("sun")]);
  });

  describe("boothListStatus", () => {
    it("未購入が残るブースは todo で、未購入の点数を数量込みで数える", () => {
      const status = boothListStatus([{ productId: "a", qty: 2, bought: false }, item("b", true)], catalog, map, "sat");
      expect(status.get("A1")).toEqual({ status: "todo", unboughtQty: 2 });
    });

    it("リストのアイテムを全部買えたブースは clear", () => {
      const status = boothListStatus([item("a", true), item("b", true)], catalog, map, "sat");
      expect(status.get("A1")).toEqual({ status: "clear", unboughtQty: 0 });
    });

    it("リストに無いブースと、その日に売っていないアイテムだけのブースは状態なし", () => {
      const status = boothListStatus([item("a"), item("sun")], catalog, map, "sat");
      expect([...status.keys()]).toEqual(["A1"]);
      expect(boothListStatus([item("sat-only", true)], catalog, map, "sun").size).toBe(0);
    });
  });
});
