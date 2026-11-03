import { describe, expect, it } from "vitest";
import { activeReservations, reservationDeadlineText, reservationLinks } from "./reservations.ts";
import { product } from "./test-helpers.ts";

const open = { label: "取り置き予約", url: "https://forms.gle/a", endsAt: "2026-11-05T23:59" };
const noDeadline = { label: "7日受け取りの予約", url: "https://example.com/b", endsAt: null };

describe("activeReservations", () => {
  it("予約が無い商品は空", () => {
    expect(activeReservations(product({ id: "p01", boothId: "no01" }), new Date("2026-11-03T12:00:00+09:00"))).toEqual([]);
  });
  it("締切前と締切なしは出す", () => {
    const item = product({ id: "p01", boothId: "no01", reservations: [open, noDeadline] });
    expect(activeReservations(item, new Date("2026-11-05T23:58:00+09:00"))).toEqual([open, noDeadline]);
  });
  it("締切を過ぎた予約は出さない", () => {
    const item = product({ id: "p01", boothId: "no01", reservations: [open, noDeadline] });
    expect(activeReservations(item, new Date("2026-11-06T00:00:00+09:00"))).toEqual([noDeadline]);
  });
  it("締切の分のあいだはまだ出す", () => {
    const item = product({ id: "p01", boothId: "no01", reservations: [open] });
    expect(activeReservations(item, new Date("2026-11-05T23:59:30+09:00"))).toEqual([open]);
  });
});

describe("reservationLinks", () => {
  const now = new Date("2026-11-03T12:00:00+09:00");
  const closed = { label: "受付終了の予約", url: "https://forms.gle/z", endsAt: "2026-11-01T23:59" };

  it("同じ予約先が1つなら、まとめて「予約ページを開く」にする", () => {
    const items = [
      product({ id: "p01", boothId: "no01", reservations: [{ ...open, label: "残り5点" }] }),
      product({ id: "p02", boothId: "no01", reservations: [open] }),
    ];
    expect(reservationLinks(items, now)).toEqual([{ label: "予約ページを開く", url: open.url }]);
  });
  it("予約先が分かれるなら、それぞれの名前で出す", () => {
    const items = [product({ id: "p01", boothId: "no01", reservations: [open, noDeadline] })];
    expect(reservationLinks(items, now)).toEqual([
      { label: open.label, url: open.url },
      { label: noDeadline.label, url: noDeadline.url },
    ]);
  });
  it("締切を過ぎた予約は出さず、1つも無ければ空", () => {
    const items = [product({ id: "p01", boothId: "no01", reservations: [closed] }), product({ id: "p02", boothId: "no01" })];
    expect(reservationLinks(items, now)).toEqual([]);
  });
});

describe("reservationDeadlineText", () => {
  it("締切を短く示し、締切なしは空にする", () => {
    expect(reservationDeadlineText(open)).toBe("11/5 23:59まで");
    expect(reservationDeadlineText(noDeadline)).toBe("");
  });
});
