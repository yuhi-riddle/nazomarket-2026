import { cartTotals, type CartItem } from "../logic/cart.ts";
import { button, el } from "./dom.ts";
import { productById } from "../data.ts";

export type BudgetMeter = { element: HTMLButtonElement; update: (items: CartItem[], budget: number | null, visible: boolean) => void };

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
  const copy = el("span", "meter-copy");
  copy.append(el("span", "meter-total-label", "合計"));
  const totalValue = el("strong", "meter-total-value");
  copy.append(totalValue);
  const overage = el("span", "meter-overage");
  overage.hidden = true;
  copy.append(overage);

  const separator = el("span", "meter-separator", "／");
  separator.setAttribute("aria-hidden", "true");
  const budget = el("span", "meter-budget");
  budget.append(el("span", "meter-budget-label", "予算"));
  const budgetValue = el("strong", "meter-budget-value");
  budget.append(budgetValue);
  summary.append(copy, separator, budget);
  meter.append(summary, bar);

  let previousItems: CartItem[] | undefined;
  let previousBudget: number | null | undefined;

  return {
    element: meter,
    update(items, budgetAmount, visible) {
      meter.hidden = !visible;
      if (previousItems === items && previousBudget === budgetAmount) return;
      previousItems = items;
      previousBudget = budgetAmount;
      const totals = cartTotals(items, (id) => productById.get(id)?.price ?? null);
      const denominator = Math.max(totals.amount, budgetAmount ?? 0, 1);
      total.style.width = (budgetAmount === null ? 0 : totals.amount / denominator * 100) + "%";
      marker.hidden = budgetAmount === null;
      marker.style.left = (budgetAmount === null ? 0 : Math.min(100, budgetAmount / denominator * 100)) + "%";

      const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";
      const over = budgetAmount !== null && totals.amount > budgetAmount;
      totalValue.textContent = format(totals.amount);
      budgetValue.textContent = budgetAmount === null ? "未設定" : format(budgetAmount);
      overage.hidden = !over;
      overage.textContent = over ? format(totals.amount - budgetAmount) + "オーバー" : "";
      totalValue.classList.toggle("is-over", over);

      meter.setAttribute("aria-label", [
        "予算メーター",
        "予算 " + (budgetAmount === null ? "未設定" : format(budgetAmount)),
        "合計 " + totalValue.textContent,
        ...(over ? [format(totals.amount - budgetAmount) + "オーバー"] : []),
        "リストを開く",
      ].join("、"));
    },
  };
}
