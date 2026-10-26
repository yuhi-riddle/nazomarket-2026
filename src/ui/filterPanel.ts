import type { Category } from "../types.ts";
import type { DifficultyKey } from "../logic/catalog.ts";
import type { AppFilters } from "../state.ts";
import { FEATURE_TAGS } from "../logic/tags.ts";
import { button, el, labeledControl } from "./dom.ts";

const categoryOptions: Array<[Category, string]> = [
  ["kit", "持ち帰り謎キット"],
  ["booklet", "冊子"],
  ["online", "スマホ・Web謎"],
  ["goods", "グッズ"],
  ["other", "その他"],
];
const difficultyOptions: Array<[DifficultyKey, string]> = [
  [1, "1"],
  [2, "2"],
  [3, "3"],
  [4, "4"],
  [5, "5"],
  ["unknown", "不明"],
];

type FilterControls = {
  element: HTMLElement;
  sync: (filters: AppFilters) => void;
};

function checkGroup<T extends string | number>(
  legendText: string,
  values: Array<[T, string]>,
  selected: () => T[],
  onChange: (values: T[]) => void,
  showHashtag = false,
): { element: HTMLFieldSetElement; sync: () => void } {
  const fieldset = el("fieldset", "filter-group");
  fieldset.append(el("legend", "field-label", legendText));
  const inputs = values.map(([value, labelText]) => {
    const label = el("label", "check-option");
    const input = el("input");
    input.type = "checkbox";
    input.value = String(value);
    input.addEventListener("change", () => {
      const next = selected().filter((entry) => entry !== value);
      if (input.checked) next.push(value);
      onChange(next);
    });
    label.append(input);
    if (showHashtag) {
      const hash = el("span", "", "#");
      hash.setAttribute("aria-hidden", "true");
      label.append(hash);
    }
    label.append(el("span", "", labelText));
    fieldset.append(label);
    return { value, input };
  });
  return {
    element: fieldset,
    sync() {
      for (const entry of inputs) entry.input.checked = selected().includes(entry.value);
    },
  };
}

function checkboxRow(labelText: string, onChange: (value: boolean) => void): {
  element: HTMLLabelElement;
  sync: (value: boolean) => void;
} {
  const label = el("label", "check-option check-row");
  const input = el("input");
  input.type = "checkbox";
  input.addEventListener("change", () => onChange(input.checked));
  label.append(input, el("span", "", labelText));
  return { element: label, sync: (value) => { input.checked = value; } };
}

function filterControls(options: {
  includeSearch: boolean;
  areas: Array<{ id: string; label: string }>;
  onChange: (change: Partial<AppFilters>) => void;
  onClear: () => void;
}): FilterControls {
  const root = el("div", "filter-controls");
  let searchTimer: number | undefined;
  let filters: AppFilters = { q: "", priceMin: null, priceMax: null, difficulties: [], categories: [], areas: [], tags: [], newOnly: false, onlyGoingDay: false };

  let search: HTMLInputElement | undefined;
  if (options.includeSearch) {
    search = el("input", "text-input");
    search.type = "search";
    search.placeholder = "商品名・団体名で検索";
    search.autocomplete = "off";
    search.addEventListener("input", () => {
      if (searchTimer !== undefined) window.clearTimeout(searchTimer);
      const value = search?.value ?? "";
      searchTimer = window.setTimeout(() => options.onChange({ q: value }), 150);
    });
    root.append(labeledControl("キーワード", search));
  }

  const priceGroup = el("fieldset", "filter-group");
  priceGroup.append(el("legend", "field-label", "価格"));
  const priceFields = el("div", "price-fields");
  const minInput = el("input", "text-input");
  minInput.type = "number";
  minInput.min = "0";
  minInput.step = "100";
  minInput.inputMode = "numeric";
  minInput.setAttribute("aria-label", "価格の下限（円）");
  minInput.placeholder = "下限";
  const maxInput = el("input", "text-input");
  maxInput.type = "number";
  maxInput.min = "0";
  maxInput.step = "100";
  maxInput.inputMode = "numeric";
  maxInput.setAttribute("aria-label", "価格の上限（円）");
  maxInput.placeholder = "上限";
  const updatePrice = () => {
    const parseAmount = (value: string): number | null => {
      if (value === "") return null;
      const amount = Number(value);
      return Number.isFinite(amount) && amount >= 0 ? amount : null;
    };
    options.onChange({
      priceMin: parseAmount(minInput.value),
      priceMax: parseAmount(maxInput.value),
    });
  };
  minInput.addEventListener("change", updatePrice);
  maxInput.addEventListener("change", updatePrice);
  priceFields.append(minInput, el("span", "price-separator", "〜"), maxInput, el("span", "price-unit", "円"));
  priceGroup.append(priceFields);
  root.append(priceGroup);

  const difficulty = checkGroup("難易度", difficultyOptions, () => filters.difficulties, (values) => options.onChange({ difficulties: values }));
  const categories = checkGroup("カテゴリ", categoryOptions, () => filters.categories, (values) => options.onChange({ categories: values }));
  const areas = checkGroup(
    "エリア",
    options.areas.map((area): [string, string] => [area.id, area.label]),
    () => filters.areas,
    (values) => options.onChange({ areas: values }),
  );
  const tags = checkGroup("タグ", FEATURE_TAGS.map((tag): [string, string] => [tag, tag]), () => filters.tags,
    (values) => options.onChange({ tags: values }), true);
  tags.element.classList.add("filter-tag-group");
  root.append(difficulty.element, categories.element, areas.element, tags.element);

  const onlyGoingDay = checkboxRow("行く日に売るものだけ", (value) => options.onChange({ onlyGoingDay: value }));
  root.append(onlyGoingDay.element);
  const clear = button("条件をクリア", "button button-secondary clear-filters");
  clear.addEventListener("click", options.onClear);
  root.append(clear);

  return {
    element: root,
    sync(next) {
      filters = next;
      if (search && document.activeElement !== search) search.value = next.q;
      if (document.activeElement !== minInput) minInput.value = next.priceMin === null ? "" : String(next.priceMin);
      if (document.activeElement !== maxInput) maxInput.value = next.priceMax === null ? "" : String(next.priceMax);
      difficulty.sync();
      categories.sync();
      areas.sync();
      tags.sync();
      onlyGoingDay.sync(next.onlyGoingDay);
    },
  };
}

export type FilterPanel = {
  element: HTMLElement;
  dialog: HTMLDialogElement;
  openButton: HTMLButtonElement;
  sync: (filters: AppFilters, activeCount: number, shown: number, total: number) => void;
};

export function filterPanel(options: {
  areas: Array<{ id: string; label: string }>;
  onChange: (change: Partial<AppFilters>) => void;
  onClear: () => void;
}): FilterPanel {
  const aside = el("aside", "filter-panel");
  aside.append(el("h2", "section-title", "絞り込み"));
  const desktopControls = filterControls({ ...options, includeSearch: true });
  aside.append(desktopControls.element);

  const mobileOpen = button("絞り込み（0）", "button button-secondary mobile-filter-open");
  mobileOpen.addEventListener("click", () => dialog.showModal());
  const dialog = el("dialog", "filter-dialog");
  dialog.setAttribute("aria-labelledby", "filter-dialog-title");
  const sheet = el("div", "filter-sheet");
  const heading = el("h2", "section-title");
  heading.id = "filter-dialog-title";
  const mobileControls = filterControls({ ...options, includeSearch: false });
  const footer = el("div", "filter-sheet-footer");
  const apply = button("0件を表示", "button button-primary");
  apply.addEventListener("click", () => dialog.close());
  footer.append(apply);
  sheet.append(heading, mobileControls.element, footer);
  dialog.append(sheet);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    element: aside,
    dialog,
    openButton: mobileOpen,
    sync(filters, activeCount, shown, total) {
      desktopControls.sync(filters);
      mobileControls.sync(filters);
      mobileOpen.textContent = "絞り込み（" + activeCount + "）";
      heading.textContent = "絞り込み";
      apply.textContent = shown + "件を表示";
      aside.setAttribute("aria-label", "商品を絞り込む");
      aside.dataset.total = String(total);
    },
  };
}
