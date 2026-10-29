import type { Category, Day, Product } from "../types.ts";
import type { ProductView } from "./catalog.ts";
import type { CartItem } from "./cart.ts";

export type Prefs = {
  budget: number | null;
  budgetFromCart: boolean;
  difficultyMin: 1 | 2 | 3 | 4 | 5 | null;
  difficultyMax: 1 | 2 | 3 | 4 | 5 | null;
  categories: Category[];
  playStyle: "onsite" | "takeHome" | "any";
  day: Day | null;
};

export type Scored = {
  view: ProductView;
  score: number;
  reasons: string[];
};

export const defaultPrefs: Prefs = {
  budget: null,
  budgetFromCart: true,
  difficultyMin: null,
  difficultyMax: null,
  categories: [],
  playStyle: "any",
  day: null,
};

const categoryOrder: Category[] = ["kit", "booklet", "online", "goods", "other"];
const priceBins = [
  { label: "〜999円", min: 0, max: 999 },
  { label: "1,000〜1,999円", min: 1_000, max: 1_999 },
  { label: "2,000〜2,999円", min: 2_000, max: 2_999 },
  { label: "3,000〜3,999円", min: 3_000, max: 3_999 },
  { label: "4,000〜4,999円", min: 4_000, max: 4_999 },
  { label: "5,000円〜", min: 5_000, max: Number.POSITIVE_INFINITY },
];

export function priceDistribution(products: Product[]): { bins: { label: string; count: number }[]; unknown: number } {
  const bins = priceBins.map(({ label }) => ({ label, count: 0 }));
  let unknown = 0;
  for (const product of products) {
    const price = product.price;
    if (price === null) {
      unknown += 1;
      continue;
    }
    const index = priceBins.findIndex(({ min, max }) => price >= min && price <= max);
    if (index >= 0) bins[index].count += 1;
  }
  return { bins, unknown };
}

export function categoryDistribution(products: Product[]): { category: Category; count: number }[] {
  const counts = new Map<Category, number>(categoryOrder.map((category): [Category, number] => [category, 0]));
  for (const product of products) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
  return categoryOrder.map((category) => ({ category, count: counts.get(category) ?? 0 }));
}

export function difficultyDistribution(products: Product[]): {
  levels: { level: 1 | 2 | 3 | 4 | 5; official: number; estimated: number }[];
  unknown: number;
} {
  const levels = [1, 2, 3, 4, 5].map((level) => ({
    level: level as 1 | 2 | 3 | 4 | 5,
    official: 0,
    estimated: 0,
  }));
  let unknown = 0;
  for (const product of products) {
    const difficulty = product.difficulty;
    if (difficulty.level === null || difficulty.source === "unknown") {
      unknown += 1;
      continue;
    }
    const level = levels[difficulty.level - 1];
    if (difficulty.source === "official") level.official += 1;
    else if (difficulty.source === "estimated") level.estimated += 1;
    else unknown += 1;
  }
  return { levels, unknown };
}

export function newShare(products: Product[]): { isNew: number; notNew: number; unknown: number } {
  let isNew = 0;
  let notNew = 0;
  let unknown = 0;
  for (const product of products) {
    if (product.isNew === true) isNew += 1;
    else if (product.isNew === false) notNew += 1;
    else unknown += 1;
  }
  return { isNew, notNew, unknown };
}

export function playStyleOf(product: Product): "onsite" | "takeHome" | "unknown" {
  if (product.category === "online") return "onsite";
  if (product.category === "kit" || product.category === "booklet") return "takeHome";
  return "unknown";
}

function difficultyBounds(prefs: Prefs): { min: number; max: number } {
  const lower = prefs.difficultyMin ?? 1;
  const upper = prefs.difficultyMax ?? 5;
  return { min: Math.min(lower, upper), max: Math.max(lower, upper) };
}

export function scoreProduct(
  view: ProductView,
  prefs: Prefs,
  budgetLeftForThis: number | null = prefs.budget,
  amountForThis: number | null = view.product.price,
  alreadyInList = false,
): Scored | null {
  const product = view.product;
  if (prefs.day !== null && (!product.days.includes(prefs.day) || !view.booth.days.includes(prefs.day))) return null;

  let score = 0;
  const reasons: string[] = [];

  if (budgetLeftForThis !== null && amountForThis !== null) {
    if (amountForThis > budgetLeftForThis && !alreadyInList) return null;
    if (amountForThis <= budgetLeftForThis) {
      score += 2;
      reasons.push("予算内");
    }
  }

  if (prefs.difficultyMin !== null || prefs.difficultyMax !== null) {
    const { min, max } = difficultyBounds(prefs);
    const difficulty = product.difficulty;
    if (difficulty.level !== null && difficulty.source !== "unknown") {
      if (difficulty.level < min || difficulty.level > max) {
        score -= 2;
      } else if (difficulty.source === "estimated") {
        score += 2;
        reasons.push("指定した難易度（推定）");
      } else {
        score += 3;
        reasons.push("指定した難易度");
      }
    }
  }

  if (prefs.categories.length > 0 && prefs.categories.includes(product.category)) {
    score += 2;
    reasons.push("指定したカテゴリ");
  }

  if (prefs.playStyle !== "any") {
    const style = playStyleOf(product);
    if (style === prefs.playStyle) {
      score += 2;
      reasons.push(style === "onsite" ? "その場で遊べる" : "持ち帰って遊べる");
    } else if (style !== "unknown") {
      score -= 1;
    }
  }

  if (product.isNew === true) {
    score += 1;
    reasons.push("新作");
  }
  if (product.limited) {
    score += 1;
    reasons.push("限定あり");
  }

  return { view, score, reasons };
}

function compareBooth(a: ProductView, b: ProductView): number {
  const areaOrder = a.areaOrder - b.areaOrder;
  if (areaOrder !== 0) return areaOrder;
  if (a.boothNumber === null && b.boothNumber !== null) return 1;
  if (a.boothNumber !== null && b.boothNumber === null) return -1;
  const boothNumber = (a.boothNumber ?? 0) - (b.boothNumber ?? 0);
  return boothNumber || a.product.id.localeCompare(b.product.id, "en");
}

export function rankForCatalog(
  catalog: ProductView[],
  prefs: Prefs,
  items: CartItem[],
  budget: number | null,
): { matched: Scored[]; others: ProductView[] } {
  const viewById = new Map(catalog.map((view): [string, ProductView] => [view.product.id, view]));
  const quantityById = new Map(items.map((item): [string, number] => [item.productId, item.qty]));
  const categoryCounts = new Map<Category, number>();
  const difficulties: number[] = [];
  for (const productId of quantityById.keys()) {
    const product = viewById.get(productId)?.product;
    if (!product) continue;
    categoryCounts.set(product.category, (categoryCounts.get(product.category) ?? 0) + 1);
    if (product.difficulty.level !== null && product.difficulty.source !== "unknown") {
      difficulties.push(product.difficulty.level);
    }
  }
  const categoryRanking = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1]);
  const preferredCategory = categoryRanking.length > 0 && categoryRanking[0][1] > (categoryRanking[1]?.[1] ?? 0)
    ? categoryRanking[0][0] : null;
  const averageDifficulty = difficulties.length > 0
    ? difficulties.reduce((sum, level) => sum + level, 0) / difficulties.length : null;
  const listAmountById = new Map<string, number>();
  let listTotal = 0;
  for (const item of items) {
    const price = viewById.get(item.productId)?.product.price;
    if (price === null || price === undefined) continue;
    const amount = price * item.qty;
    listAmountById.set(item.productId, amount);
    listTotal += amount;
  }

  const matched: Scored[] = [];
  const others: ProductView[] = [];
  for (const view of catalog) {
    const productId = view.product.id;
    const inList = quantityById.has(productId);
    const otherItemsTotal = listTotal - (listAmountById.get(productId) ?? 0);
    const budgetLeftForThis = budget === null ? null : budget - otherItemsTotal;
    const amountForThis = view.product.price === null
      ? null
      : view.product.price * (quantityById.get(productId) ?? 1);
    const scored = scoreProduct(view, prefs, budgetLeftForThis, amountForThis, inList);
    if (!scored) continue;
    if (prefs.categories.length === 0 && preferredCategory !== null && view.product.category === preferredCategory) {
      scored.score += 1;
      scored.reasons.push("リストと同じカテゴリ");
    }
    const difficulty = view.product.difficulty;
    if (prefs.difficultyMin === null && prefs.difficultyMax === null && averageDifficulty !== null
      && difficulty.level !== null && difficulty.source !== "unknown"
      && Math.abs(difficulty.level - averageDifficulty) <= 1) {
      scored.score += 1;
      scored.reasons.push("リストの難易度に近い");
    }
    if (scored.score > 0) matched.push(scored);
    else others.push(view);
  }

  matched.sort((a, b) => b.score - a.score
    || (a.view.product.price === null ? (b.view.product.price === null ? 0 : 1)
      : b.view.product.price === null ? -1 : a.view.product.price - b.view.product.price)
    || compareBooth(a.view, b.view));
  others.sort(compareBooth);
  return { matched, others };
}

export function recommend(catalog: ProductView[], prefs: Prefs, excludeIds: Set<string>, limit: number): Scored[] {
  return catalog
    .flatMap((view) => {
      if (excludeIds.has(view.product.id)) return [];
      const scored = scoreProduct(view, prefs);
      return scored && scored.score > 0 ? [scored] : [];
    })
    .sort((a, b) => b.score - a.score
      || (a.view.product.price === null ? (b.view.product.price === null ? 0 : 1)
        : b.view.product.price === null ? -1 : a.view.product.price - b.view.product.price)
      || compareBooth(a.view, b.view))
    .slice(0, Math.max(0, limit));
}

export function areaMatchCounts(scored: Scored[], threshold: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of scored) {
    if (item.score < threshold || item.view.area === null) continue;
    counts[item.view.area] = (counts[item.view.area] ?? 0) + 1;
  }
  return counts;
}

export const SCORE_RULES: { label: string; points: string }[] = [
  { label: "予算内（価格不明は採点しない）", points: "+2" },
  { label: "好みの難易度（公式）", points: "+3" },
  { label: "好みの難易度（推定）", points: "+2" },
  { label: "難易度が好みの範囲外", points: "−2" },
  { label: "好みのカテゴリ", points: "+2" },
  { label: "リストで最多のカテゴリ（手動指定なし・同数は対象外）", points: "+1" },
  { label: "リストの難易度の平均から±1以内（手動指定なし）", points: "+1" },
  { label: "好みの遊び方に合う", points: "+2" },
  { label: "好みの遊び方と合わない", points: "−1" },
  { label: "新作", points: "+1" },
  { label: "限定あり", points: "+1" },
  { label: "条件未指定・価格／難易度／遊び方が不明", points: "0" },
  { label: "予算超過・行く日に販売なし・リスト登録済み", points: "除外" },
  { label: "合計0点以下", points: "表示しない" },
];
