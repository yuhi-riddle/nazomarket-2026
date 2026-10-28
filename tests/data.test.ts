// 生成済みデータ（data/*.json）の検証。npm run build-data のあとに通ること
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Booth, Day, Product, VenueLayout } from "../src/types.ts";

const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(`../data/${path}`, import.meta.url), "utf8")) as T;

const booths = read<Booth[]>("booths.json");
const products = read<Product[]>("products.json");
const layout = read<VenueLayout>("venue-layout.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe("booths.json", () => {
  it("97団体ある", () => {
    expect(booths).toHaveLength(97);
  });
  it("id が重複しない", () => {
    expect(new Set(booths.map((b) => b.id)).size).toBe(booths.length);
  });
  it("出展日・出典があり、必須の文字列が空でない", () => {
    for (const b of booths) {
      expect(b.days.length, b.id).toBeGreaterThan(0);
      expect(b.sources.length, b.id).toBeGreaterThan(0);
      expect(b.name.trim(), b.id).not.toBe("");
      expect(b.checkedSources, b.id).toContain("official");
    }
  });
  it("boothCode はマップにある番号で、同じ日に2団体が同じブースにならない", () => {
    const codes = new Set(layout.booths.map((b) => b.code));
    for (const day of ["sat", "sun"] as Day[]) {
      const used = booths.filter((b) => b.boothCode && b.days.includes(day)).map((b) => b.boothCode!);
      expect(new Set(used).size, day).toBe(used.length);
      for (const c of used) expect(codes.has(c), c).toBe(true);
    }
  });
});

describe("products.json", () => {
  const boothIds = new Set(booths.map((b) => b.id));

  it("id が重複しない", () => {
    expect(new Set(products.map((p) => p.id)).size).toBe(products.length);
  });
  it("全商品の boothId が booths にある", () => {
    for (const p of products) expect(boothIds.has(p.boothId), p.id).toBe(true);
  });
  it("価格は0以上の整数か null", () => {
    for (const p of products) {
      if (p.price !== null) {
        expect(Number.isInteger(p.price), p.id).toBe(true);
        expect(p.price, p.id).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it("所要時間は0以上の分数で、上限は下限以上または未確認", () => {
    for (const p of products) {
      if (p.playMinutes === null) continue;
      expect(Number.isInteger(p.playMinutes.min), p.id).toBe(true);
      expect(p.playMinutes.min, p.id).toBeGreaterThanOrEqual(0);
      if (p.playMinutes.max !== null) {
        expect(Number.isInteger(p.playMinutes.max), p.id).toBe(true);
        expect(p.playMinutes.max, p.id).toBeGreaterThanOrEqual(p.playMinutes.min);
      }
    }
  });
  it("出典が1件以上あり、URL と取得日の形が正しい", () => {
    for (const p of products) {
      expect(p.sources.length, p.id).toBeGreaterThan(0);
      for (const s of p.sources) {
        expect(s.url, p.id).toMatch(/^https?:\/\//);
        expect(s.retrievedAt, p.id).toMatch(DATE_RE);
      }
    }
  });
  it("必須項目に空文字がなく、一言は40字以内", () => {
    for (const p of products) {
      for (const key of ["id", "boothId", "name", "oneLiner", "description"] as const) {
        expect(p[key].trim(), `${p.id}.${key}`).not.toBe("");
      }
      expect([...p.oneLiner].length, p.id).toBeLessThanOrEqual(40);
    }
  });
  it("難易度の level と source・basis が食い違わない", () => {
    for (const p of products) {
      const d = p.difficulty;
      if (d.source === "unknown") expect(d.level, p.id).toBeNull();
      else {
        expect([1, 2, 3, 4, 5], p.id).toContain(d.level);
        expect(d.basis?.trim(), p.id).toBeTruthy();
      }
    }
  });
  it("売る日は団体の出展日の中にある", () => {
    const daysOf = new Map(booths.map((b) => [b.id, b.days]));
    for (const p of products) {
      expect(p.days.length, p.id).toBeGreaterThan(0);
      for (const d of p.days) expect(daysOf.get(p.boothId), p.id).toContain(d);
    }
  });
  it("画像 URL は https で、X の画像は形式を指定している（指定がないと 404）", () => {
    for (const p of products) {
      if (p.imageUrl === null) continue;
      expect(p.imageUrl, p.id).toMatch(/^https:\/\//);
      if (p.imageUrl.includes("pbs.twimg.com/media/")) expect(p.imageUrl, p.id).toMatch(/\?format=(jpg|png)&name=\w+$/);
    }
  });
  it("unconfirmed は null の項目と一致する", () => {
    for (const p of products) {
      const expected = [
        p.price === null && "price",
        p.difficulty.level === null && "difficulty",
        p.playMinutes === null && "playMinutes",
        p.players === null && "players",
        p.isNew === null && "isNew",
        p.imageUrl === null && "imageUrl",
        p.payment === null && "payment",
      ].filter(Boolean);
      expect(p.unconfirmed, p.id).toEqual(expected);
    }
  });
});
