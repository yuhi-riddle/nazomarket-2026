import type { ProductView } from "./catalog.ts";

export function splitUnknownDifficulty(views: ProductView[]): { known: ProductView[]; unknown: ProductView[] } {
  const known: ProductView[] = [];
  const unknown: ProductView[] = [];

  for (const view of views) {
    if (view.product.difficulty.level === null) unknown.push(view);
    else known.push(view);
  }

  return { known, unknown };
}
