import { describe, expect, it } from "vitest";
import { activeReservations, reservationDeadlineText } from "./reservations.ts";
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

describe("reservationDeadlineText", () => {
  it("締切を短く示し、締切なしは空にする", () => {
    expect(reservationDeadlineText(open)).toBe("11/5 23:59まで");
    expect(reservationDeadlineText(noDeadline)).toBe("");
  });
});
