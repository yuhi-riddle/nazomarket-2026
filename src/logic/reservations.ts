import type { Product, Reservation } from "../types.ts";

function reservationEndTime(reservation: Reservation): number | null {
  if (reservation.endsAt === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/.exec(reservation.endsAt);
  if (!match) return Number.NaN;
  return Date.parse(`${match[1]}:59.999+09:00`);
}

export function activeReservations(product: Product, now: Date): Reservation[] {
  const nowTime = now.getTime();
  return (product.reservations ?? []).filter((reservation) => {
    const endTime = reservationEndTime(reservation);
    return endTime === null || endTime >= nowTime;
  });
}

// 複数の商品が同じフォームを指すことが多いので、予約先ごとに1本にまとめる
export function reservationLinks(items: Product[], now: Date): { label: string; url: string }[] {
  const byUrl = new Map<string, string>();
  for (const item of items) {
    for (const reservation of activeReservations(item, now)) {
      if (!byUrl.has(reservation.url)) byUrl.set(reservation.url, reservation.label);
    }
  }
  const links = [...byUrl].map(([url, label]) => ({ label, url }));
  return links.length === 1 ? [{ label: "予約ページを開く", url: links[0].url }] : links;
}

export function reservationDeadlineText(reservation: Reservation): string {
  if (reservation.endsAt === null) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(reservation.endsAt);
  if (!match) return "";
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}まで`;
}
