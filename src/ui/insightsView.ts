import { catalog, products, productById, venueLayout } from "../data.ts";
import {
  cartTotals,
  setQty,
  toggleItem,
  type CartItem,
} from "../logic/cart.ts";
import { areaMatchCounts, recommend, SCORE_RULES, type Prefs, type Scored } from "../logic/insights.ts";
import type { AppState } from "../state.ts";
import type { Category, Day } from "../types.ts";
import { CATEGORY_NAMES } from "../logic/catalog.ts";
import type { AppStore } from "../store.ts";
import { button, el, labeledControl } from "./dom.ts";
import { insightsCharts } from "./insightsCharts.ts";
import { productCard } from "./productCard.ts";
import { productDialog } from "./productDialog.ts";
import { venueMap, type BoothPaint, type VenueMapElement } from "./venueMap.ts";

const categoryOrder: Category[] = ["kit", "booklet", "online", "goods", "other"];
const dayNames: Record<Day, string> = { sat: "土曜 11/7", sun: "日曜 11/8" };
const difficultyLevels = [1, 2, 3, 4, 5] as const;
const playStyleNames: Record<Prefs["playStyle"], string> = {
  onsite: "その場で遊ぶ",
  takeHome: "持ち帰って遊ぶ",
  any: "どちらでも",
};

function remainingBudget(state: AppState): number | null {
  if (state.budget === null) return null;
  const totals = cartTotals(state.items, (id) => productById.get(id)?.price ?? null);
  return Math.max(0, state.budget - totals.amount);
}

function difficultyValue(value: string): Prefs["difficultyMin"] {
  if (value === "") return null;
  const number = Number(value);
  return difficultyLevels.includes(number as (typeof difficultyLevels)[number])
    ? number as Prefs["difficultyMin"]
    : null;
}

function scoreRulesTable(): HTMLElement {
  const section = el("section", "insights-rules");
  section.append(el("h3", "insights-subtitle", "点数の付け方"));
  const table = document.createElement("table");
  table.className = "insights-data-table";
  table.setAttribute("aria-label", "おすすめの点数の付け方");
  const head = document.createElement("thead");
  const header = document.createElement("tr");
  for (const label of ["条件", "点数"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    header.append(cell);
  }
  head.append(header);
  const body = document.createElement("tbody");
  for (const rule of SCORE_RULES) {
    const row = document.createElement("tr");
    const label = document.createElement("td");
    label.textContent = rule.label;
    const points = document.createElement("td");
    points.textContent = rule.points;
    row.append(label, points);
    body.append(row);
  }
  table.append(head, body);
  section.append(table);
  return section;
}

function categoryPreferences(
  onChange: (categories: Category[]) => void,
): { element: HTMLFieldSetElement; sync: (categories: Category[]) => void } {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "insights-preference-group insights-category-preference";
  const legend = document.createElement("legend");
  legend.className = "field-label";
  legend.textContent = "カテゴリ";
  fieldset.append(legend);
  const inputs = new Map<Category, HTMLInputElement>();
  for (const category of categoryOrder) {
    const input = el("input");
    input.type = "checkbox";
    input.value = category;
    const label = el("label", "check-option");
    label.append(input, el("span", "", CATEGORY_NAMES[category]));
    inputs.set(category, input);
    fieldset.append(label);
  }
  for (const input of inputs.values()) {
    input.addEventListener("change", () => {
      onChange(categoryOrder.filter((category) => inputs.get(category)?.checked));
    });
  }
  return {
    element: fieldset,
    sync(categories) {
      for (const category of categoryOrder) {
        const input = inputs.get(category);
        if (input) input.checked = categories.includes(category);
      }
    },
  };
}

export type InsightsView = { element: HTMLElement; sync: (state: AppState) => void };

export function insightsView(store: AppStore): InsightsView {
  const page = el("section", "insights-page");
  page.append(insightsCharts(products));

  const recommendationsSection = el("section", "insights-recommendations-section");
  recommendationsSection.append(el("h2", "section-title", "好みに合うおすすめ"));
  const preferences = el("div", "insights-preferences");

  const budgetInput = el("input", "text-input insights-budget-input");
  budgetInput.type = "number";
  budgetInput.min = "0";
  budgetInput.step = "1";
  budgetInput.inputMode = "numeric";
  budgetInput.placeholder = "指定なし";
  budgetInput.setAttribute("aria-label", "おすすめの予算");
  const budgetControl = el("div", "insights-budget-control");
  const budgetUnit = el("span", "insights-budget-unit", "円まで");
  budgetControl.append(budgetInput, budgetUnit);
  const budgetField = el("div", "field");
  budgetField.append(el("span", "field-label", "予算"), budgetControl);
  const useRemainingBudget = button("残り予算を使う", "button button-secondary insights-use-remaining-budget");
  useRemainingBudget.addEventListener("click", () => {
    store.update((state) => ({ ...state, prefs: { ...state.prefs, budget: null, budgetFromCart: true, day: null } }));
  });
  budgetField.append(useRemainingBudget);

  const minDifficulty = el("select", "text-input");
  const maxDifficulty = el("select", "text-input");
  for (const select of [minDifficulty, maxDifficulty]) {
    const unset = el("option", "", "指定なし");
    unset.value = "";
    select.append(unset);
    for (const level of difficultyLevels) {
      const option = el("option", "", String(level));
      option.value = String(level);
      select.append(option);
    }
  }
  minDifficulty.setAttribute("aria-label", "難易度の下限");
  maxDifficulty.setAttribute("aria-label", "難易度の上限");
  const difficultyField = el("div", "field insights-difficulty-field");
  difficultyField.append(el("span", "field-label", "難易度の範囲"));
  const difficultyControls = el("div", "insights-difficulty-controls");
  const minLabel = el("label", "insights-select-label");
  minLabel.append(el("span", "sr-only", "難易度の下限"), minDifficulty);
  const maxLabel = el("label", "insights-select-label");
  maxLabel.append(el("span", "sr-only", "難易度の上限"), maxDifficulty);
  difficultyControls.append(minLabel, el("span", "insights-range-separator", "〜"), maxLabel);
  difficultyField.append(difficultyControls);

  const categoryField = categoryPreferences((categories) => {
    store.update((state) => ({ ...state, prefs: { ...state.prefs, categories, day: null } }));
  });
  const playStyleSelect = el("select", "text-input");
  for (const style of ["onsite", "takeHome", "any"] as const) {
    const option = el("option", "", playStyleNames[style]);
    option.value = style;
    playStyleSelect.append(option);
  }
  playStyleSelect.setAttribute("aria-label", "遊び方");
  const playStyleField = labeledControl("遊び方", playStyleSelect);
  const dayNote = el("p", "insights-day-note");
  dayNote.setAttribute("aria-live", "polite");
  preferences.append(budgetField, difficultyField, categoryField.element, playStyleField, dayNote);
  recommendationsSection.append(preferences);

  const excludedNote = el("p", "insights-excluded-note",
    "リストに入っている商品・予算を超える商品・行く日に売っていない商品・0点以下の商品は出しません。価格が不明な商品は予算で除外しません。",
  );
  recommendationsSection.append(excludedNote, scoreRulesTable());
  const resultCount = el("p", "insights-result-count");
  resultCount.setAttribute("role", "status");
  resultCount.setAttribute("aria-live", "polite");
  const recommendationCards = el("div", "insights-recommendation-grid");
  const noRecommendations = el("p", "insights-no-recommendations", "条件に合うおすすめはありません。好みを調整してみてください。");
  noRecommendations.hidden = true;
  noRecommendations.tabIndex = -1;
  recommendationsSection.append(resultCount, recommendationCards, noRecommendations);
  page.append(recommendationsSection);

  const areaSection = el("section", "insights-area-section");
  areaSection.append(el("h2", "section-title", "好みに合う商品が多いエリア"));
  const areaSummary = el("p", "insights-area-summary");
  areaSummary.setAttribute("role", "status");
  const areaLayout = el("div", "insights-area-layout");
  const areaMapFrame = el("div", "insights-area-map-frame");
  areaMapFrame.setAttribute("role", "region");
  areaMapFrame.setAttribute("aria-label", "好みに合う商品のエリア別マップ");
  const areaLegend = el("div", "insights-area-legend");
  areaLegend.setAttribute("role", "group");
  areaLegend.setAttribute("aria-label", "合う商品の数");
  for (const [count, label] of [[0, "0"], [1, "1"], [2, "2"], [3, "3以上"]] as const) {
    const entry = el("span", "insights-area-legend-entry");
    entry.append(el("span", "insights-area-swatch insights-area-swatch-" + count), el("span", "", label));
    areaLegend.append(entry);
  }
  const areaAside = el("div", "insights-area-aside");
  areaAside.append(el("p", "insights-area-legend-title", "合う商品の数"), areaLegend);
  areaLayout.append(areaMapFrame, areaAside);
  areaSection.append(areaSummary, areaLayout);
  page.append(areaSection);

  const details = productDialog("insights");
  page.append(details.element);

  let budgetInitialized = false;
  let previousPrefs: Prefs | undefined;
  let previousDay: Day | undefined;
  let previousItems: CartItem[] | undefined;
  let previousBudget: number | null | undefined;
  let scoredForPrefs: Scored[] = [];
  let insightMap: VenueMapElement | undefined;
  let renderedRecommendationIds: string[] = [];
  let pinnedRecommendationId: string | undefined;

  const syncControls = (state: AppState) => {
    const budgetChanged = state.prefs !== previousPrefs
      || (state.prefs.budgetFromCart && (previousBudget !== state.budget || previousItems !== state.items));
    if (!budgetInitialized || (budgetChanged && document.activeElement !== budgetInput)) {
      const value = state.prefs.budgetFromCart ? remainingBudget(state) : state.prefs.budget;
      budgetInput.value = value === null ? "" : String(value);
    }
    budgetInitialized = true;
    useRemainingBudget.setAttribute("aria-pressed", String(state.prefs.budgetFromCart));
    if (state.prefs !== previousPrefs) {
      minDifficulty.value = state.prefs.difficultyMin === null ? "" : String(state.prefs.difficultyMin);
      maxDifficulty.value = state.prefs.difficultyMax === null ? "" : String(state.prefs.difficultyMax);
      categoryField.sync(state.prefs.categories);
      playStyleSelect.value = state.prefs.playStyle;
    }
    dayNote.textContent = "行く日：" + dayNames[state.day] + "（ヘッダーで変更）";
    previousPrefs = state.prefs;
    previousBudget = state.budget;
  };

  const currentPrefs = (state: AppState): Prefs => {
    const inputValue = budgetInput.value.trim();
    const budget = inputValue === "" ? null : Number(inputValue);
    return {
      ...state.prefs,
      budget: state.prefs.budgetFromCart
        ? remainingBudget(state)
        : budget !== null && Number.isFinite(budget) && budget >= 0 ? budget : null,
      day: state.day,
    };
  };

  const updateAreaMap = (scored: Scored[], day: Day) => {
    const countsByBooth = new Map<string, number>();
    for (const item of scored) {
      if (item.score < 3 || !item.view.booth.boothCode) continue;
      const code = item.view.booth.boothCode;
      countsByBooth.set(code, (countsByBooth.get(code) ?? 0) + 1);
    }
    const countsByArea = areaMatchCounts(scored, 3);
    const areaRank = new Map(venueLayout.areas.map((area, index): [string, number] => [area.id, index]));
    const areas = Object.entries(countsByArea)
      .sort(([a, countA], [b, countB]) => countB - countA || (areaRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (areaRank.get(b) ?? Number.MAX_SAFE_INTEGER));
    areaSummary.textContent = areas.length
      ? "多いエリア: " + areas.map(([area, count]) => area + "（" + count + "件）").join("・")
      : "多いエリア: まだありません";
    const paintBooth = (booth: (typeof venueLayout.booths)[number]): BoothPaint => {
      const count = countsByBooth.get(booth.code) ?? 0;
      const intensity = count === 1 ? 0.2 : count === 2 ? 0.6 : count >= 3 ? 1 : undefined;
      return {
        color: count > 0 ? "chart-1" : undefined,
        intensity,
        title: booth.code + " " + (booth.labels[day] ?? "出展なし") + "：合う商品 " + count + "件",
      };
    };
    if (!insightMap) {
      insightMap = venueMap({ layout: venueLayout, day, paintBooth });
      insightMap.setScale("fit");
      areaMapFrame.replaceChildren(insightMap);
    } else {
      insightMap.update({ day, paintBooth });
    }
  };

  const renderRecommendations = (state: AppState) => {
    const excluded = new Set(state.items.map((item) => item.productId));
    const recommendations = scoredForPrefs.filter((item) => !excluded.has(item.view.product.id)).slice(0, 10);
    if (pinnedRecommendationId && !recommendations.some((item) => item.view.product.id === pinnedRecommendationId)) {
      const pinned = scoredForPrefs.find((item) => item.view.product.id === pinnedRecommendationId);
      if (pinned) {
        const previousIndex = renderedRecommendationIds.indexOf(pinnedRecommendationId);
        const insertAt = previousIndex < 0 ? recommendations.length : Math.min(previousIndex, recommendations.length);
        recommendations.splice(insertAt, 0, pinned);
        if (recommendations.length > 10) recommendations.pop();
      }
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedCard = active && recommendationCards.contains(active)
      ? active.closest<HTMLElement>(".insights-product-card")
      : null;
    const focusedId = focusedCard?.dataset.productId;
    const restoreFocus = active?.classList.contains("list-toggle") === true;
    const previousFocusIndex = focusedId ? renderedRecommendationIds.indexOf(focusedId) : -1;
    const itemById = new Map(state.items.map((item): [string, CartItem] => [item.productId, item]));
    const cards = recommendations.map((scored) => {
      const card = productCard(scored.view, itemById.get(scored.view.product.id), {
        onDetail: (view) => details.open(view),
        onToggle(productId) {
          pinnedRecommendationId = productId;
          store.update((current) => ({ ...current, items: toggleItem(current.items, productId) }));
        },
        onQty(productId, qty) {
          store.update((current) => ({ ...current, items: setQty(current.items, productId, qty) }));
        },
      });
      card.element.classList.add("insights-product-card");
      const score = el("strong", "insights-score", "点数 " + scored.score);
      const reasons = el("div", "insights-reasons");
      for (const reason of scored.reasons) reasons.append(el("span", "tag insights-reason", reason));
      const body = card.element.querySelector(".product-card-body");
      if (body) {
        const oneLiner = body.querySelector(".product-one-liner");
        if (oneLiner?.nextSibling) body.insertBefore(score, oneLiner.nextSibling);
        else body.append(score);
        if (score.nextSibling) body.insertBefore(reasons, score.nextSibling);
        else body.append(reasons);
      }
      return card.element;
    });
    recommendationCards.replaceChildren(...cards);
    resultCount.textContent = "おすすめ " + recommendations.length + "件";
    noRecommendations.hidden = recommendations.length > 0;
    if (focusedId && restoreFocus && focusedCard) {
      const idStillVisible = recommendations.some((item) => item.view.product.id === focusedId);
      const focusTargetIndex = idStillVisible
        ? recommendations.findIndex((item) => item.view.product.id === focusedId)
        : Math.min(Math.max(0, previousFocusIndex), recommendations.length - 1);
      const focusTarget = recommendations[focusTargetIndex];
      if (focusTarget) {
        const nextCard = Array.from(recommendationCards.children).find((card) =>
          card instanceof HTMLElement && card.dataset.productId === focusTarget.view.product.id);
        nextCard?.querySelector<HTMLButtonElement>(".list-toggle")?.focus();
      } else noRecommendations.focus();
    }
    renderedRecommendationIds = recommendations.map((item) => item.view.product.id);
  };

  recommendationCards.addEventListener("focusout", (event) => {
    if (event.relatedTarget instanceof Node && recommendationCards.contains(event.relatedTarget)) return;
    if (!pinnedRecommendationId) return;
    pinnedRecommendationId = undefined;
    renderRecommendations(store.getState());
  });

  budgetInput.addEventListener("input", () => {
    const value = budgetInput.value.trim();
    const budget = value === "" ? null : Number(value);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return;
    store.update((state) => ({ ...state, prefs: { ...state.prefs, budget, budgetFromCart: false, day: null } }));
  });

  const changeDifficulty = (side: "min" | "max", value: Prefs["difficultyMin"]) => {
    store.update((state) => {
      let difficultyMin = side === "min" ? value : state.prefs.difficultyMin;
      let difficultyMax = side === "max" ? value : state.prefs.difficultyMax;
      if (difficultyMin !== null && difficultyMax !== null && difficultyMin > difficultyMax) {
        [difficultyMin, difficultyMax] = [difficultyMax, difficultyMin];
      }
      return { ...state, prefs: { ...state.prefs, difficultyMin, difficultyMax, day: null } };
    });
  };
  minDifficulty.addEventListener("change", () => changeDifficulty("min", difficultyValue(minDifficulty.value)));
  maxDifficulty.addEventListener("change", () => changeDifficulty("max", difficultyValue(maxDifficulty.value)));
  playStyleSelect.addEventListener("change", () => {
    store.update((state) => ({ ...state, prefs: { ...state.prefs, playStyle: playStyleSelect.value as Prefs["playStyle"], day: null } }));
  });

  const sync = (state: AppState) => {
    const previousBudgetValue = previousBudget;
    const previousItemsValue = previousItems;
    const defaultBudgetChanged = state.prefs.budgetFromCart
      && (previousBudgetValue !== state.budget || previousItemsValue !== state.items);
    const prefsChanged = previousPrefs !== state.prefs || previousDay !== state.day || defaultBudgetChanged;
    const itemsChanged = previousItems !== state.items;
    syncControls(state);
    if (prefsChanged) {
      scoredForPrefs = recommend(catalog, currentPrefs(state), new Set(), catalog.length);
      if (insightMap || state.tab === "insights") updateAreaMap(scoredForPrefs, state.day);
    }
    if (prefsChanged || itemsChanged) renderRecommendations(state);
    previousDay = state.day;
    previousItems = state.items;
    if (!insightMap && state.tab === "insights") updateAreaMap(scoredForPrefs, state.day);
  };

  return { element: page, sync };
}
