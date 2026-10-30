import { catalog, venueLayout } from "../data.ts";
import {
  cartTotals,
  daySummary,
  exportCartText,
  removeItem,
  setQty,
  shouldHideCartGroup,
  toggleBought,
  type CartItem,
} from "../logic/cart.ts";
import { sortCatalog, type ProductView } from "../logic/catalog.ts";
import { summarizeMembers, type MemberSummaryRow } from "../logic/memberSummary.ts";
import type { AppState } from "../state.ts";
import type { AppStore, SharedStoreState } from "../store.ts";
import { button, el } from "./dom.ts";
import { productDialog } from "./productDialog.ts";
import { sharedListView, type SharedListView, type SharedListViewOptions } from "./sharedListView.ts";
import { celebrateGet } from "./gameFx.ts";

const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));

type CartRow = {
  element: HTMLElement;
  update: (item: CartItem, hideBought: boolean, canEdit: boolean, shared: SharedStoreState | null) => void;
};
type MemberTableRow = {
  element: HTMLTableRowElement;
  name: HTMLElement;
  total: HTMLElement;
  budget: HTMLInputElement;
  remainingTile: HTMLElement;
  remaining: HTMLElement;
  rename: HTMLButtonElement;
  remove: HTMLButtonElement;
  current: MemberSummaryRow | null;
};
type CartSection = { element: HTMLElement; heading: HTMLElement; rows: HTMLElement; idsKey: string; ids: string[]; title: string };
type CartBucket = { key: string; title: string; ids: string[]; organization: string; boothCode: string };

export type CartView = {
  element: HTMLElement;
  sync: (state: AppState, shared?: SharedStoreState | null) => void;
  setActive?: (active: boolean) => void;
};

function sameCartItem(a: CartItem | undefined, b: CartItem | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.productId === b.productId
    && a.qty === b.qty
    && a.bought === b.bought);
}

function cartRow(
  view: ProductView,
  item: CartItem,
  store: AppStore,
  sharedActions: SharedListView | null,
  openDetails: (view: ProductView) => void,
): CartRow {
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
    if (checkbox.checked) celebrateGet(view.product.name);
    store.update((state) => ({ ...state, items: toggleBought(state.items, view.product.id) }));
    checkbox.focus();
  });
  boughtLabel.append(checkbox, el("span", "", "買えた"));

  const description = el("div", "today-item-description cart-row-main");
  const name = button(view.product.name, "cart-product-name today-item-name");
  name.addEventListener("click", () => openDetails(view));
  const getBadge = el("span", "cart-get-badge", "GET!");
  getBadge.hidden = true;
  const amount = el("span", "today-item-amount cart-price");
  description.append(name, getBadge, amount);
  const status = el("span", "today-item-status");
  const controls = el("div", "today-item-controls cart-row-controls");
  const ownerSelect = el("select", "text-input shared-owner-select");
  ownerSelect.setAttribute("aria-label", view.product.name + "の担当");
  ownerSelect.hidden = true;
  let currentShared: SharedStoreState | null = null;
  let ownerOptionsKey = "";
  const syncOwnerSelect = () => {
    if (!sharedActions) return;
    const sharedState = currentShared;
    ownerSelect.hidden = sharedState === null;
    ownerSelect.disabled = sharedState === null || store.isSharedWriteBlocked();
    if (!sharedState) return;
    const nextOptionsKey = JSON.stringify(sharedState.members.map((member) => [member.id, member.name]));
    if (ownerOptionsKey !== nextOptionsKey && document.activeElement !== ownerSelect) {
      const undecided = el("option", "", "未定");
      undecided.value = "";
      ownerSelect.replaceChildren(undecided, ...sharedState.members.map((member) => {
        const option = el("option", "", member.name);
        option.value = member.id;
        return option;
      }));
      ownerOptionsKey = nextOptionsKey;
    }
    const ownerId = sharedState.ownerByProductId.get(view.product.id) ?? null;
    if (document.activeElement !== ownerSelect && ownerSelect.value !== (ownerId ?? "")) {
      ownerSelect.value = ownerId ?? "";
    }
  };
  ownerSelect.addEventListener("change", () => {
    if (sharedActions) void sharedActions.setOwner(view.product.id, ownerSelect.value || null);
  });
  ownerSelect.addEventListener("blur", syncOwnerSelect);
  const quantity = el("div", "quantity-control cart-quantity");
  const minus = button("−", "quantity-button");
  minus.setAttribute("aria-label", view.product.name + "の数量を減らす");
  const quantityValue = el("span", "quantity-value");
  const plus = button("+", "quantity-button");
  plus.setAttribute("aria-label", view.product.name + "の数量を増やす");
  const quantityHint = el("span", "quantity-hint cart-quantity-hint", "購入チェックを外すと変更できます");
  quantityHint.hidden = true;
  quantityHint.id = "cart-quantity-hint-" + view.product.id;
  minus.setAttribute("aria-describedby", quantityHint.id);
  plus.setAttribute("aria-describedby", quantityHint.id);
  minus.addEventListener("click", () => store.update((state) => ({
    ...state,
    items: setQty(state.items, view.product.id, currentItem.qty - 1),
  })));
  plus.addEventListener("click", () => store.update((state) => ({
    ...state,
    items: setQty(state.items, view.product.id, currentItem.qty + 1),
  })));
  quantity.append(minus, quantityValue, plus, quantityHint);

  const remove = button("外す", "button button-secondary cart-remove");
  remove.addEventListener("click", () => store.update((state) => ({
    ...state,
    items: removeItem(state.items, view.product.id),
  })));
  controls.append(ownerSelect, quantity, remove);
  row.append(boughtLabel, description, status, controls);

  const update = (next: CartItem, hideBought: boolean, canEdit: boolean, sharedState: SharedStoreState | null) => {
    const previousOwner = currentShared?.ownerByProductId.get(view.product.id) ?? null;
    const nextOwner = sharedState?.ownerByProductId.get(view.product.id) ?? null;
    const previousMembersKey = currentShared
      ? JSON.stringify(currentShared.members.map((member) => [member.id, member.name]))
      : "";
    const nextMembersKey = sharedState
      ? JSON.stringify(sharedState.members.map((member) => [member.id, member.name]))
      : "";
    if (sameCartItem(currentItem, next) && currentHideBought === hideBought && currentCanEdit === canEdit
      && previousOwner === nextOwner && previousMembersKey === nextMembersKey && (currentShared !== null) === (sharedState !== null)) return;
    currentItem = next;
    currentHideBought = hideBought;
    currentCanEdit = canEdit;
    currentShared = sharedState;
    syncOwnerSelect();
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
    minus.disabled = !canEdit || next.bought || next.qty <= 1;
    plus.disabled = !canEdit || next.bought || next.qty >= 99;
    quantityHint.hidden = !next.bought;
    remove.disabled = !canEdit;
    row.classList.toggle("is-bought", next.bought);
    row.hidden = hideBought && next.bought;
    getBadge.hidden = !next.bought;
    status.textContent = "";
  };

  update(item, false, !store.isSharedWriteBlocked(), null);
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

export function cartView(
  store: AppStore,
  sharedOptions?: SharedListViewOptions,
  onMapBooth?: (boothCode: string) => void,
): CartView {
  const page = el("section", "cart-page");
  const heading = el("h2", "section-title", store.isShared() ? "共同リスト" : "個人リスト");
  const shared = sharedOptions ? sharedListView(store, sharedOptions) : null;

  const summary = el("section", "today-summary cart-summary");
  summary.setAttribute("aria-label", "リストの合計と購入金額");
  summary.setAttribute("aria-live", "polite");
  summary.setAttribute("aria-atomic", "true");
  const summaryValues = new Map<string, { tile: HTMLElement; value: HTMLElement }>();
  for (const [key, label, initial] of [
    ["total", "合計", "0円"],
    ["spent", "購入金額", "0円"],
    ["remaining", "予算残高", "未設定"],
    ["points", "GETした数", "0 / 0"],
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

  const memberOverview = el("section", "shared-member-overview");
  memberOverview.hidden = true;
  const memberTable = el("table", "shared-member-table");
  const memberCaption = el("caption", "shared-member-caption", "メンバーごとの担当と予算");
  const memberHead = el("thead");
  const memberHeadRow = el("tr");
  for (const label of ["名前", "担当の合計", "予算", "残り"]) {
    const cell = el("th", "", label);
    cell.scope = "col";
    memberHeadRow.append(cell);
  }
  memberHead.append(memberHeadRow);
  const memberBody = el("tbody");
  memberTable.append(memberCaption, memberHead, memberBody);
  const memberFooter = el("div", "shared-member-summary");
  memberFooter.setAttribute("role", "status");
  memberFooter.setAttribute("aria-live", "polite");
  const unassignedSummary = el("p", "shared-member-unassigned");
  const sharedTotalSummary = el("p", "shared-member-total");
  memberFooter.append(unassignedSummary, sharedTotalSummary);
  memberOverview.append(memberTable, memberFooter);

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
  hideBoughtLabel.append(hideBoughtInput, el("span", "", "購入済みを非表示"));

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
  clearConfirm.append(el("p", "", "リストのアイテムをすべて外しますか？"));
  const confirmClear = button("全部外す", "button button-danger");
  const cancelClear = button("キャンセル", "button button-secondary");
  clearConfirm.append(confirmClear, cancelClear);

  const details = productDialog("cart", onMapBooth);
  page.append(
    heading,
    ...(shared ? [shared.element] : []),
    summary,
    memberOverview,
    unknownPrice,
    unknownBought,
    hideBoughtLabel,
    routeTitle,
    groupsRoot,
    allBought,
    empty,
    actions,
    copyStatus,
    fallbackText,
    clearConfirm,
    details.element,
  );

  const rows = new Map<string, CartRow>();
  const memberRows = new Map<string, MemberTableRow>();
  const sections = new Map<string, CartSection>();
  let previousItems: CartItem[] | undefined;
  let previousBudget: number | null | undefined;
  let previousSharedMode: boolean | undefined;
  let previousHideBought: boolean | undefined;
  let previousRouteKey = "";
  let previousSectionKeys: string[] = [];
  let previousMemberTableKey: string | null = null;
  let previousMemberOrder: string[] = [];
  const format = (amount: number) => amount.toLocaleString("ja-JP") + "円";

  const createMemberRow = (memberId: string): MemberTableRow => {
    const element = el("tr");
    const nameCell = el("th");
    nameCell.scope = "row";
    const name = el("span", "shared-member-name");
    const actions = el("div", "shared-member-actions");
    const rename = button("名前変更", "button button-secondary shared-member-rename");
    const remove = button("外す", "button button-secondary shared-member-remove");
    actions.append(rename, remove);
    nameCell.append(name, actions);

    const totalCell = el("td");
    const total = el("strong", "shared-member-total-value");
    totalCell.append(total);

    const budgetCell = el("td");
    const budget = el("input", "text-input shared-member-budget");
    budget.type = "number";
    budget.min = "0";
    budget.max = "1000000000";
    budget.step = "500";
    budget.inputMode = "numeric";
    budget.addEventListener("change", () => {
      const current = memberRows.get(memberId)?.current;
      if (!current || !shared) return;
      const value = budget.value;
      const amount = value === "" ? null : Number(value);
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000)) {
        budget.setCustomValidity("0〜1,000,000,000円の整数を入力してください。");
        budget.reportValidity();
        return;
      }
      budget.setCustomValidity("");
      void shared.enqueue({ type: "set-member-budget", memberId, budgetYen: amount });
    });
    budgetCell.append(budget);

    const remainingCell = el("td");
    const remainingTile = el("div", "today-summary-tile shared-member-remaining");
    const remaining = el("strong", "today-summary-value");
    remainingTile.append(remaining);
    remainingCell.append(remainingTile);

    const row: MemberTableRow = {
      element,
      name,
      total,
      budget,
      remainingTile,
      remaining,
      rename,
      remove,
      current: null,
    };
    budget.addEventListener("blur", () => {
      const current = memberRows.get(memberId)?.current;
      if (!current) return;
      const value = current.budget === null ? "" : String(current.budget);
      if (budget.value !== value) budget.value = value;
    });
    rename.addEventListener("click", () => {
      if (!row.current || !shared) return;
      const proposed = window.prompt("新しい名前を入力してください。", row.current.name);
      if (proposed === null) return;
      const nameValue = proposed.trim();
      if ([...nameValue].length < 1 || [...nameValue].length > 20 || /\p{Cc}/u.test(nameValue)) {
        window.alert("名前は1〜20文字で入力してください。");
        return;
      }
      void shared.enqueue({ type: "rename-member", memberId, name: nameValue });
    });
    remove.addEventListener("click", () => {
      if (!row.current || !shared) return;
      if (!window.confirm(row.current.name + "さんをメンバーから外しますか？担当のアイテムは未定になります。")) return;
      void shared.enqueue({ type: "remove-member", memberId });
    });

    element.append(nameCell, totalCell, budgetCell, remainingCell);
    return row;
  };

  const updateMemberTable = (state: AppState, sharedState: SharedStoreState | null): void => {
    const sharedMode = store.isShared();
    summary.hidden = sharedMode;
    memberOverview.hidden = !sharedMode;
    if (!sharedMode) return;
    const activeShared = sharedState ?? { members: [], ownerByProductId: new Map<string, string | null>(), meId: null };

    const blocked = store.isSharedWriteBlocked();
    const tableKey = JSON.stringify([
      activeShared.meId,
      activeShared.members.map((member) => [member.id, member.name, member.budgetYen]),
      state.items.map((item) => [item.productId, item.qty, viewById.get(item.productId)?.product.price ?? null,
        activeShared.ownerByProductId.get(item.productId) ?? null]),
      blocked,
    ]);
    if (tableKey === previousMemberTableKey) return;
    previousMemberTableKey = tableKey;

    const summaryState = {
      revision: 0,
      members: activeShared.members,
      items: state.items.map((item) => {
        const product = viewById.get(item.productId)?.product;
        return {
          id: item.productId,
          productId: item.productId,
          name: product?.name ?? item.productId,
          priceYen: product?.price ?? null,
          quantity: item.qty,
          purchased: item.bought,
          ownerId: activeShared.ownerByProductId.get(item.productId) ?? null,
        };
      }),
    };
    const totals = summarizeMembers(summaryState, (productId) => viewById.get(productId)?.product.price ?? null);
    const activeIds = new Set(totals.members.map((member) => member.memberId));
    for (const [memberId, row] of memberRows) {
      if (activeIds.has(memberId)) continue;
      row.element.remove();
      memberRows.delete(memberId);
    }

    for (const member of totals.members) {
      let row = memberRows.get(member.memberId);
      if (!row) {
        row = createMemberRow(member.memberId);
        memberRows.set(member.memberId, row);
      }
      row.current = member;
      const nameText = member.name + (member.memberId === activeShared.meId ? "（自分）" : "");
      if (row.name.textContent !== nameText) row.name.textContent = nameText;
      const totalText = format(member.total);
      if (row.total.textContent !== totalText) row.total.textContent = totalText;
      const budgetLabel = member.name + "の予算（円）";
      if (row.budget.getAttribute("aria-label") !== budgetLabel) row.budget.setAttribute("aria-label", budgetLabel);
      row.budget.disabled = blocked;
      const renameLabel = member.name + "の名前を変更";
      if (row.rename.getAttribute("aria-label") !== renameLabel) row.rename.setAttribute("aria-label", renameLabel);
      row.rename.disabled = blocked;
      const removeLabel = member.name + "をメンバーから外す";
      if (row.remove.getAttribute("aria-label") !== removeLabel) row.remove.setAttribute("aria-label", removeLabel);
      row.remove.disabled = blocked;
      const budgetValue = member.budget === null ? "" : String(member.budget);
      if (document.activeElement !== row.budget && row.budget.value !== budgetValue) row.budget.value = budgetValue;
      const over = member.over > 0;
      row.remainingTile.classList.toggle("is-over-budget", over);
      row.remaining.classList.toggle("overage-badge", over);
      const remainingText = member.budget === null
        ? "未設定"
        : over
          ? format(member.over) + "オーバー"
          : format(member.remaining ?? 0);
      if (row.remaining.textContent !== remainingText) row.remaining.textContent = remainingText;
    }

    const order = totals.members.map((member) => member.memberId);
    if (order.length !== previousMemberOrder.length || order.some((id, index) => id !== previousMemberOrder[index])) {
      let cursor: ChildNode | null = memberBody.firstChild;
      for (const memberId of order) {
        const row = memberRows.get(memberId)?.element;
        if (!row) continue;
        if (row !== cursor) memberBody.insertBefore(row, cursor);
        cursor = row.nextSibling;
      }
      while (cursor) {
        const next = cursor.nextSibling;
        memberBody.removeChild(cursor);
        cursor = next;
      }
      previousMemberOrder = order;
    }
    const unassignedText = "未定 " + totals.unassignedCount + "件・" + format(totals.unassignedTotal);
    const totalText = "全体の合計 " + format(totals.total);
    if (unassignedSummary.textContent !== unassignedText) unassignedSummary.textContent = unassignedText;
    if (sharedTotalSummary.textContent !== totalText) sharedTotalSummary.textContent = totalText;
  };

  const commitBudget = () => {
    if (store.isShared()) {
      const budget = store.getState().budget;
      budgetInput.value = budget === null ? "" : String(budget);
      return;
    }
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
    const created = { element: section, heading: groupHeading, rows: groupRows, idsKey: "", ids: [], title: "" };
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
      ? "未設定"
      : spent.remaining < 0
        ? format(-spent.remaining) + "オーバー"
        : format(spent.remaining);
    summaryValues.get("points")!.value.textContent = spent.boughtQty + " / " + totals.qty;
    unknownPrice.textContent = totals.unknownPrice
      ? "価格不明 " + totals.unknownPrice + "件（合計に含まれていません）"
      : "";
    unknownBought.textContent = spent.unknownPriceBought
      ? "買ったアイテムのうち価格不明 " + spent.unknownPriceBought + "件は、購入金額に含まれていません"
      : "";
    allBought.textContent = state.items.length > 0 && spent.leftToBuy === 0
      ? "リストのアイテムはすべて買いました"
      : "";
    allBought.hidden = !allBought.textContent;
    empty.hidden = state.items.length > 0;
    routeTitle.hidden = state.items.length === 0;
    groupsRoot.hidden = state.items.length === 0;
    hideBoughtLabel.hidden = state.items.length === 0;
    actions.hidden = state.items.length === 0;
  };

  const sync = (state: AppState, sharedState: SharedStoreState | null = null) => {
    heading.textContent = store.isShared() ? "共同リスト" : "個人リスト";
    const activeShared = store.isShared() ? sharedState : null;
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
        row = cartRow(view, item, store, shared, (selected) => details.open(selected));
        rows.set(item.productId, row);
      }
      row.update(item, state.today.hideBought, !store.isSharedWriteBlocked(), activeShared);
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
          const headingChildren: Node[] = [organization, document.createTextNode(" "), boothCode];
          const placedBooth = venueLayout.booths.find((booth) => booth.code === bucket.boothCode);
          if (placedBooth && onMapBooth) {
            const mapButton = button("地図で見る", "button button-secondary cart-map-link");
            mapButton.setAttribute("aria-label", "地図で見る（" + bucket.boothCode + " " + bucket.organization + "の場所）");
            mapButton.addEventListener("click", () => onMapBooth(placedBooth.code));
            headingChildren.push(mapButton);
          }
          section.heading.replaceChildren(...headingChildren);
        }
        const idsKey = JSON.stringify(bucket.ids);
        if (section.idsKey !== idsKey) {
          section.idsKey = idsKey;
          section.ids = bucket.ids;
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
        section.ids = [];
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

    if (previousItems !== state.items || previousHideBought !== state.today.hideBought) {
      for (const section of sections.values()) {
        const sectionItems = section.ids.flatMap((id) => {
          const item = itemById.get(id);
          return item ? [item] : [];
        });
        section.element.hidden = shouldHideCartGroup(sectionItems, state.today.hideBought);
      }
    }

    const shouldUpdateTotals = previousItems !== state.items || previousBudget !== state.budget;
    if (shouldUpdateTotals) updateTotals(state);
    const sharedMode = store.isShared();
    if (previousBudget !== state.budget || previousSharedMode !== sharedMode) {
      if (document.activeElement !== budgetInput || previousSharedMode !== sharedMode) {
        budgetInput.value = state.budget === null ? "" : String(state.budget);
      }
      previousBudget = state.budget;
      previousSharedMode = sharedMode;
    }
    if (previousHideBought !== state.today.hideBought) {
      hideBoughtInput.checked = state.today.hideBought;
      previousHideBought = state.today.hideBought;
    }
    updateMemberTable(state, activeShared);
    budgetInput.readOnly = sharedMode;
    budgetInput.disabled = store.isSharedWriteBlocked();
    clearButton.disabled = store.isSharedWriteBlocked();
    confirmClear.disabled = store.isSharedWriteBlocked();
    if (previousItems !== state.items) previousItems = state.items;
    if (shouldUpdateTotals) {
      copyStatus.textContent = "";
      fallbackText.hidden = true;
    }
  };

  return { element: page, sync, ...(shared ? { setActive: shared.setActive } : {}) };
}
