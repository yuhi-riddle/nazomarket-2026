import type { SharedListState } from "../../shared-worker/src/domain.ts";

export type MemberSummaryRow = {
  memberId: string;
  name: string;
  total: number;
  budget: number | null;
  remaining: number | null;
  over: number;
};

export type MemberSummary = {
  members: MemberSummaryRow[];
  unassignedCount: number;
  unassignedTotal: number;
  total: number;
};

export function summarizeMembers(
  state: SharedListState,
  priceOf: (productId: string) => number | null,
): MemberSummary {
  const totalByMember = new Map<string, number>(state.members.map((member): [string, number] => [member.id, 0]));
  let unassignedCount = 0;
  let unassignedTotal = 0;

  for (const item of state.items) {
    const price = item.productId === null ? item.priceYen : priceOf(item.productId);
    const amount = price === null ? 0 : price * item.quantity;
    if (item.ownerId !== null && totalByMember.has(item.ownerId)) {
      totalByMember.set(item.ownerId, totalByMember.get(item.ownerId)! + amount);
    } else {
      unassignedCount += 1;
      unassignedTotal += amount;
    }
  }

  const members = state.members.map((member): MemberSummaryRow => {
    const total = totalByMember.get(member.id) ?? 0;
    const remaining = member.budgetYen === null ? null : member.budgetYen - total;
    return {
      memberId: member.id,
      name: member.name,
      total,
      budget: member.budgetYen,
      remaining,
      over: remaining !== null && remaining < 0 ? -remaining : 0,
    };
  });
  const total = unassignedTotal + members.reduce((sum, member) => sum + member.total, 0);
  return { members, unassignedCount, unassignedTotal, total };
}
