import { catalog } from "../data.ts";
import { budgetStatus, cartTotals, exportCartText, PRIORITIES, removeItem, setPriority, setQty, type CartItem, type Priority } from "../logic/cart.ts";
import type { ProductView } from "../logic/catalog.ts";
import type { AppState } from "../state.ts";
import type { AppStore } from "../store.ts";
import { button, el } from "./dom.ts";
import { productDialog } from "./productDialog.ts";

const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
const priorityNames: Record<Priority, string> = { must: "絶対", want: "できれば", maybe: "余裕があれば" };

function sameCartItem(a: CartItem | undefined, b: CartItem | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.productId === b.productId
    && a.priority === b.priority
    && a.qty === b.qty
    && a.bought === b.bought);
}

type CartRow = { element: HTMLElement; update: (item: CartItem) => boolean };

export type CartView = { element: HTMLElement; sync: (state: AppState) => void };

function cartRow(view: ProductView, item: CartItem, store: AppStore, openDetails: (view: ProductView) => void): CartRow {
  const row = el("article", "cart-row");
  let currentItem = item;
  const main = el("div", "cart-row-main");
  const detail = button(view.product.name, "cart-product-name");
  detail.addEventListener("click", () => openDetails(view));
  const boothCode = view.booth.boothCode ?? "番号未定";
  main.append(detail, el("p", "cart-booth", boothCode + " " + view.booth.name));

  const price = el("p", "cart-price");
  main.append(price);

  const controls = el("div", "cart-row-controls");
  const priorityButtons = new Map<Priority, HTMLButtonElement>();
  const setItemPriority = (priority: Priority) => {
    store.update((state) => ({ ...state, items: setPriority(state.items, view.product.id, priority) }));
  };
  for (const priority of PRIORITIES) {
    const control = button(priorityNames[priority.key], "priority-button cart-priority-button priority-" + priority.key);
    control.addEventListener("click", () => setItemPriority(priority.key));
    priorityButtons.set(priority.key, control);
    controls.append(control);
  }

  const quantity = el("div", "quantity-control cart-quantity");
  const minus = button("−", "quantity-button");
  minus.setAttribute("aria-label", view.product.name + "の数量を減らす");
  const amount = el("span", "quantity-value");
  const plus = button("+", "quantity-button");
  plus.setAttribute("aria-label", view.product.name + "の数量を増やす");
  minus.addEventListener("click", () => store.update((state) => ({ ...state, items: setQty(state.items, view.product.id, currentItem.qty - 1) })));
  plus.addEventListener("click", () => store.update((state) => ({ ...state, items: setQty(state.items, view.product.id, currentItem.qty + 1) })));
  quantity.append(minus, amount, plus);
  controls.append(quantity);

  const remove = button("外す", "button button-secondary cart-remove");
  remove.addEventListener("click", () => store.update((state) => ({ ...state, items: removeItem(state.items, view.product.id) })));
  controls.append(remove);
  row.append(main, controls);

  let currentPriority = item.priority;
  const update = (next: CartItem): boolean => {
    const priorityChanged = currentPriority !== next.priority;
    currentItem = next;
    currentPriority = next.priority;
    row.classList.toggle("priority-must", next.priority === "must");
    row.classList.toggle("priority-want", next.priority === "want");
    row.classList.toggle("priority-maybe", next.priority === "maybe");
    for (const [priority, control] of priorityButtons) {
      control.setAttribute("aria-pressed", String(priority === next.priority));
    }
    price.textContent = view.product.price === null
      ? "価格未確認"
      : view.product.price.toLocaleString("ja-JP") + "円 × " + next.qty + " = " + (view.product.price * next.qty).toLocaleString("ja-JP") + "円";
    amount.textContent = String(next.qty);
    minus.disabled = next.qty <= 1;
    plus.disabled = next.qty >= 99;
    return priorityChanged;
  };

  update(item);
  return { element: row, update };
}

export function cartView(store: AppStore): CartView {
  const page = el("section", "cart-page");
  const heading = el("h2", "section-title", "リスト");
  const budgetPanel = el("section", "cart-budget-panel");
  budgetPanel.append(el("h3", "cart-section-title", "予算"));
  const budgetLabel = el("label", "cart-budget-field");
  budgetLabel.append(el("span", "field-label", "予算"));
  const budgetControls = el("span", "cart-budget-controls");
  const budgetInput = el("input", "text-input cart-budget-input");
  budgetInput.type = "number";
  budgetInput.min = "0";
  budgetInput.step = "500";
  budgetInput.inputMode = "numeric";
  budgetInput.setAttribute("aria-label", "予算（円）。空欄で予算なし");
  const budgetUnit = el("span", "cart-budget-unit", "円");
  budgetControls.append(budgetInput, budgetUnit);
  budgetLabel.append(budgetControls);
  const amountCards = el("div", "cart-amount-cards");
  const amountLabels = ["絶対だけで", "できれば込みで", "全部で"];
  const amountValues = amountLabels.map((labelText) => {
    const card = el("div", "cart-amount-card");
    card.append(el("p", "cart-amount-label", labelText));
    const amount = el("p", "cart-amount-value", "0円");
    const difference = el("p", "cart-amount-difference");
    card.append(amount, difference);
    amountCards.append(card);
    return { amount, difference };
  });
  const unknownPrice = el("p", "cart-unknown-price");
  budgetPanel.append(budgetLabel, amountCards, unknownPrice);

  const actions = el("div", "cart-actions");
  const copyButton = button("テキストでコピー", "button button-secondary");
  const clearButton = button("全部外す", "button button-secondary");
  actions.append(copyButton, clearButton);
  const copyStatus = el("p", "cart-copy-status");
  copyStatus.setAttribute("aria-live", "polite");
  const fallbackText = el("textarea", "cart-copy-fallback");
  fallbackText.setAttribute("aria-label", "コピーするリストのテキスト");
  fallbackText.hidden = true;

  const clearConfirm = el("div", "cart-clear-confirm");
  clearConfirm.hidden = true;
  clearConfirm.append(el("p", "", "リストの商品をすべて外しますか？"));
  const confirmClear = button("全部外す", "button button-danger");
  const cancelClear = button("キャンセル", "button button-secondary");
  clearConfirm.append(confirmClear, cancelClear);

  const empty = el("div", "empty-state cart-empty");
  empty.append(el("p", "", "まだ何も入っていません。一覧で『絶対』『できれば』『余裕あれば』を押すと、ここに入ります"));
  const goCatalog = button("一覧を見る", "button button-primary");
  goCatalog.addEventListener("click", () => store.update((state) => ({ ...state, tab: "catalog" })));
  empty.append(goCatalog);

  const groupsRoot = el("div", "cart-groups");
  const groupRows = new Map<Priority, HTMLElement>();
  const groupHeadings = new Map<Priority, HTMLElement>();
  const orderedPriorities: Priority[] = ["must", "want", "maybe"];
  for (const priority of orderedPriorities) {
    const group = el("section", "cart-priority-group");
    const groupHeading = el("h3", "cart-group-heading");
    const rows = el("div", "cart-group-rows");
    group.append(groupHeading, rows);
    groupsRoot.append(group);
    groupRows.set(priority, rows);
    groupHeadings.set(priority, groupHeading);
  }

  const details = productDialog("cart");
  page.append(heading, budgetPanel, actions, copyStatus, fallbackText, clearConfirm, empty, groupsRoot, details.element);

  const rows = new Map<string, CartRow>();
  let previousItems: CartItem[] | undefined;
  let previousItemById = new Map<string, CartItem>();
  let previousBudget: number | null | undefined;
  const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";

  budgetInput.addEventListener("input", () => {
    const value = budgetInput.value;
    const budget = value === "" ? null : Number(value);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return;
    if (store.getState().budget !== budget) store.update((state) => ({ ...state, budget }));
  });
  copyButton.addEventListener("click", async () => {
    const text = exportCartText(store.getState().items, catalog);
    fallbackText.value = text;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(text);
      fallbackText.hidden = true;
      copyStatus.textContent = "リストをコピーしました";
    } catch {
      fallbackText.hidden = false;
      fallbackText.focus();
      fallbackText.select();
      copyStatus.textContent = "コピーできませんでした。下のテキストを選択してコピーしてください";
    }
  });
  clearButton.addEventListener("click", () => { clearConfirm.hidden = false; });
  cancelClear.addEventListener("click", () => { clearConfirm.hidden = true; });
  confirmClear.addEventListener("click", () => {
    clearConfirm.hidden = true;
    store.update((state) => ({ ...state, items: [] }));
  });

  const sync = (state: AppState) => {
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    if (previousItems !== state.items) {
      for (const [id, row] of rows) {
        if (itemById.has(id)) continue;
        row.element.remove();
        rows.delete(id);
      }
      for (const item of state.items) {
        const existingRow = rows.get(item.productId);
        if (!existingRow) {
          const view = viewById.get(item.productId);
          if (!view) continue;
          const nextRow = cartRow(view, item, store, (selected) => details.open(selected));
          rows.set(item.productId, nextRow);
          groupRows.get(item.priority)?.append(nextRow.element);
          continue;
        }
        const previousItem = previousItemById.get(item.productId);
        if (!sameCartItem(previousItem, item)) {
          const priorityChanged = existingRow.update(item);
          if (priorityChanged) groupRows.get(item.priority)?.append(existingRow.element);
        }
      }
      previousItems = state.items;
      previousItemById = itemById;
      const totals = cartTotals(state.items, (id) => viewById.get(id)?.product.price ?? null);
      const cumulative = [totals.cumulative.must, totals.cumulative.mustWant, totals.cumulative.all];
      for (let index = 0; index < cumulative.length; index += 1) {
        const total = cumulative[index];
        const { amount, difference } = amountValues[index];
        amount.textContent = format(total);
        const status = budgetStatus(total, state.budget);
        difference.classList.toggle("is-over-budget", status.kind === "over");
        difference.textContent = status.kind === "none"
          ? ""
          : status.kind === "over"
            ? format(status.over) + "オーバー"
            : "残り" + format(status.remaining);
      }
      unknownPrice.textContent = totals.unknownPrice
        ? "価格不明 " + totals.unknownPrice + "件（合計に入っていません）"
        : "";
      for (const priority of orderedPriorities) {
        const group = totals.byPriority[priority];
        groupHeadings.get(priority)!.textContent = priorityNames[priority] + " " + group.items + "件 " + format(group.amount);
        groupRows.get(priority)!.parentElement!.hidden = group.items === 0;
      }
      empty.hidden = state.items.length > 0;
      groupsRoot.hidden = state.items.length === 0;
      actions.hidden = state.items.length === 0;
      copyStatus.textContent = "";
      fallbackText.hidden = true;
    }
    if (previousBudget !== state.budget) {
      if (document.activeElement !== budgetInput) budgetInput.value = state.budget === null ? "" : String(state.budget);
      previousBudget = state.budget;
      if (previousItems === state.items) {
        const totals = cartTotals(state.items, (id) => viewById.get(id)?.product.price ?? null);
        const cumulative = [totals.cumulative.must, totals.cumulative.mustWant, totals.cumulative.all];
        for (let index = 0; index < cumulative.length; index += 1) {
          const status = budgetStatus(cumulative[index], state.budget);
          const difference = amountValues[index].difference;
          difference.classList.toggle("is-over-budget", status.kind === "over");
          difference.textContent = status.kind === "none"
            ? ""
            : status.kind === "over"
              ? format(status.over) + "オーバー"
              : "残り" + format(status.remaining);
        }
      }
    }
  };

  return { element: page, sync };
}
