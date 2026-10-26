import type { SortKey } from "../logic/catalog.ts";
import { countActiveFilters, emptyFilters, filterCatalog, sortCatalog } from "../logic/catalog.ts";
import { setQty, toggleItem, type CartItem } from "../logic/cart.ts";
import type { AppState } from "../state.ts";
import { catalog } from "../data.ts";
import { button, el } from "./dom.ts";
import { filterPanel } from "./filterPanel.ts";
import { productCard, type ProductCardHandle } from "./productCard.ts";
import { productDialog } from "./productDialog.ts";
import type { AppStore } from "../store.ts";
import { venueLayout } from "../data.ts";

const sortOptions: Array<[SortKey, string]> = [
  ["booth", "ブース順"],
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

export type CatalogView = {
  element: HTMLElement;
  sync: (state: AppState) => void;
  updateItems: (items: CartItem[]) => void;
};

export function catalogView(store: AppStore): CatalogView {
  const page = el("section", "catalog-page");
  const filters = filterPanel({
    areas: venueLayout.areas,
    onChange(change) {
      store.update((state) => ({ ...state, filters: { ...state.filters, ...change } }));
    },
    onClear() {
      store.update((state) => ({ ...state, filters: { ...emptyFilters, onlyGoingDay: false } }));
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
  sortSelect.setAttribute("aria-label", "並び替え");
  for (const [value, labelText] of sortOptions) {
    const option = el("option", "", labelText);
    option.value = value;
    sortSelect.append(option);
  }
  sortSelect.addEventListener("change", () => {
    store.update((state) => ({ ...state, sort: sortSelect.value as SortKey }));
  });
  const sortField = el("label", "sort-field");
  sortField.append(el("span", "", "並び替え"), sortSelect);
  toolbar.append(mobileSearch, filters.openButton, count, sortField);

  const resultRegion = el("div", "catalog-results");
  const grid = el("div", "product-grid");
  const empty = el("div", "empty-state");
  resultRegion.append(grid);
  main.append(toolbar, resultRegion);
  page.append(filters.element, main, filters.dialog);
  const details = productDialog("catalog");
  page.append(details.element);

  const handles = new Map<string, ProductCardHandle>();
  let lastItemById = new Map<string, CartItem>();
  const showEmpty = (visible: boolean) => {
    if (!visible) {
      empty.remove();
      return;
    }
    empty.replaceChildren(el("p", "", "条件に合う商品がありません"));
    const clear = button("条件をクリア", "button button-secondary");
    clear.addEventListener("click", () => {
      store.update((state) => ({ ...state, filters: { ...emptyFilters, onlyGoingDay: false } }));
    });
    empty.append(clear);
    resultRegion.append(empty);
  };

  const renderList = (state: AppState) => {
    const catalogFilters = {
      ...state.filters,
      day: state.filters.onlyGoingDay ? state.day : null,
    };
    const filtered = sortCatalog(filterCatalog(catalog, catalogFilters), state.sort);
    count.textContent = filtered.length + "件 / " + catalog.length + "件";
    sortSelect.value = state.sort;
    if (document.activeElement !== mobileSearch) mobileSearch.value = state.filters.q;
    filters.sync(state.filters, countActiveFilters(catalogFilters), filtered.length, catalog.length);
    handles.clear();
    grid.replaceChildren();
    showEmpty(filtered.length === 0);
    if (!filtered.length) return;

    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    lastItemById = itemById;
    const fragment = document.createDocumentFragment();
    for (const view of filtered) {
      const handle = productCard(view, itemById.get(view.product.id), {
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
      fragment.append(handle.element);
    }
    grid.append(fragment);
  };

  return {
    element: page,
    sync: renderList,
    updateItems(items) {
      const itemById = new Map(items.map((item): [string, CartItem] => [item.productId, item]));
      for (const [id, handle] of handles) {
        const nextItem = itemById.get(id);
        if (!sameCartItem(lastItemById.get(id), nextItem)) handle.update(nextItem);
      }
      lastItemById = itemById;
    },
  };
}
