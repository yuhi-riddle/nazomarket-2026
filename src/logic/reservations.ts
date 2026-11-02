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

export function reservationDeadlineText(reservation: Reservation): string {
  if (reservation.endsAt === null) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(reservation.endsAt);
  if (!match) return "";
  return `${Number(match[2])}/${Number(match[3])} ${match[4]}まで`;
}
