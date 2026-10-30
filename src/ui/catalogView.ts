import type { SortKey, ProductView, Filters } from "../logic/catalog.ts";
import { countActiveFilters, emptyFilters, filterCatalog, sortCatalog } from "../logic/catalog.ts";
import { splitUnknownDifficulty } from "../logic/difficultyGroups.ts";
import { splitUnknownPrice } from "../logic/priceGroups.ts";
import { setQty, toggleItem, type CartItem } from "../logic/cart.ts";
import { rankForCatalog } from "../logic/insights.ts";
import { hasRecommendationBasis } from "../logic/recommendationBasis.ts";
import type { AppState } from "../state.ts";
import { catalog } from "../data.ts";
import { button, el } from "./dom.ts";
import { filterPanel } from "./filterPanel.ts";
import { productCard, type ProductCardHandle } from "./productCard.ts";
import { productDialog } from "./productDialog.ts";
import type { AppStore, SharedStoreState } from "../store.ts";

const sortOptions: Array<[SortKey, string]> = [
  ["recommended", "おすすめ順"],
  ["booth", "配置順（ブース番号）"],
  ["organization", "団体名順（五十音）"],
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
  sync: (state: AppState, shared?: SharedStoreState | null) => void;
  updateItems: (items: CartItem[], state: AppState) => void;
};

export function catalogView(store: AppStore, onMapBooth?: (boothCode: string) => void): CatalogView {
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
        return { ...state, prefs, sort: "recommended" };
      });
    },
  });

  const main = el("div", "catalog-main");
  const toolbar = el("div", "catalog-toolbar");
  const mobileSearch = el("input", "text-input mobile-search");
  mobileSearch.type = "search";
  mobileSearch.setAttribute("aria-label", "キーワード");
  mobileSearch.placeholder = "アイテム名・団体名で検索";
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
  const recommendationHint = el("p", "recommendation-hint", "リストに入れたアイテムや、指定がある場合はおすすめの条件・残り予算を参考に、最大10件表示します。すべてのアイテムは並び順を変えると見られます。");
  recommendationHint.hidden = true;
  const grid = el("div", "product-grid");
  const makeUnknownSection = (kind: "difficulty" | "price", title: string) => {
    const section = el("section", "catalog-unknown-" + kind);
    const heading = el("div", "catalog-unknown-" + kind + "-heading");
    const count = el("span", "catalog-group-count");
    const products = el("div", "catalog-unknown-" + kind + "-products product-grid");
    heading.append(el("h3", "catalog-unknown-" + kind + "-title", title), count);
    section.append(heading, products);
    return { section, count, products };
  };
  const unknownDifficulty = makeUnknownSection("difficulty", "難易度不明");
  const unknownPrice = makeUnknownSection("price", "価格不明");
  const empty = el("div", "empty-state");
  resultRegion.append(grid);
  main.append(toolbar, recommendationHint, resultRegion);
  page.append(filters.element, main, filters.dialog);
  const details = productDialog("catalog", onMapBooth);
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

  const syncFilterControls = (state: AppState, filtersWithDay: Filters, shown: number) => {
    filters.sync(
      state.filters,
      countActiveFilters(filtersWithDay),
      shown,
      catalog.length,
      state.prefs,
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
    const chevron = el("span", "catalog-group-chevron");
    chevron.setAttribute("aria-hidden", "true");
    summary.append(organization, boothCode, count, chevron);
    const products = el("div", "catalog-group-products product-grid");
    element.append(summary, products);
    const group = { element, summary, organization, boothCode, count, products };
    groups.set(key, group);
    return group;
  };

  const getHandle = (view: ProductView): ProductCardHandle => {
    const existing = handles.get(view.product.id);
    if (existing) return existing;
    const handle = productCard(view, undefined, {
      showBoothLocation: true,
      onDetail: (selected) => details.open(selected),
      canChangeList: () => !store.isSharedWriteBlocked(),
      onToggle(productId) {
        const current = store.getState();
        const adding = !current.items.some((item) => item.productId === productId);
        const cardOrder = current.sort === "recommended"
          ? [...resultRegion.querySelectorAll<HTMLElement>(".product-card")]
            .map((card) => card.dataset.productId)
            .filter((id): id is string => id !== undefined)
          : [];
        const cardIndex = cardOrder.indexOf(productId);
        const focusCandidates = cardIndex < 0
          ? []
          : [...cardOrder.slice(cardIndex + 1), ...cardOrder.slice(0, cardIndex).reverse()];
        const card = handles.get(productId)?.element;
        store.update((current) => ({ ...current, items: toggleItem(current.items, productId) }));
        if (adding && current.sort === "recommended" && card && !card.isConnected) {
          const nextId = focusCandidates.find((id) => {
            const candidate = handles.get(id)?.element;
            return candidate !== undefined && resultRegion.contains(candidate);
          });
          if (nextId) handles.get(nextId)?.element.querySelector<HTMLButtonElement>(".product-name")?.focus();
          else sortSelect.focus();
        } else {
          handles.get(productId)?.element.querySelector<HTMLButtonElement>(".list-toggle")?.focus();
        }
      },
      onQty(productId, qty) {
        store.update((current) => ({ ...current, items: setQty(current.items, productId, qty) }));
      },
    });
    handles.set(view.product.id, handle);
    return handle;
  };

  const showEmpty = (visible: boolean, recommended: boolean) => {
    if (!visible) {
      empty.remove();
      return;
    }
    empty.replaceChildren(el("p", "", recommended ? "条件に合うおすすめはありません。並び順を変えると、ほかのアイテムも見られます。" : "条件に合うアイテムはありません"));
    const clear = button("絞り込みをクリア", "button button-secondary");
    clear.addEventListener("click", () => {
      store.update((state) => ({ ...state, filters: { ...emptyFilters } }));
    });
    empty.append(clear);
    resultRegion.append(empty);
  };

  const renderList = (state: AppState, shared: SharedStoreState | null = null) => {
    const filtersWithDay = state.filters;
    const filtered = filterCatalog(catalog, filtersWithDay);
    let ordered: ProductView[];
    let reasonsById = new Map<string, string[]>();
    let hasRecommendation = true;
    if (state.sort === "recommended") {
      const sharedMode = store.isShared();
      const me = sharedMode && shared !== null && shared.meId !== null
        ? shared.members.find((member) => member.id === shared.meId)
        : undefined;
      const budget = sharedMode ? me?.budgetYen ?? null : state.budget;
      const budgetItems = sharedMode
        ? me
          ? state.items.filter((item) => shared?.ownerByProductId.get(item.productId) === me.id)
          : []
        : state.items;
      hasRecommendation = hasRecommendationBasis(state.items, state.prefs, budget);
      if (!hasRecommendation) {
        ordered = [];
      } else {
        const visibleIds = new Set(filtered.map((view) => view.product.id));
        const cartKey = JSON.stringify(state.items
          .map((item) => [item.productId, item.qty] as const)
          .sort(([a], [b]) => a.localeCompare(b)));
        const budgetCartKey = JSON.stringify(budgetItems
          .map((item) => [item.productId, item.qty] as const)
          .sort(([a], [b]) => a.localeCompare(b)));
        const rankedItemsKey = JSON.stringify([cartKey, budgetCartKey]);
        if (rankedPrefs !== state.prefs || rankedDay !== state.filters.day || rankedBudget !== budget || rankedCartKey !== rankedItemsKey) {
          rankedCatalog = rankForCatalog(catalog, { ...state.prefs, day: state.filters.day }, state.items, budgetItems, budget);
          rankedPrefs = state.prefs;
          rankedDay = state.filters.day;
          rankedBudget = budget;
          rankedCartKey = rankedItemsKey;
        }
        const matched = (rankedCatalog?.matched ?? []).filter((item) => visibleIds.has(item.view.product.id)).slice(0, 10);
        for (const item of matched) reasonsById.set(item.view.product.id, item.reasons);
        ordered = matched.map((item) => item.view);
      }
    } else {
      ordered = sortCatalog(filtered, state.sort);
    }
    const difficultySort = state.sort === "difficultyAsc" || state.sort === "difficultyDesc";
    const priceGrouping = !difficultySort && (
      state.sort === "priceAsc"
      || state.sort === "priceDesc"
      || filtersWithDay.priceMin !== null
      || filtersWithDay.priceMax !== null
    );
    const productGroups = difficultySort
      ? splitUnknownDifficulty(ordered)
      : priceGrouping
        ? splitUnknownPrice(ordered)
        : { known: ordered, unknown: [] as ProductView[] };
    const unknownGroup = difficultySort ? unknownDifficulty : priceGrouping ? unknownPrice : null;

    count.textContent = !hasRecommendation ? "0件 / " + catalog.length + "件" : ordered.length + "件 / " + catalog.length + "件";
    recommendationHint.hidden = state.sort !== "recommended" || !hasRecommendation;
    sortSelect.value = state.sort;
    groupActions.hidden = state.sort !== "booth" && state.sort !== "organization";
    if (document.activeElement !== mobileSearch) mobileSearch.value = state.filters.q;
    syncFilterControls(state, filtersWithDay, ordered.length);
    lastShown = ordered.length;
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    lastItemById = itemById;
    const filtersOrSortChanged = lastFilters !== state.filters || lastSort !== state.sort || lastDay !== state.day;

    showEmpty(ordered.length === 0, state.sort === "recommended");
    if (state.sort === "recommended" && !hasRecommendation) {
      empty.replaceChildren(el("p", "", "リストにアイテムを入れるか、おすすめの条件（予算・難易度・カテゴリ）を指定すると、おすすめが出ます。"));
    }
    grid.replaceChildren();
    unknownDifficulty.products.replaceChildren();
    unknownDifficulty.section.remove();
    unknownPrice.products.replaceChildren();
    unknownPrice.section.remove();
    if (state.sort === "booth" || state.sort === "organization") {
      const byBooth = new Map<string, ProductView[]>();
      for (const view of productGroups.known) {
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
          const handle = getHandle(view);
          handle.update(itemById.get(view.product.id), reasonsById.get(view.product.id) ?? []);
          group.products.append(handle.element);
        }
        grid.append(group.element);
      }
    } else {
      for (const view of productGroups.known) {
        const handle = getHandle(view);
        handle.update(itemById.get(view.product.id), reasonsById.get(view.product.id) ?? []);
        grid.append(handle.element);
      }
    }
    if (unknownGroup && productGroups.unknown.length > 0) {
      unknownGroup.count.textContent = productGroups.unknown.length + "件";
      for (const view of productGroups.unknown) {
        const handle = getHandle(view);
        handle.update(itemById.get(view.product.id), reasonsById.get(view.product.id) ?? []);
        unknownGroup.products.append(handle.element);
      }
      resultRegion.append(unknownGroup.section);
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
