import { describe, expect, it } from "vitest";
import { emptyFilters } from "./catalog.ts";
import { pendingBooths } from "./pendingBooths.ts";
import { booths, product } from "./test-helpers.ts";

// no01 だけ商品がある。場所未定の no07 は末尾に並ぶ
const products = [product({ id: "p1", boothId: "no01" })];
const ids = (list: { id: string }[]) => list.map((booth) => booth.id);

describe("pendingBooths", () => {
  it("商品のない団体をブース番号順に返し、番号未定は最後にする", () => {
    const list = pendingBooths(booths, products, emptyFilters, "booth");
    expect(ids(list)).toEqual(["no02", "no03", "no04", "no05", "no06", "no07"]);
  });

  it("おすすめ順は検索していなければ出さない", () => {
    expect(pendingBooths(booths, products, emptyFilters, "recommended")).toEqual([]);
  });

  it("団体名で検索すると、おすすめ順でも出す", () => {
    const list = pendingBooths(booths, products, { ...emptyFilters, q: "ｘｅｏｘｙ" }, "recommended");
    expect(ids(list)).toEqual(["no02"]);
  });

  it("ブース番号でも検索できる", () => {
    expect(ids(pendingBooths(booths, products, { ...emptyFilters, q: "ca2" }, "booth"))).toEqual(["no04"]);
  });

  it("商品のある団体は検索しても出さない", () => {
    expect(pendingBooths(booths, products, { ...emptyFilters, q: "ナゾトキ商店" }, "booth")).toEqual([]);
  });

  it("日で絞ると、その日に出展する団体だけにする", () => {
    const list = pendingBooths(booths, products, { ...emptyFilters, day: "sat" }, "booth");
    expect(ids(list)).toContain("no05");
    expect(ids(list)).not.toContain("no06");
  });

  it("団体で絞ると、その団体だけにする", () => {
    expect(ids(pendingBooths(booths, products, { ...emptyFilters, boothId: "no03" }, "booth"))).toEqual(["no03"]);
    expect(pendingBooths(booths, products, { ...emptyFilters, boothId: "no01" }, "booth")).toEqual([]);
  });

  it("商品の条件で絞っている間は出さない", () => {
    expect(pendingBooths(booths, products, { ...emptyFilters, categories: ["kit"] }, "booth")).toEqual([]);
    expect(pendingBooths(booths, products, { ...emptyFilters, priceMax: 1000 }, "booth")).toEqual([]);
    expect(pendingBooths(booths, products, { ...emptyFilters, tags: ["新作"] }, "booth")).toEqual([]);
  });
});
