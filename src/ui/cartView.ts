import { catalog } from "../data.ts";
import {
  cartTotals,
  daySummary,
  exportCartText,
  removeItem,
  setQty,
  toggleBought,
  type CartItem,
} from "../logic/cart.ts";
import { sortCatalog, type ProductView } from "../logic/catalog.ts";
import type { AppState } from "../state.ts";
import type { AppStore } from "../store.ts";
import { button, el } from "./dom.ts";
import { productDialog } from "./productDialog.ts";
import { sharedListView, type SharedListViewOptions } from "./sharedListView.ts";

const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));

type CartRow = { element: HTMLElement; update: (item: CartItem, hideBought: boolean, canEdit: boolean) => void };
type CartSection = { element: HTMLElement; heading: HTMLElement; rows: HTMLElement; idsKey: string; title: string };
type CartBucket = { key: string; title: string; ids: string[]; organization: string; boothCode: string };

export type CartView = { element: HTMLElement; sync: (state: AppState) => void; setActive?: (active: boolean) => void };

function sameCartItem(a: CartItem | undefined, b: CartItem | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.productId === b.productId
    && a.qty === b.qty
    && a.bought === b.bought);
}

function cartRow(view: ProductView, item: CartItem, store: AppStore, openDetails: (view: ProductView) => void): CartRow {
  const row = el("article", "today-item cart-row");
  row.dataset.productId = view.product.id;
  let currentItem = item;
  let currentHideBought: boolean | undefined;
  let currentCanEdit: boolean | undefined;

  const boughtLabel = el("label", "today-item-check");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.setAttribute("aria-label", view.product.name + "を買えたにする");
  checkbox.addEventListener("change", () => {
    store.update((state) => ({ ...state, items: toggleBought(state.items, view.product.id) }));
    checkbox.focus();
  });
  boughtLabel.append(checkbox, el("span", "", "買えた"));

  const description = el("div", "today-item-description cart-row-main");
  const name = button(view.product.name, "cart-product-name today-item-name");
  name.addEventListener("click", () => openDetails(view));
  const amount = el("span", "today-item-amount cart-price");
  description.append(name, amount);

  const status = el("span", "today-item-status");
  const controls = el("div", "today-item-controls cart-row-controls");
  const quantity = el("div", "quantity-control cart-quantity");
  const minus = button("−", "quantity-button");
  minus.setAttribute("aria-label", view.product.name + "の数量を減らす");
  const quantityValue = el("span", "quantity-value");
  const plus = button("+", "quantity-button");
  plus.setAttribute("aria-label", view.product.name + "の数量を増やす");
  minus.addEventListener("click", () => store.update((state) => ({
    ...state,
    items: setQty(state.items, view.product.id, currentItem.qty - 1),
  })));
  plus.addEventListener("click", () => store.update((state) => ({
    ...state,
    items: setQty(state.items, view.product.id, currentItem.qty + 1),
  })));
  quantity.append(minus, quantityValue, plus);

  const remove = button("外す", "button button-secondary cart-remove");
  remove.addEventListener("click", () => store.update((state) => ({
    ...state,
    items: removeItem(state.items, view.product.id),
  })));
  controls.append(quantity, remove);
  row.append(boughtLabel, description, status, controls);

  const update = (next: CartItem, hideBought: boolean, canEdit: boolean) => {
    if (sameCartItem(currentItem, next) && currentHideBought === hideBought && currentCanEdit === canEdit) return;
    currentItem = next;
    currentHideBought = hideBought;
    currentCanEdit = canEdit;
    checkbox.disabled = !canEdit;
    checkbox.checked = next.bought;
    const unitPrice = view.product.price === null
      ? "価格未確認"
      : view.product.price.toLocaleString("ja-JP") + "円";
    const subtotal = view.product.price === null
      ? ""
      : " = " + (view.product.price * next.qty).toLocaleString("ja-JP") + "円";
    amount.textContent = unitPrice + " × " + next.qty + subtotal;
    quantityValue.textContent = String(next.qty);
    minus.disabled = !canEdit || next.qty <= 1;
    plus.disabled = !canEdit || next.qty >= 99;
    remove.disabled = !canEdit;
    row.classList.toggle("is-bought", next.bought);
    row.hidden = hideBought && next.bought;
    status.textContent = next.bought ? "✓ 買った" : "";
  };

  update(item, false, !store.isSharedWriteBlocked());
  return { element: row, update };
}

function cartBuckets(items: CartItem[]): CartBucket[] {
  const selected = new Set(items.map((item) => item.productId));
  const buckets = new Map<string, CartBucket>();
  for (const view of sortCatalog(catalog, "booth")) {
    if (!selected.has(view.product.id)) continue;
    const key = "booth:" + view.booth.id;
    let bucket = buckets.get(key);
    if (!bucket) {
      const boothCode = view.booth.boothCode ?? "番号未定";
      bucket = { key, title: view.booth.name + " " + boothCode, organization: view.booth.name, boothCode, ids: [] };
      buckets.set(key, bucket);
    }
    bucket.ids.push(view.product.id);
  }
  return [...buckets.values()];
}

export function cartView(store: AppStore, sharedOptions?: SharedListViewOptions): CartView {
  const page = el("section", "cart-page");
  const heading = el("h2", "section-title", "リスト");
  const shared = sharedOptions ? sharedListView(store, sharedOptions) : null;

  const summary = el("section", "today-summary cart-summary");
  summary.setAttribute("aria-label", "リストの合計と使った金額");
  summary.setAttribute("aria-live", "polite");
  summary.setAttribute("aria-atomic", "true");
  const summaryValues = new Map<string, { tile: HTMLElement; value: HTMLElement }>();
  for (const [key, label, initial] of [
    ["total", "合計", "0円"],
    ["spent", "使った金額", "0円"],
    ["remaining", "残り予算", "—"],
    ["points", "GET（購入点数）", "0 / 0点"],
  ]) {
    const tile = el("div", "today-summary-tile");
    const value = el("strong", "today-summary-value", initial);
    tile.append(el("span", "today-summary-label", label), value);
    summary.append(tile);
    summaryValues.set(key, { tile, value });
  }

  const budgetPanel = el("div", "cart-budget-panel");
  const budgetLabel = el("label", "cart-budget-field");
  budgetLabel.append(el("span", "field-label", "予算"));
  const budgetControls = el("span", "cart-budget-controls");
  const budgetInput = el("input", "text-input cart-budget-input");
  budgetInput.type = "number";
  budgetInput.min = "0";
  budgetInput.step = "500";
  budgetInput.inputMode = "numeric";
  budgetInput.setAttribute("aria-label", "予算（円）。空欄で予算なし");
  budgetControls.append(budgetInput, el("span", "cart-budget-unit", "円"));
  budgetLabel.append(budgetControls);
  budgetPanel.append(budgetLabel);
  summary.append(budgetPanel);

  const unknownPrice = el("p", "cart-unknown-price");
  const unknownBought = el("p", "today-unknown-price");
  const allBought = el("p", "today-all-bought");
  allBought.setAttribute("role", "status");

  const routeTitle = el("h3", "today-route-title", "ブース別リスト");
  const groupsRoot = el("div", "today-route-groups cart-groups");
  const hideBoughtLabel = el("label", "check-option today-hide-bought");
  const hideBoughtInput = el("input");
  hideBoughtInput.type = "checkbox";
  hideBoughtInput.addEventListener("change", () => {
    store.update((state) => ({ ...state, today: { ...state.today, hideBought: hideBoughtInput.checked } }));
  });
  hideBoughtLabel.append(hideBoughtInput, el("span", "", "買ったものを隠す"));

  const empty = el("div", "empty-state today-empty cart-empty");
  empty.append(el("p", "", "まだ何も入っていません。一覧で「リストに入れる」を押すと、ここに表示されます。"));
  const goCatalog = button("一覧を見る", "button button-primary");
  goCatalog.addEventListener("click", () => store.update((state) => ({ ...state, tab: "catalog" })));
  empty.append(goCatalog);

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

  const details = productDialog("cart");
  page.append(
    heading,
    ...(shared ? [shared.element] : []),
    summary,
    unknownPrice,
    unknownBought,
    routeTitle,
    groupsRoot,
    allBought,
    hideBoughtLabel,
    empty,
    actions,
    copyStatus,
    fallbackText,
    clearConfirm,
    details.element,
  );

  const rows = new Map<string, CartRow>();
  const sections = new Map<string, CartSection>();
  let previousItems: CartItem[] | undefined;
  let previousItemById = new Map<string, CartItem>();
  let previousBudget: number | null | undefined;
  let previousHideBought: boolean | undefined;
  let previousSharedWriteBlocked: boolean | undefined;
  let previousRouteKey = "";
  let previousSectionKeys: string[] = [];
  const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";

  const commitBudget = () => {
    const value = budgetInput.value;
    const budget = value === "" ? null : Number(value);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return;
    if (store.getState().budget !== budget) store.update((state) => ({ ...state, budget }));
  };
  budgetInput.addEventListener("input", () => {
    if (!store.isShared()) commitBudget();
  });
  budgetInput.addEventListener("change", commitBudget);
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

  const getSection = (key: string): CartSection => {
    const existing = sections.get(key);
    if (existing) return existing;
    const section = el("section", "today-route-group cart-route-group");
    const groupHeading = el("h4", "today-route-heading");
    const groupRows = el("div", "today-route-rows cart-group-rows");
    section.append(groupHeading, groupRows);
    const created = { element: section, heading: groupHeading, rows: groupRows, idsKey: "", title: "" };
    sections.set(key, created);
    return created;
  };

  const updateTotals = (state: AppState) => {
    const totals = cartTotals(state.items, (id) => viewById.get(id)?.product.price ?? null);
    const spent = daySummary(state.items, (id) => viewById.get(id)?.product.price ?? null, state.budget);
    summaryValues.get("total")!.value.textContent = format(totals.amount);
    summaryValues.get("spent")!.value.textContent = format(spent.spent);
    const remaining = summaryValues.get("remaining")!;
    remaining.tile.classList.toggle("is-over-budget", spent.remaining !== null && spent.remaining < 0);
    remaining.value.textContent = spent.remaining === null
      ? "—"
      : spent.remaining < 0
        ? "OVER +" + format(-spent.remaining)
        : format(spent.remaining);
    summaryValues.get("points")!.value.textContent = spent.boughtQty + " / " + totals.qty + "点";
    unknownPrice.textContent = totals.unknownPrice
      ? "価格不明 " + totals.unknownPrice + "件（合計に含まれていません）"
      : "";
    unknownBought.textContent = spent.unknownPriceBought
      ? "買った商品のうち価格不明 " + spent.unknownPriceBought + "件は、使った金額に含まれていません"
      : "";
    allBought.textContent = state.items.length > 0 && spent.leftToBuy === 0
      ? "リストの商品はすべて買いました"
      : "";
    allBought.hidden = !allBought.textContent;
    empty.hidden = state.items.length > 0;
    routeTitle.hidden = state.items.length === 0;
    groupsRoot.hidden = state.items.length === 0;
    hideBoughtLabel.hidden = state.items.length === 0;
    actions.hidden = state.items.length === 0;
  };

  const sync = (state: AppState) => {
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    for (const [id, row] of rows) {
      if (itemById.has(id)) continue;
      row.element.remove();
      rows.delete(id);
    }
    for (const item of state.items) {
      const view = viewById.get(item.productId);
      if (!view) continue;
      let row = rows.get(item.productId);
      if (!row) {
        row = cartRow(view, item, store, (selected) => details.open(selected));
        rows.set(item.productId, row);
      }
      if (!sameCartItem(previousItemById.get(item.productId), item)
        || previousHideBought !== state.today.hideBought || previousSharedWriteBlocked !== store.isSharedWriteBlocked()) {
        row.update(item, state.today.hideBought, !store.isSharedWriteBlocked());
      }
    }

    const routeKey = JSON.stringify(state.items.map((item) => item.productId));
    if (routeKey !== previousRouteKey) {
      const buckets = cartBuckets(state.items);
      const nextKeys = buckets.map((bucket) => bucket.key);
      const activeKeys = new Set(nextKeys);
      const orderedSections = buckets.map((bucket) => {
        const section = getSection(bucket.key);
        if (section.title !== bucket.title) {
          section.title = bucket.title;
          const organization = el("strong", "today-route-organization", bucket.organization);
          const boothCode = el("small", "today-route-booth", bucket.boothCode);
          section.heading.replaceChildren(organization, document.createTextNode(" "), boothCode);
        }
        const idsKey = JSON.stringify(bucket.ids);
        if (section.idsKey !== idsKey) {
          section.idsKey = idsKey;
          let cursor: ChildNode | null = section.rows.firstChild;
          for (const id of bucket.ids) {
            const row = rows.get(id)?.element;
            if (!row) continue;
            if (row !== cursor) section.rows.insertBefore(row, cursor);
            cursor = row.nextSibling;
          }
          while (cursor) {
            const next = cursor.nextSibling;
            cursor.parentNode?.removeChild(cursor);
            cursor = next;
          }
        }
        return section.element;
      });
      for (const [key, section] of sections) {
        if (activeKeys.has(key)) continue;
        section.element.remove();
        section.rows.replaceChildren();
        section.idsKey = "";
        section.title = "";
      }
      if (nextKeys.length !== previousSectionKeys.length
        || nextKeys.some((key, index) => key !== previousSectionKeys[index])) {
        let cursor: ChildNode | null = groupsRoot.firstChild;
        for (const section of orderedSections) {
          if (section !== cursor) groupsRoot.insertBefore(section, cursor);
          cursor = section.nextSibling;
        }
        previousSectionKeys = nextKeys;
      }
      previousRouteKey = routeKey;
    }

    const shouldUpdateTotals = previousItems !== state.items || previousBudget !== state.budget;
    if (shouldUpdateTotals) updateTotals(state);
    if (previousBudget !== state.budget) {
      if (document.activeElement !== budgetInput) budgetInput.value = state.budget === null ? "" : String(state.budget);
      previousBudget = state.budget;
    }
    if (previousHideBought !== state.today.hideBought) {
      hideBoughtInput.checked = state.today.hideBought;
      previousHideBought = state.today.hideBought;
    }
    previousSharedWriteBlocked = store.isSharedWriteBlocked();
    budgetInput.disabled = store.isSharedWriteBlocked();
    clearButton.disabled = store.isSharedWriteBlocked();
    confirmClear.disabled = store.isSharedWriteBlocked();
    if (previousItems !== state.items) {
      previousItems = state.items;
      previousItemById = itemById;
    }
    if (shouldUpdateTotals) {
      copyStatus.textContent = "";
      fallbackText.hidden = true;
    }
  };

  return { element: page, sync, ...(shared ? { setActive: shared.setActive } : {}) };
}
