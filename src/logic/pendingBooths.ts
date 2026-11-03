import { normalizeForSearch, type Filters, type SortKey } from "./catalog.ts";

type BoothRef = {
  id: string;
  name: string;
  boothCode?: string | null;
  days: readonly string[];
};

type ProductBoothRef = { boothId: string };

type NaturalPart = { value: string; numeric: boolean };
const boothTextCollator = new Intl.Collator("ja", { sensitivity: "base" });

function naturalParts(value: string): NaturalPart[] {
  return (value.match(/\d+|\D+/g) ?? []).map((part) => ({
    value: part,
    numeric: /^\d+$/.test(part),
  }));
}

function compareNaturalParts(left: NaturalPart[], right: NaturalPart[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    let compared = 0;
    if (a.numeric && b.numeric) {
      const normalizedA = a.value.replace(/^0+(?=\d)/, "");
      const normalizedB = b.value.replace(/^0+(?=\d)/, "");
      compared = normalizedA.length - normalizedB.length
        || (normalizedA === normalizedB ? 0 : normalizedA < normalizedB ? -1 : 1);
    } else {
      compared = boothTextCollator.compare(a.value, b.value);
    }
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}

/** 商品がまだ登録されていない団体を、現在の商品一覧条件に合わせて返す。 */
export function pendingBooths<TBooth extends BoothRef>(
  booths: TBooth[],
  products: ProductBoothRef[],
  filters: Filters,
  sort: SortKey,
): TBooth[] {
  if (
    filters.newOnly
    || filters.tags.length > 0
    || filters.categories.length > 0
    || filters.difficulties.length > 0
    || filters.priceMin !== null
    || filters.priceMax !== null
  ) return [];

  const terms = normalizeForSearch(filters.q).trim().split(/\s+/).filter(Boolean);
  if (sort === "recommended" && terms.length === 0) return [];

  const boothIdsWithProducts = new Set(products.map((product) => product.boothId));
  const matches: Array<{ booth: TBooth; index: number; parts: NaturalPart[] | null }> = [];

  booths.forEach((booth, index) => {
    if (boothIdsWithProducts.has(booth.id)) return;
    if (filters.boothId !== null && booth.id !== filters.boothId) return;
    if (filters.day !== null && !booth.days.includes(filters.day)) return;
    if (terms.length > 0) {
      const haystack = normalizeForSearch([booth.name, booth.boothCode ?? ""].join(" "));
      if (!terms.every((term) => haystack.includes(term))) return;
    }
    matches.push({
      booth,
      index,
      parts: booth.boothCode ? naturalParts(booth.boothCode) : null,
    });
  });

  matches.sort((a, b) => {
    if (a.parts === null) return b.parts === null ? a.index - b.index : 1;
    if (b.parts === null) return -1;
    return compareNaturalParts(a.parts, b.parts) || a.index - b.index;
  });
  return matches.map(({ booth }) => booth);
}
