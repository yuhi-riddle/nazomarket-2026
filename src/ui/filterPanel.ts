import type { Category } from "../types.ts";
import type { DifficultyKey } from "../logic/catalog.ts";
import type { AppFilters } from "../state.ts";
import type { Prefs } from "../logic/insights.ts";
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
  sync: (filters: AppFilters, prefs: Prefs) => void;
};

type PreferenceChange = Partial<Omit<Prefs, "day">>;

function preferenceControls(onChange: (change: PreferenceChange) => void): {
  element: HTMLElement;
  sync: (prefs: Prefs) => void;
} {
  const root = el("section", "catalog-prefs");
  root.append(el("h3", "catalog-prefs-title", "おすすめの条件"));

  const difficultyField = el("fieldset", "catalog-prefs-difficulty");
  difficultyField.append(el("legend", "field-label", "難易度"));
  const minDifficulty = el("select", "text-input");
  const maxDifficulty = el("select", "text-input");
  for (const select of [minDifficulty, maxDifficulty]) {
    const unspecified = el("option", "", "指定なし");
    unspecified.value = "";
    select.append(unspecified);
    for (let level = 1; level <= 5; level += 1) select.append(el("option", "", String(level)));
  }
  minDifficulty.setAttribute("aria-label", "難易度の下限");
  maxDifficulty.setAttribute("aria-label", "難易度の上限");
  const difficultyValue = (value: string): Prefs["difficultyMin"] =>
    value === "" ? null : Math.min(5, Math.max(1, Number(value))) as 1 | 2 | 3 | 4 | 5;
  const changeDifficulty = () => {
    let difficultyMin = difficultyValue(minDifficulty.value);
    let difficultyMax = difficultyValue(maxDifficulty.value);
    if (difficultyMin !== null && difficultyMax !== null && difficultyMin > difficultyMax) {
      [difficultyMin, difficultyMax] = [difficultyMax, difficultyMin];
    }
    onChange({ difficultyMin, difficultyMax });
  };
  minDifficulty.addEventListener("change", changeDifficulty);
  maxDifficulty.addEventListener("change", changeDifficulty);
  const difficultyControls = el("div", "catalog-prefs-difficulty-controls");
  difficultyControls.append(
    labeledControl("下限", minDifficulty),
    el("span", "catalog-prefs-range-separator", "〜"),
    labeledControl("上限", maxDifficulty),
  );
  difficultyField.append(difficultyControls);

  let currentCategories: Category[] = [];
  const categories = checkGroup("好きなカテゴリ", categoryOptions,
    () => currentCategories, (values) => onChange({ categories: values }));

  root.append(difficultyField, categories.element);

  return {
    element: root,
    sync(prefs) {
      if (document.activeElement !== minDifficulty) minDifficulty.value = prefs.difficultyMin === null ? "" : String(prefs.difficultyMin);
      if (document.activeElement !== maxDifficulty) maxDifficulty.value = prefs.difficultyMax === null ? "" : String(prefs.difficultyMax);
      currentCategories = prefs.categories;
      categories.sync();
    },
  };
}

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

function filterControls(options: {
  includeSearch: boolean;
  onChange: (change: Partial<AppFilters>) => void;
  onClear: () => void;
  onPrefsChange: (change: PreferenceChange) => void;
}): FilterControls {
  const root = el("div", "filter-controls");
  let searchTimer: number | undefined;
  let filters: AppFilters = { q: "", priceMin: null, priceMax: null, difficulties: [], categories: [], tags: [], newOnly: false, day: null };
  const preferences = preferenceControls(options.onPrefsChange);
  root.append(preferences.element);

  let search: HTMLInputElement | undefined;
  if (options.includeSearch) {
    search = el("input", "text-input");
    search.type = "search";
  search.placeholder = "アイテム名・団体名で検索";
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
  const tags = checkGroup("タグ", FEATURE_TAGS.map((tag): [string, string] => [tag, tag]), () => filters.tags,
    (values) => options.onChange({ tags: values }), true);
  tags.element.classList.add("filter-tag-group");
  root.append(difficulty.element, categories.element, tags.element);

  const daySelect = el("select", "text-input");
  daySelect.setAttribute("aria-label", "出展日");
  for (const [value, text] of [["", "すべて"], ["sat", "土曜に出展"], ["sun", "日曜に出展"]]) {
    const option = el("option", "", text);
    option.value = value;
    daySelect.append(option);
  }
  daySelect.addEventListener("change", () => options.onChange({ day: daySelect.value === "sat" || daySelect.value === "sun" ? daySelect.value : null }));
  root.append(labeledControl("出展日", daySelect));
  const clear = button("条件をクリア", "button button-secondary clear-filters");
  clear.addEventListener("click", options.onClear);
  root.append(clear);

  return {
    element: root,
    sync(next, prefs) {
      filters = next;
      preferences.sync(prefs);
      if (search && document.activeElement !== search) search.value = next.q;
      if (document.activeElement !== minInput) minInput.value = next.priceMin === null ? "" : String(next.priceMin);
      if (document.activeElement !== maxInput) maxInput.value = next.priceMax === null ? "" : String(next.priceMax);
      difficulty.sync();
      categories.sync();
      tags.sync();
      daySelect.value = next.day ?? "";
    },
  };
}

export type FilterPanel = {
  element: HTMLElement;
  dialog: HTMLDialogElement;
  openButton: HTMLButtonElement;
  sync: (filters: AppFilters, activeCount: number, shown: number, total: number, prefs: Prefs) => void;
};

export function filterPanel(options: {
  onChange: (change: Partial<AppFilters>) => void;
  onClear: () => void;
  onPrefsChange: (change: PreferenceChange) => void;
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
    sync(filters, activeCount, shown, total, prefs) {
      desktopControls.sync(filters, prefs);
      mobileControls.sync(filters, prefs);
      mobileOpen.textContent = "絞り込み（" + activeCount + "）";
      heading.textContent = "絞り込み";
      apply.textContent = shown + "件を表示";
  aside.setAttribute("aria-label", "アイテムを絞り込む");
      aside.dataset.total = String(total);
    },
  };
}
