import { cartTotals, type CartItem } from "../logic/cart.ts";
import { button, el } from "./dom.ts";
import { productById } from "../data.ts";
import type { SharedStoreState } from "../store.ts";

export type BudgetMeter = {
  element: HTMLButtonElement;
  update: (items: CartItem[], budget: number | null, visible: boolean, shared?: SharedStoreState | null) => void;
};

export function budgetMeter(onOpenCart: () => void): BudgetMeter {
  const meter = button("", "budget-meter");
  meter.setAttribute("aria-live", "polite");
  meter.setAttribute("aria-atomic", "true");
  meter.addEventListener("click", onOpenCart);

  const bar = el("span", "meter-bar");
  bar.setAttribute("aria-hidden", "true");
  const total = el("span", "meter-segment meter-must");
  const marker = el("span", "meter-budget-marker");
  bar.append(total, marker);

  const summary = el("span", "meter-summary");
  const listType = el("span", "meter-list-type", "個人");
  const copy = el("span", "meter-copy");
  const totalLabel = el("span", "meter-total-label", "合計");
  copy.append(totalLabel);
  const totalValue = el("strong", "meter-total-value");
  copy.append(totalValue);
  const overage = el("span", "meter-overage");
  overage.hidden = true;
  copy.append(overage);

  const separator = el("span", "meter-separator", "／");
  separator.setAttribute("aria-hidden", "true");
  const budget = el("span", "meter-budget");
  const budgetLabel = el("span", "meter-budget-label", "予算");
  budget.append(budgetLabel);
  const budgetValue = el("strong", "meter-budget-value");
  budget.append(budgetValue);
  summary.append(listType, copy, separator, budget);
  meter.append(summary, bar);

  let previousItems: CartItem[] | undefined;
  let previousBudget: number | null | undefined;
  let previousSharedKey: string | null | undefined;

  return {
    element: meter,
    update(items, budgetAmount, visible, shared = null) {
      meter.hidden = !visible;
      listType.textContent = shared === null ? "個人" : "共同";
      const sharedKey = shared === null ? null : JSON.stringify([
        shared.meId,
        shared.members.map((member) => [member.id, member.budgetYen]),
        [...shared.ownerByProductId],
      ]);
      if (previousItems === items && previousBudget === budgetAmount && previousSharedKey === sharedKey) return;
      previousItems = items;
      previousBudget = budgetAmount;
      previousSharedKey = sharedKey;
      const member = shared?.meId === null || shared === null
        ? undefined
        : shared.members.find((candidate) => candidate.id === shared.meId);
      const sharedWithoutMe = shared !== null && member === undefined;
      const meterItems = sharedWithoutMe
        ? items
        : shared === null
          ? items
          : items.filter((item) => shared.ownerByProductId.get(item.productId) === member?.id);
      const effectiveBudget = shared === null ? budgetAmount : member?.budgetYen ?? null;
      const totals = cartTotals(meterItems, (id) => productById.get(id)?.price ?? null);
      const denominator = Math.max(totals.amount, effectiveBudget ?? 0, 1);
      total.style.width = (effectiveBudget === null ? 0 : totals.amount / denominator * 100) + "%";
      marker.hidden = effectiveBudget === null || sharedWithoutMe;
      marker.style.left = (effectiveBudget === null ? 0 : Math.min(100, effectiveBudget / denominator * 100)) + "%";

      const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";
      const overageAmount = effectiveBudget === null ? 0 : totals.amount - effectiveBudget;
      const over = effectiveBudget !== null && overageAmount > 0;
      totalLabel.textContent = sharedWithoutMe ? "全体の合計" : shared === null ? "合計" : "自分の合計";
      budgetLabel.textContent = shared === null ? "予算" : "自分の予算";
      totalValue.textContent = format(totals.amount);
      budgetValue.textContent = effectiveBudget === null ? "未設定" : format(effectiveBudget);
      overage.hidden = !over;
      overage.textContent = over ? format(overageAmount) + "オーバー" : "";
      totalValue.classList.toggle("is-over", over);
      budget.hidden = sharedWithoutMe;
      separator.hidden = sharedWithoutMe;
      bar.hidden = sharedWithoutMe;

      meter.setAttribute("aria-label", [
        listType.textContent + "リスト",
        sharedWithoutMe ? "全体の合計" : "予算メーター",
        ...(!sharedWithoutMe ? [budgetLabel.textContent + " " + (effectiveBudget === null ? "未設定" : format(effectiveBudget))] : []),
        totalLabel.textContent + " " + totalValue.textContent,
        ...(over ? [format(overageAmount) + "オーバー"] : []),
        "リストを開く",
      ].join("、"));
    },
  };
}
