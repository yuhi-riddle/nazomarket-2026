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
  const must = el("span", "meter-segment meter-must");
  const want = el("span", "meter-segment meter-want");
  const maybe = el("span", "meter-segment meter-maybe");
  const marker = el("span", "meter-budget-marker");
  bar.append(must, want, maybe, marker);
  const copy = el("span", "meter-copy");
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
      const denominator = Math.max(totals.cumulative.all, budget ?? 0, 1);
      must.style.width = (totals.byPriority.must.amount / denominator * 100) + "%";
      want.style.width = (totals.byPriority.want.amount / denominator * 100) + "%";
      maybe.style.width = (totals.byPriority.maybe.amount / denominator * 100) + "%";
      marker.hidden = budget === null;
      marker.style.left = (budget === null ? 0 : Math.min(100, budget / denominator * 100)) + "%";
      const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";
      const unknownText = totals.unknownPrice ? "価格不明 " + totals.unknownPrice + "件" : "";
      budgetLabel.textContent = budget === null ? "" : "予算 " + format(budget);
      copy.textContent = "絶対 " + format(totals.cumulative.must)
        + " ／ 全部 " + format(totals.cumulative.all);
      const over = budget !== null && totals.cumulative.all > budget;
      const remainingText = budget === null
        ? ""
        : over
          ? format(totals.cumulative.all - budget) + "超過"
          : "残り " + format(budget - totals.cumulative.all);
      summary.textContent = [remainingText, unknownText].filter(Boolean).join(" ・ ");
      summary.classList.toggle("is-over", over);
      meter.setAttribute("aria-label", ["予算メーター", budgetLabel.textContent, copy.textContent, summary.textContent, "リストを開く"]
        .filter(Boolean).join("。"));
    },
  };
}
