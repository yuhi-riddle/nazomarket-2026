import type { SortKey, ProductView, Filters } from "../logic/catalog.ts";
import { countActiveFilters, emptyFilters, filterCatalog, sortCatalog } from "../logic/catalog.ts";
import { cartTotals, setQty, toggleItem, type CartItem } from "../logic/cart.ts";
import { rankForCatalog } from "../logic/insights.ts";
import type { AppState } from "../state.ts";
import { catalog, productById } from "../data.ts";
import { button, el } from "./dom.ts";
import { filterPanel } from "./filterPanel.ts";
import { productCard, type ProductCardHandle } from "./productCard.ts";
import { productDialog } from "./productDialog.ts";
import type { AppStore } from "../store.ts";

const sortOptions: Array<[SortKey, string]> = [
  ["recommended", "おすすめ順"],
  ["booth", "ブース順"],
  ["organization", "団体順"],
  ["priceAsc", "価格の安い順"],
  ["priceDesc", "価格の高い順"],
  ["difficultyAsc", "難易度の低い順"],
  ["difficultyDesc", "難易度の高い順"],
];

function sameCartItem(a: CartItem | undefined, b: CartItem | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.productId === b.productId
    && a.qty === b.qty
    && a.bought === b.bought);
}

type CatalogGroup = {
  element: HTMLDetailsElement;
  summary: HTMLElement;
  organization: HTMLElement;
  boothCode: HTMLElement;
  count: HTMLElement;
  products: HTMLElement;
};

export type CatalogView = {
  element: HTMLElement;
  sync: (state: AppState) => void;
  updateItems: (items: CartItem[], state: AppState) => void;
};

export function catalogView(store: AppStore): CatalogView {
  const page = el("section", "catalog-page");
  const filters = filterPanel({
    onChange(change) {
      store.update((state) => ({ ...state, filters: { ...state.filters, ...change } }));
    },
    onClear() {
      store.update((state) => ({ ...state, filters: { ...emptyFilters } }));
    },
    onPrefsChange(change) {
      store.update((state) => {
        const prefs = { ...state.prefs, ...change, day: null };
        if (change.budgetFromCart === false && state.prefs.budgetFromCart && state.prefs.budget === null) {
          prefs.budget = state.budget;
        }
        return { ...state, prefs, sort: "recommended" };
      });
    },
  });

  const main = el("div", "catalog-main");
  const toolbar = el("div", "catalog-toolbar");
  const mobileSearch = el("input", "text-input mobile-search");
  mobileSearch.type = "search";
  mobileSearch.setAttribute("aria-label", "キーワード");
  mobileSearch.placeholder = "商品名・団体名で検索";
  mobileSearch.autocomplete = "off";
  let searchTimer: number | undefined;
  mobileSearch.addEventListener("input", () => {
    if (searchTimer !== undefined) window.clearTimeout(searchTimer);
    const value = mobileSearch.value;
    searchTimer = window.setTimeout(() => {
      store.update((state) => ({ ...state, filters: { ...state.filters, q: value } }));
    }, 150);
  });
  filters.openButton.classList.add("toolbar-filter-button");
  const count = el("p", "result-count");
  count.setAttribute("aria-live", "polite");
  count.tabIndex = -1;
  const sortSelect = el("select", "text-input sort-select");
  sortSelect.setAttribute("aria-label", "並び順");
  for (const [value, labelText] of sortOptions) {
    const option = el("option", "", labelText);
    option.value = value;
    sortSelect.append(option);
  }
  sortSelect.addEventListener("change", () => {
    store.update((state) => ({ ...state, sort: sortSelect.value as SortKey }));
  });
  const sortField = el("label", "sort-field");
  sortField.append(el("span", "", "並び順"), sortSelect);
  const groupActions = el("div", "catalog-group-actions");
  const closeAll = button("すべて閉じる", "button button-secondary");
  const openAll = button("すべて開く", "button button-secondary");
  closeAll.addEventListener("click", () => {
    for (const group of groups.values()) group.element.open = false;
  });
  openAll.addEventListener("click", () => {
    for (const group of groups.values()) group.element.open = true;
  });
  groupActions.append(closeAll, openAll);
  toolbar.append(mobileSearch, filters.openButton, count, sortField, groupActions);

  const resultRegion = el("div", "catalog-results");
  const recommendationHint = el("p", "recommendation-hint", "リストに入れた商品のカテゴリ・難易度と、設定した好みや残り予算を参考に並べます。");
  recommendationHint.hidden = true;
  const grid = el("div", "product-grid");
  const empty = el("div", "empty-state");
  resultRegion.append(grid);
  main.append(toolbar, recommendationHint, resultRegion);
  page.append(filters.element, main, filters.dialog);
  const details = productDialog("catalog");
  page.append(details.element);

  const handles = new Map<string, ProductCardHandle>();
  const groups = new Map<string, CatalogGroup>();
  let lastItemById = new Map<string, CartItem>();
  let lastFilters: AppState["filters"] | undefined;
  let lastSort: SortKey | undefined;
  let lastDay: AppState["day"] | undefined;
  let lastShown = 0;
  let rankedPrefs: AppState["prefs"] | undefined;
  let rankedDay: AppState["filters"]["day"] | undefined;
  let rankedBudget: number | null | undefined;
  let rankedCartKey = "";
  let rankedCatalog: ReturnType<typeof rankForCatalog> | undefined;

  const listBudget = (state: AppState): number | null => {
    if (state.budget === null) return null;
    const spent = cartTotals(state.items, (id) => productById.get(id)?.price ?? null).amount;
    return state.budget - spent;
  };

  const syncFilterControls = (state: AppState, filtersWithDay: Filters, shown: number) => {
    filters.sync(
      state.filters,
      countActiveFilters(filtersWithDay),
      shown,
      catalog.length,
      state.prefs,
      listBudget(state),
    );
  };

  const getGroup = (view: ProductView): CatalogGroup => {
    const key = view.booth.id;
    const existing = groups.get(key);
    if (existing) return existing;
    const element = el("details", "catalog-group");
    element.open = true;
    const summary = el("summary", "catalog-group-summary");
    const organization = el("strong", "catalog-group-organization", view.booth.name);
    const boothCode = el("small", "catalog-group-booth", view.booth.boothCode ?? "未定");
    const count = el("span", "catalog-group-count");
    summary.append(organization, boothCode, count);
    const products = el("div", "catalog-group-products product-grid");
    element.append(summary, products);
    const group = { element, summary, organization, boothCode, count, products };
    groups.set(key, group);
    return group;
  };

  const getHandle = (view: ProductView, state: AppState): ProductCardHandle => {
    const existing = handles.get(view.product.id);
    if (existing) return existing;
    const handle = productCard(view, undefined, {
      onDetail: (selected) => details.open(selected),
      onFeatureTag(tag, productId) {
        store.update((current) => {
          const tags = current.filters.tags.includes(tag)
            ? current.filters.tags.filter((selected) => selected !== tag)
            : [...current.filters.tags, tag];
          return { ...current, filters: { ...current.filters, tags } };
        });
        const buttons = handles.get(productId)?.element.querySelectorAll<HTMLButtonElement>(".tag-button");
        const focusTarget = buttons
          ? Array.from(buttons).find((tagButton) => tagButton.dataset.featureTag === tag)
          : undefined;
        if (focusTarget) focusTarget.focus();
        else count.focus();
      },
      selectedTags: state.filters.tags,
      onToggle(productId) {
        store.update((current) => ({ ...current, items: toggleItem(current.items, productId) }));
        handles.get(productId)?.element.querySelector<HTMLButtonElement>(".list-toggle")?.focus();
      },
      onQty(productId, qty) {
        store.update((current) => ({ ...current, items: setQty(current.items, productId, qty) }));
      },
    });
    handles.set(view.product.id, handle);
    return handle;
  };

  const showEmpty = (visible: boolean) => {
    if (!visible) {
      empty.remove();
      return;
    }
    empty.replaceChildren(el("p", "", "条件に合う商品はありません"));
    const clear = button("絞り込みをクリア", "button button-secondary");
    clear.addEventListener("click", () => {
      store.update((state) => ({ ...state, filters: { ...emptyFilters } }));
    });
    empty.append(clear);
    resultRegion.append(empty);
  };

  const renderList = (state: AppState) => {
    const filtersWithDay = state.filters;
    const filtered = filterCatalog(catalog, filtersWithDay);
    let ordered: ProductView[];
    let reasonsById = new Map<string, string[]>();
    let otherStart = -1;
    if (state.sort === "recommended") {
      const visibleIds = new Set(filtered.map((view) => view.product.id));
      const budget = state.prefs.budgetFromCart ? state.budget : state.prefs.budget;
      const cartKey = JSON.stringify(state.items
        .map((item) => [item.productId, item.qty] as const)
        .sort(([a], [b]) => a.localeCompare(b)));
      if (rankedPrefs !== state.prefs || rankedDay !== state.filters.day || rankedBudget !== budget || rankedCartKey !== cartKey) {
        rankedCatalog = rankForCatalog(catalog, { ...state.prefs, day: state.filters.day }, state.items, budget);
        rankedPrefs = state.prefs;
        rankedDay = state.filters.day;
        rankedBudget = budget;
        rankedCartKey = cartKey;
      }
      const matched = (rankedCatalog?.matched ?? []).filter((item) => visibleIds.has(item.view.product.id));
      const others = (rankedCatalog?.others ?? []).filter((view) => visibleIds.has(view.product.id));
      for (const item of matched) reasonsById.set(item.view.product.id, item.reasons);
      ordered = [...matched.map((item) => item.view), ...others];
      otherStart = matched.length;
    } else {
      ordered = sortCatalog(filtered, state.sort);
    }

    count.textContent = ordered.length + "件 / " + catalog.length + "件";
    recommendationHint.hidden = state.sort !== "recommended";
    sortSelect.value = state.sort;
    groupActions.hidden = state.sort !== "booth" && state.sort !== "organization";
    if (document.activeElement !== mobileSearch) mobileSearch.value = state.filters.q;
    syncFilterControls(state, filtersWithDay, ordered.length);
    lastShown = ordered.length;
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    lastItemById = itemById;
    const filtersOrSortChanged = lastFilters !== state.filters || lastSort !== state.sort || lastDay !== state.day;

    showEmpty(ordered.length === 0);
    grid.replaceChildren();
    if (state.sort === "booth" || state.sort === "organization") {
      const byBooth = new Map<string, ProductView[]>();
      for (const view of ordered) {
        const bucket = byBooth.get(view.booth.id) ?? [];
        bucket.push(view);
        byBooth.set(view.booth.id, bucket);
      }
      for (const views of byBooth.values()) {
        const group = getGroup(views[0]);
        group.organization.textContent = views[0].booth.name;
        group.boothCode.textContent = views[0].booth.boothCode ?? "未定";
        group.count.textContent = views.length + "件";
        if (filtersOrSortChanged) group.element.open = true;
        group.products.replaceChildren();
        for (const view of views) {
          const handle = getHandle(view, state);
          handle.update(itemById.get(view.product.id), reasonsById.get(view.product.id) ?? [], state.filters.tags);
          group.products.append(handle.element);
        }
        grid.append(group.element);
      }
    } else {
      for (let index = 0; index < ordered.length; index += 1) {
        if (index === otherStart) grid.append(el("h3", "catalog-other-heading", "ほかの商品"));
        const view = ordered[index];
        const handle = getHandle(view, state);
        handle.update(itemById.get(view.product.id), reasonsById.get(view.product.id) ?? [], state.filters.tags);
        grid.append(handle.element);
      }
    }
    lastFilters = state.filters;
    lastSort = state.sort;
    lastDay = state.day;
  };

  return {
    element: page,
    sync: renderList,
    updateItems(items, state) {
      const itemById = new Map(items.map((item): [string, CartItem] => [item.productId, item]));
      for (const [id, handle] of handles) {
        const nextItem = itemById.get(id);
        if (!sameCartItem(lastItemById.get(id), nextItem)) handle.update(nextItem);
      }
      lastItemById = itemById;
      syncFilterControls(state, state.filters, lastShown);
    },
  };
}
