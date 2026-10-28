import type { Category, Day } from "./types.ts";
import { emptyFilters, type DifficultyKey, type Filters, type SortKey } from "./logic/catalog.ts";
import type { CartItem } from "./logic/cart.ts";
import { defaultPrefs, type Prefs } from "./logic/insights.ts";
import { FEATURE_TAGS } from "./logic/tags.ts";

export const STORAGE_KEY = "nazomarket2026:v1";
export type TabId = "catalog" | "cart" | "map";
export type AppFilters = Omit<Filters, "day"> & { onlyGoingDay: boolean };
export type AppState = {
  version: 1;
  tab: TabId;
  day: Day;
  budget: number | null;
  items: CartItem[];
  filters: AppFilters;
  sort: SortKey;
  nazocolle: { pointsPerDraw: number | null };
  today: { hideBought: boolean };
  route: { show: boolean; frontLoadSpecial: boolean };
  prefs: Prefs;
};

export const defaultState: AppState = {
  version: 1,
  tab: "catalog",
  day: "sat",
  budget: null,
  items: [],
  filters: { ...emptyFilters, onlyGoingDay: false },
  sort: "booth",
  nazocolle: { pointsPerDraw: null },
  today: { hideBought: false },
  route: { show: true, frontLoadSpecial: false },
  prefs: { ...defaultPrefs, categories: [...defaultPrefs.categories] },
};

const tabs: TabId[] = ["catalog", "cart", "map"];
const categoryValues: Category[] = ["kit", "booklet", "online", "goods", "other"];
const sorts: SortKey[] = ["recommended", "booth", "organization", "priceAsc", "priceDesc", "difficultyAsc", "difficultyDesc"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const isNullableAmount = (value: unknown): value is number | null => value === null || isNonNegativeNumber(value);
const isPointsPerDraw = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20;
const isDifficultyLevel = (value: unknown): value is 1 | 2 | 3 | 4 | 5 =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
const parseDifficulty = (value: unknown): Prefs["difficultyMin"] =>
  value === null ? null : isDifficultyLevel(value) ? value : null;

function parsePrefs(value: unknown): Prefs {
  if (!isRecord(value)) return { ...defaultPrefs, categories: [...defaultPrefs.categories] };
  const budget = isNullableAmount(value.budget) ? value.budget : defaultPrefs.budget;
  const budgetFromCart = typeof value.budgetFromCart === "boolean" ? value.budgetFromCart : defaultPrefs.budgetFromCart;
  let difficultyMin = parseDifficulty(value.difficultyMin);
  let difficultyMax = parseDifficulty(value.difficultyMax);
  if (difficultyMin !== null && difficultyMax !== null && difficultyMin > difficultyMax) {
    [difficultyMin, difficultyMax] = [difficultyMax, difficultyMin];
  }
  const categories = Array.isArray(value.categories)
    ? [...new Set(value.categories.filter((item): item is Category => categoryValues.includes(item as Category)))]
    : [...defaultPrefs.categories];
  const playStyle = value.playStyle === "onsite" || value.playStyle === "takeHome" || value.playStyle === "any"
    ? value.playStyle
    : defaultPrefs.playStyle;
  return { budget, budgetFromCart, difficultyMin, difficultyMax, categories, playStyle, day: null };
}

function parseFilters(value: unknown): AppFilters {
  if (!isRecord(value)) return { ...defaultState.filters };
  const result: AppFilters = { ...defaultState.filters };
  if (typeof value.q === "string") result.q = value.q;
  if (isNullableAmount(value.priceMin)) result.priceMin = value.priceMin;
  if (isNullableAmount(value.priceMax)) result.priceMax = value.priceMax;
  if (Array.isArray(value.difficulties)) {
    const allowed = new Set<DifficultyKey>([1, 2, 3, 4, 5, "unknown"]);
    result.difficulties = [...new Set(value.difficulties.filter((item): item is DifficultyKey => allowed.has(item as DifficultyKey)))];
  }
  if (Array.isArray(value.categories)) {
    result.categories = [...new Set(value.categories.filter((item): item is Category => categoryValues.includes(item as Category)))];
  }
  const knownTags = new Set<string>(FEATURE_TAGS);
  if (Array.isArray(value.tags)) {
    result.tags = [...new Set(value.tags.filter((item): item is string => typeof item === "string" && knownTags.has(item)))];
  } else {
    result.tags = [];
  }
  if (value.newOnly === true && !result.tags.includes("新作")) result.tags = [...result.tags, "新作"];
  result.newOnly = false;
  if (typeof value.onlyGoingDay === "boolean") result.onlyGoingDay = value.onlyGoingDay;
  return result;
}

function parseItems(value: unknown, knownProductIds: Set<string>): CartItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: CartItem[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.productId !== "string" || !knownProductIds.has(item.productId) || seen.has(item.productId)) continue;
    const qty = typeof item.qty === "number" && Number.isFinite(item.qty) ? item.qty : 1;
    seen.add(item.productId);
    result.push({
      productId: item.productId,
      qty: Math.min(99, Math.max(1, Math.floor(qty))),
      bought: typeof item.bought === "boolean" ? item.bought : false,
    });
  }
  return result;
}

export function parseState(raw: string | null, knownProductIds: Set<string>): AppState {
  if (raw === null) return defaultState;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return defaultState;
    const nazocolle = isRecord(parsed.nazocolle) && isPointsPerDraw(parsed.nazocolle.pointsPerDraw)
      ? { pointsPerDraw: parsed.nazocolle.pointsPerDraw }
      : { ...defaultState.nazocolle };
    const today = isRecord(parsed.today) && typeof parsed.today.hideBought === "boolean"
      ? { hideBought: parsed.today.hideBought }
      : { ...defaultState.today };
    const route = isRecord(parsed.route)
      ? {
        show: typeof parsed.route.show === "boolean" ? parsed.route.show : defaultState.route.show,
        frontLoadSpecial: typeof parsed.route.frontLoadSpecial === "boolean"
          ? parsed.route.frontLoadSpecial
          : defaultState.route.frontLoadSpecial,
      }
      : { ...defaultState.route };
    return {
      version: 1,
      tab: parsed.tab === "today" ? "cart" : parsed.tab === "insights" ? "catalog" : tabs.includes(parsed.tab as TabId) ? parsed.tab as TabId : defaultState.tab,
      day: parsed.day === "sat" || parsed.day === "sun" ? parsed.day : defaultState.day,
      budget: isNullableAmount(parsed.budget) ? parsed.budget : defaultState.budget,
      items: parseItems(parsed.items, knownProductIds),
      filters: parseFilters(parsed.filters),
      sort: parsed.tab === "insights" ? "recommended" : sorts.includes(parsed.sort as SortKey) ? parsed.sort as SortKey : defaultState.sort,
      nazocolle,
      today,
      route,
      prefs: parsePrefs(parsed.prefs),
    };
  } catch {
    return defaultState;
  }
}

export function serializeState(state: AppState): string {
  const prefs = {
    budget: state.prefs.budget,
    budgetFromCart: state.prefs.budgetFromCart,
    difficultyMin: state.prefs.difficultyMin,
    difficultyMax: state.prefs.difficultyMax,
    categories: state.prefs.categories,
    playStyle: state.prefs.playStyle,
  };
  return JSON.stringify({ ...state, prefs });
}
