import { cartTotals, type CartItem } from "../logic/cart.ts";
import { button, el } from "./dom.ts";
import { productById } from "../data.ts";

export type BudgetMeter = { element: HTMLButtonElement; update: (items: CartItem[], budget: number | null, visible: boolean) => void };

export function budgetMeter(onOpenCart: () => void): BudgetMeter {
  const meter = button("", "budget-meter");
  meter.setAttribute("aria-live", "polite");
  meter.setAttribute("aria-atomic", "true");
  meter.addEventListener("click", onOpenCart);
  const budgetLabel = el("span", "meter-budget");
  const bar = el("span", "meter-bar");
  bar.setAttribute("aria-hidden", "true");
  const total = el("span", "meter-segment meter-must");
  const marker = el("span", "meter-budget-marker");
  bar.append(total, marker);
  const copy = el("span", "meter-copy");
  copy.append(el("span", "meter-total-label", "合計"));
  const totalValue = el("strong", "meter-total-value");
  copy.append(totalValue);
  const summary = el("span", "meter-summary");
  meter.append(budgetLabel, bar, copy, summary);
  let previousItems: CartItem[] | undefined;
  let previousBudget: number | null | undefined;

  return {
    element: meter,
    update(items, budget, visible) {
      meter.hidden = !visible;
      if (previousItems === items && previousBudget === budget) return;
      previousItems = items;
      previousBudget = budget;
      const totals = cartTotals(items, (id) => productById.get(id)?.price ?? null);
      const denominator = Math.max(totals.amount, budget ?? 0, 1);
      total.style.width = (totals.amount / denominator * 100) + "%";
      marker.hidden = budget === null;
      marker.style.left = (budget === null ? 0 : Math.min(100, budget / denominator * 100)) + "%";
      const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";
      const unknownText = totals.unknownPrice ? "価格不明 " + totals.unknownPrice + "件" : "";
      budgetLabel.textContent = budget === null ? "" : "予算 " + format(budget);
      totalValue.textContent = format(totals.amount);
      const over = budget !== null && totals.amount > budget;
      const remainingText = budget === null
        ? ""
        : over
          ? format(totals.amount - budget) + "超過"
          : "残り " + format(budget - totals.amount);
      summary.textContent = [remainingText, unknownText].filter(Boolean).join(" ・ ");
      summary.classList.toggle("is-over", over);
      meter.setAttribute("aria-label", ["予算メーター", budgetLabel.textContent, "合計 " + totalValue.textContent, summary.textContent, "リストを開く"]
        .filter(Boolean).join("。"));
    },
  };
}
