// ロジックのテスト用の小さなデータ。本番コードからは import しない
import type { Booth, Product, VenueLayout } from "../types.ts";

export function product(over: Partial<Product> & { id: string; boothId: string }): Product {
  return {
    name: `商品${over.id}`,
    price: 1000,
    priceNote: null,
    category: "kit",
    oneLiner: "一言",
    description: "説明",
    difficulty: { level: 3, source: "official", basis: "テスト" },
    playMinutes: 60,
    players: null,
    isNew: null,
    limited: null,
    days: ["sat", "sun"],
    imageUrl: null,
    payment: null,
    sources: [{ url: "https://example.com/", retrievedAt: "2026-10-25" }],
    unconfirmed: [],
    hashtags: [],
    ...over,
  };
}

export function booth(over: Partial<Booth> & { id: string }): Booth {
  return {
    name: `団体${over.id}`,
    boothCode: null,
    days: ["sat", "sun"],
    summary: "",
    links: { site: [], x: [], instagram: [] },
    logoUrl: "",
    checkedSources: ["official"],
    sources: [{ url: "https://example.com/", retrievedAt: "2026-10-25" }],
    hashtags: [],
    ...over,
  };
}

// 入口 (100, 0)。A1 が入口のすぐ隣、Ca1 が少し遠く、Ca2 がさらに遠い
export const layout: VenueLayout = {
  source: { url: "", retrievedAt: "2026-10-25", note: "" },
  image: { width: 200, height: 100 },
  viewBox: { x: 0, y: 0, w: 200, h: 100 },
  walkway: [],
  entrance: { x: 100, y: 0, label: "入口" },
  exit: { x: 0, y: 0, label: "出口" },
  areas: [
    { id: "A", label: "A" },
    { id: "Ca", label: "Ca" },
    { id: "Cc", label: "Cc" },
  ],
  booths: [
    { code: "A1", area: "A", x: 90, y: 0, w: 10, h: 10, labels: { sat: "団体no01", sun: "団体no01" } },
    { code: "A2", area: "A", x: 70, y: 0, w: 10, h: 10, labels: { sat: "団体no02", sun: "団体no02" } },
    { code: "Ca1", area: "Ca", x: 90, y: 50, w: 10, h: 10, labels: { sat: "団体no03", sun: "団体no03" } },
    { code: "Ca2", area: "Ca", x: 10, y: 50, w: 10, h: 10, labels: { sat: "団体no04", sun: "団体no04" } },
    { code: "Cc6", area: "Cc", x: 50, y: 30, w: 10, h: 10, labels: { sat: "団体no05", sun: "団体no06" } },
  ],
  landmarks: [],
};

export const booths: Booth[] = [
  booth({ id: "no01", name: "ナゾトキ商店", boothCode: "A1" }),
  booth({ id: "no02", name: "XEOXY", boothCode: "A2" }),
  booth({ id: "no03", name: "謎屋", boothCode: "Ca1" }),
  booth({ id: "no04", name: "遠い団体", boothCode: "Ca2" }),
  booth({ id: "no05", name: "土曜だけ", boothCode: "Cc6", days: ["sat"] }),
  booth({ id: "no06", name: "日曜だけ", boothCode: "Cc6", days: ["sun"] }),
  booth({ id: "no07", name: "場所未定", boothCode: null }),
];
