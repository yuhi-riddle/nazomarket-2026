import type { Booth, Category, Day, Product, VenueLayout } from "../types.ts";
import { featureTags } from "./tags.ts";

export type DifficultyKey = 1 | 2 | 3 | 4 | 5 | "unknown";
export type SortKey = "recommended" | "booth" | "organization" | "priceAsc" | "priceDesc" | "difficultyAsc" | "difficultyDesc";

export const CATEGORY_NAMES: Record<Category, string> = {
  kit: "持ち帰り謎キット",
  booklet: "冊子",
  online: "スマホ・Web謎",
  goods: "グッズ",
  other: "その他",
};

export type ProductView = {
  product: Product;
  featureTags: string[];
  booth: Booth;
  area: string | null;
  areaOrder: number;
  boothNumber: number | null;
  sourceIndex: number;
};

export type Filters = {
  q: string;
  priceMin: number | null;
  priceMax: number | null;
  difficulties: DifficultyKey[];
  categories: Category[];
  tags: string[];
  newOnly: boolean;
  day: Day | null;
};

export const emptyFilters: Filters = {
  q: "",
  priceMin: null,
  priceMax: null,
  difficulties: [],
  categories: [],
  tags: [],
  newOnly: false,
  day: null,
};

export function buildCatalog(products: Product[], booths: Booth[], layout: VenueLayout): ProductView[] {
  const boothById = new Map(booths.map((booth): [string, Booth] => [booth.id, booth]));
  const layoutByCode = new Map(layout.booths.map((booth): [string, VenueLayout["booths"][number]] => [booth.code, booth]));
  const areaOrder = new Map(layout.areas.map((area, index): [string, number] => [area.id, index]));

  return products.flatMap((product, sourceIndex) => {
    const booth = boothById.get(product.boothId);
    if (!booth) return [];

    const mappedBooth = booth.boothCode ? layoutByCode.get(booth.boothCode) : undefined;
    const area = mappedBooth?.area ?? null;
    const number = booth.boothCode ? Number(booth.boothCode.match(/\d+$/)?.[0]) : Number.NaN;
    return [{
      product,
      featureTags: featureTags(product),
      booth,
      area,
      areaOrder: area === null ? Number.MAX_SAFE_INTEGER : areaOrder.get(area) ?? Number.MAX_SAFE_INTEGER,
      boothNumber: Number.isFinite(number) ? number : null,
      sourceIndex,
    }];
  });
}

export function normalizeForSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja").replace(/[\u30a1-\u30f6]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x60),
  );
}

export function filterCatalog(catalog: ProductView[], filters: Filters): ProductView[] {
  const terms = normalizeForSearch(filters.q).trim().split(/\s+/).filter(Boolean);
  return catalog.filter((view) => {
    const product = view.product;
    if (terms.length) {
      const haystack = normalizeForSearch([
        product.name,
        product.oneLiner,
        product.description,
        view.booth.name,
        view.booth.boothCode ?? "",
      ].join(" "));
      if (!terms.every((term) => haystack.includes(term))) return false;
    }
    if (filters.priceMin !== null && (product.price === null || product.price < filters.priceMin)) return false;
    if (filters.priceMax !== null && (product.price === null || product.price > filters.priceMax)) return false;
    if (filters.difficulties.length) {
      const difficulty: DifficultyKey = product.difficulty.level ?? "unknown";
      if (!filters.difficulties.includes(difficulty)) return false;
    }
    if (filters.categories.length && !filters.categories.includes(product.category)) return false;
    if (filters.tags.length && !filters.tags.every((tag) => view.featureTags.includes(tag))) return false;
    if (filters.newOnly && product.isNew !== true) return false;
    if (filters.day && (!product.days.includes(filters.day) || !view.booth.days.includes(filters.day))) return false;
    return true;
  });
}

function compareBooth(a: ProductView, b: ProductView): number {
  const area = a.areaOrder - b.areaOrder;
  if (area !== 0) return area;
  if (a.boothNumber === null && b.boothNumber !== null) return 1;
  if (a.boothNumber !== null && b.boothNumber === null) return -1;
  const number = (a.boothNumber ?? 0) - (b.boothNumber ?? 0);
  return number || a.sourceIndex - b.sourceIndex;
}

export function sortCatalog(catalog: ProductView[], sort: SortKey): ProductView[] {
  const result = [...catalog];
  if (sort === "booth") return result.sort(compareBooth);
  if (sort === "organization") {
    const collator = new Intl.Collator("ja");
    return result.sort((a, b) => collator.compare(a.booth.name, b.booth.name) || compareBooth(a, b));
  }
  if (sort === "recommended") return result.sort(compareBooth);

  if (sort === "priceAsc" || sort === "priceDesc") {
    const direction = sort === "priceAsc" ? 1 : -1;
    return result.sort((a, b) => {
      const aPrice = a.product.price;
      const bPrice = b.product.price;
      if (aPrice === null && bPrice !== null) return 1;
      if (aPrice !== null && bPrice === null) return -1;
      return aPrice === null || bPrice === null ? compareBooth(a, b) : (aPrice - bPrice) * direction || compareBooth(a, b);
    });
  }

  const direction = sort === "difficultyAsc" ? 1 : -1;
  return result.sort((a, b) => {
    const aLevel = a.product.difficulty.level;
    const bLevel = b.product.difficulty.level;
    if (aLevel === null && bLevel !== null) return 1;
    if (aLevel !== null && bLevel === null) return -1;
    return aLevel === null || bLevel === null ? compareBooth(a, b) : (aLevel - bLevel) * direction || compareBooth(a, b);
  });
}

export function countActiveFilters(filters: Filters): number {
  return Number(Boolean(filters.q.trim()))
    + Number(filters.priceMin !== null || filters.priceMax !== null)
    + Number(filters.difficulties.length > 0)
    + Number(filters.categories.length > 0)
    + filters.tags.length
    + Number(filters.newOnly)
    + Number(filters.day !== null);
}
