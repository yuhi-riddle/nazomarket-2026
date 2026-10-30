import type { CartItem } from "./cart.ts";
import type { Prefs } from "./insights.ts";

export function hasRecommendationBasis(items: CartItem[], prefs: Prefs, budget: number | null): boolean {
  return items.length > 0
    || budget !== null
    || prefs.difficultyMin !== null
    || prefs.difficultyMax !== null
    || prefs.categories.length > 0
    || prefs.playStyle !== "any";
}
