import type {
  Booth,
  Candidate,
  Category,
  CheckedSource,
  Hashtag,
  Product,
  ShardFile,
  Source,
  VenueLayout,
} from "../../src/types.ts";
import type { OfficialBoothRow, OfficialProductRow } from "./official.ts";

const OFFICIAL_BASE = "https://www.scrapmagazine.com/s/nazomarket/";
const CHECKED_SOURCE_ORDER: CheckedSource[] = ["official", "site", "x", "search"];

type BoothCodeOverride = { boothId: string; boothCode: string | null; reason: string };
type DifficultyLevel = Exclude<Product["difficulty"]["level"], null>;
type ExtractedDifficulty = { level: DifficultyLevel; basis: string };

function compareNatural(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueSources(values: Source[]): Source[] {
  const byUrl = new Map<string, Source>();
  for (const source of values) {
    if (!byUrl.has(source.url)) byUrl.set(source.url, source);
  }
  return [...byUrl.values()];
}

function normalizeHashtags(hashtags: Hashtag[] | undefined): Hashtag[] {
  return (hashtags ?? []).flatMap((hashtag) => {
    const tag = hashtag.tag.trim().replace(/^(?:[#＃]\s*)+/u, "").trim();
    return tag ? [{ ...hashtag, tag }] : [];
  });
}

function clampDifficulty(value: number): DifficultyLevel {
  return Math.max(1, Math.min(5, value)) as DifficultyLevel;
}

function formatScaledValue(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function normalizeProductName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s/gu, "");
}

function preserveKnownValue<T>(current: T, incoming: T | undefined): T {
  return incoming === undefined || (incoming === null && current !== null) ? current : incoming;
}

function mergeDifficulty(
  current: Product["difficulty"],
  incoming: Product["difficulty"] | undefined,
): Product["difficulty"] {
  if (!incoming) return current;
  return {
    level: preserveKnownValue(current.level, incoming.level),
    source: incoming.source === "unknown" && current.source !== "unknown" ? current.source : incoming.source,
    basis: preserveKnownValue(current.basis, incoming.basis),
  };
}

export function matchBoothCodes(
  booths: OfficialBoothRow[],
  layout: VenueLayout,
  overrides: BoothCodeOverride[],
): {
  codes: Record<string, string | null>;
  manual: BoothCodeOverride[];
  unmatchedLabels: { code: string; day: "sat" | "sun"; label: string }[];
  unmatchedBooths: string[];
} {
  const codes: Record<string, string | null> = {};
  for (const booth of booths) codes[booth.id] = null;
  const boothsByName = new Map<string, OfficialBoothRow[]>();
  for (const booth of booths) {
    const key = normalizeName(booth.name);
    if (!key) continue;
    const matches = boothsByName.get(key) ?? [];
    matches.push(booth);
    boothsByName.set(key, matches);
  }

  const matchedBoothIds = new Set<string>();
  const unmatchedLabels: { code: string; day: "sat" | "sun"; label: string }[] = [];
  for (const layoutBooth of layout.booths) {
    for (const day of ["sat", "sun"] as const) {
      const label = layoutBooth.labels[day];
      if (label === null) continue;
      const matches = boothsByName.get(normalizeName(label));
      if (!matches || matches.length === 0) {
        unmatchedLabels.push({ code: layoutBooth.code, day, label });
        continue;
      }
      for (const match of matches) {
        matchedBoothIds.add(match.id);
        if (codes[match.id] === null) codes[match.id] = layoutBooth.code;
      }
    }
  }

  const manualBoothIds = new Set<string>();
  for (const override of overrides) {
    if (codes[override.boothId] !== undefined) codes[override.boothId] = override.boothCode;
    manualBoothIds.add(override.boothId);
  }

  return {
    codes,
    manual: overrides.map((override) => ({ ...override })),
    unmatchedLabels,
    unmatchedBooths: booths
      .filter((booth) => !matchedBoothIds.has(booth.id) && !manualBoothIds.has(booth.id))
      .map((booth) => booth.id),
  };
}

export function extractDifficulty(text: string): ExtractedDifficulty | null {
  for (const line of text.split(/\r?\n/u)) {
    if (!line.includes("難易度")) continue;

    const marks = line.match(/[★☆]+/u)?.[0];
    if (marks) {
      const numerator = [...marks].filter((mark) => mark === "★").length;
      const denominator = [...marks].length;
      if (denominator === 0) continue;
      const level = clampDifficulty(Math.round((numerator / denominator) * 5));
      const basis = denominator === 5
        ? `公式表記 ${marks}（${numerator}/${denominator}）をそのまま採用`
        : `公式表記 ${marks}（${numerator}/${denominator}）を5段階に換算（${numerator}/${denominator}×5=${formatScaledValue((numerator / denominator) * 5)}→${level}）`;
      return { level, basis };
    }

    const ratio = line.normalize("NFKC").match(/(\d+)\s*\/\s*(\d+)/u);
    if (!ratio) continue;
    const numerator = Number(ratio[1]);
    const denominator = Number(ratio[2]);
    if (denominator <= 0) continue;
    const level = clampDifficulty(Math.round((numerator / denominator) * 5));
    const basis = denominator === 5
      ? `公式表記 ${numerator}/${denominator} をそのまま採用`
      : `公式表記 ${numerator}/${denominator} を5段階に換算（${numerator}/${denominator}×5=${formatScaledValue((numerator / denominator) * 5)}→${level}）`;
    return { level, basis };
  }
  return null;
}

export function extractPlayMinutes(text: string): Product["playMinutes"] {
  for (const originalLine of text.split(/\r?\n/u)) {
    const line = originalLine.normalize("NFKC");
    if (line.includes("制限時間") || !/(所要時間|プレイ時間|想定時間)/u.test(line)) continue;
    const match = line.match(/(\d+(?:\.\d+)?)\s*(時間|分)?(?:\s*(?:(\d+(?:\.\d+)?)\s*分|(半)))?(?:\s*([〜～~-])\s*(?:(\d+(?:\.\d+)?)\s*(時間|分)?(?:\s*(?:(\d+(?:\.\d+)?)\s*分|(半)))?)?)?/u);
    if (!match) continue;
    const toMinutes = (value: string, unit: string | undefined, extra: string | undefined, half: string | undefined): number =>
      Math.round(unit === "時間" ? Number(value) * 60 + (extra ? Number(extra) : half ? 30 : 0) : Number(value));
    const min = toMinutes(match[1], match[2] ?? match[7], match[3], match[4]);
    const max = match[5] ? (match[6] ? toMinutes(match[6], match[7] ?? match[2], match[8], match[9]) : null) : min;
    return { min, max };
  }
  return null;
}

function normalizePlayMinutes(value: number | Product["playMinutes"]): Product["playMinutes"] {
  return typeof value === "number" ? { min: value, max: value } : value;
}

export function extractPlayers(text: string): string | null {
  for (const line of text.split(/\r?\n/u)) {
    if (!line.includes("人数")) continue;
    const separator = line.search(/[：:]/u);
    if (separator < 0) continue;
    const value = line.slice(separator + 1).trim();
    if (value) return value;
  }
  return null;
}

function shorten(value: string): string {
  const points = [...value];
  return points.length > 40 ? `${points.slice(0, 39).join("")}…` : value;
}

export function makeOneLiner(text: string, fallback?: string): string {
  const lines = text.split(/\r?\n/u);
  const plainBorder = /^[\s─━―—–ー－\-_=]+$/u;
  const framedHeading = /^[\s─━―—–ー－\-_=]*[─━―—–ー－\-_=]+\s*【[^】]*】\s*[─━―—–ー－\-_=]+[\s─━―—–ー－\-_=]*$/u;
  let sentence: string | null = null;

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line || plainBorder.test(line) || framedHeading.test(line) || /^【[^】]*】$/u.test(line)) continue;
    const period = line.indexOf("。");
    sentence = period < 0 ? line : line.slice(0, period + 1);
    break;
  }

  const value = sentence ?? fallback?.trim() ?? "";
  return shorten(value);
}

export function guessCategory(text: string): Category {
  if (/(アクリル|キーホルダー|アクキー|缶バッジ|ステッカー|Tシャツ|文具|グッズ)/iu.test(text)) return "goods";
  if (/(スマホ専用|LINE|Web|ウェブ|オンライン)/iu.test(text) && !/(キット|冊子|ブック)/u.test(text)) return "online";
  if (/(冊子|ブック|小説|問題集|書籍|本誌)/u.test(text)) return "booklet";
  if (/(キット|封筒|ふうとう|箱)/u.test(text)) return "kit";
  return "other";
}

export function computeUnconfirmed(
  product: Pick<Product, "price" | "difficulty" | "playMinutes" | "players" | "isNew" | "imageUrl" | "payment">
    & Partial<Pick<Product, "priceNote" | "limited">>,
): string[] {
  const fields: [string, boolean][] = [
    ["price", product.price === null],
    ["difficulty", product.difficulty.level === null],
    ["playMinutes", product.playMinutes === null],
    ["players", product.players === null],
    ["isNew", product.isNew === null],
    ["imageUrl", product.imageUrl === null],
    ["payment", product.payment === null],
  ];
  return fields.filter(([, missing]) => missing).map(([field]) => field);
}

export function buildProducts(input: {
  officialProducts: OfficialProductRow[];
  officialBooths: OfficialBoothRow[];
  shards: ShardFile[];
  retrievedAt: string;
}): Product[] {
  const boothById = new Map(input.officialBooths.map((booth) => [booth.id, booth]));
  const productById = new Map<string, Product>();
  const officialIds = new Set<string>();
  const officialNamesByBooth = new Map<string, Map<string, string>>();
  const patchesById = new Map<string, NonNullable<ShardFile["booths"][number]["officialPatches"]>[number][]>();
  const productBoothOrder = new Map(
    [...input.officialBooths]
      .sort((left, right) => compareNatural(left.id, right.id))
      .map((booth, index) => [booth.id, index]),
  );

  for (const officialProduct of input.officialProducts) {
    if (productById.has(officialProduct.id)) throw new Error(`商品 ID が重複しています: ${officialProduct.id}`);
    const booth = boothById.get(officialProduct.boothId);
    if (!booth) throw new Error(`公式商品 ${officialProduct.id} の団体が見つかりません: ${officialProduct.boothId}`);
    const extractedDifficulty = extractDifficulty(officialProduct.description);
    const product: Product = {
      id: officialProduct.id,
      boothId: officialProduct.boothId,
      name: officialProduct.name,
      price: officialProduct.price,
      priceNote: null,
      category: guessCategory(officialProduct.description),
      oneLiner: makeOneLiner(officialProduct.description, officialProduct.name),
      description: officialProduct.description,
      difficulty: extractedDifficulty
        ? { level: extractedDifficulty.level, source: "official", basis: extractedDifficulty.basis }
        : { level: null, source: "unknown", basis: null },
      playMinutes: extractPlayMinutes(officialProduct.description),
      players: extractPlayers(officialProduct.description),
      isNew: officialProduct.isNew ? true : null,
      limited: null,
      days: [...booth.days],
      imageUrl: `${OFFICIAL_BASE}img/booth/${officialProduct.boothId}/product/${officialProduct.id}_photo1.png`,
      payment: null,
      sources: [{ url: `${OFFICIAL_BASE}product/product.html?pno=${officialProduct.id}`, retrievedAt: input.retrievedAt }],
      hashtags: [],
      unconfirmed: [],
    };
    productById.set(product.id, product);
    officialIds.add(product.id);
    const normalizedName = normalizeProductName(officialProduct.name);
    if (normalizedName) {
      const names = officialNamesByBooth.get(officialProduct.boothId) ?? new Map<string, string>();
      if (!names.has(normalizedName)) names.set(normalizedName, officialProduct.id);
      officialNamesByBooth.set(officialProduct.boothId, names);
    }
  }

  for (const shard of input.shards) {
    for (const shardBooth of shard.booths) {
      if (!boothById.has(shardBooth.boothId)) {
        throw new Error(`収集データの団体が公式一覧にありません: ${shardBooth.boothId}`);
      }
      for (const patch of shardBooth.officialPatches) {
        const patches = patchesById.get(patch.id) ?? [];
        patches.push(patch);
        patchesById.set(patch.id, patches);
      }
      for (const shardProduct of shardBooth.products) {
        if (productById.has(shardProduct.id)) throw new Error(`商品 ID が重複しています: ${shardProduct.id}`);
        const normalizedName = normalizeProductName(shardProduct.name);
        const officialId = normalizedName ? officialNamesByBooth.get(shardBooth.boothId)?.get(normalizedName) : undefined;
        if (officialId) {
          throw new Error(`公式以外の商品 ${shardProduct.id} は同じ団体の公式商品 ${officialId} と名前が重複しています`);
        }
        const product: Product = {
          ...shardProduct,
          boothId: shardBooth.boothId,
          playMinutes: normalizePlayMinutes(shardProduct.playMinutes),
          hashtags: normalizeHashtags(shardProduct.hashtags),
          unconfirmed: [],
        };
        productById.set(product.id, product);
      }
    }
  }

  for (const [productId, patches] of patchesById) {
    let product = productById.get(productId);
    if (!product || !officialIds.has(productId)) throw new Error(`存在しない公式商品への追記です: ${productId}`);
    for (const patch of patches) {
      product = {
        ...product,
        ...patch,
        id: productId,
        price: preserveKnownValue(product.price, patch.price),
        priceNote: preserveKnownValue(product.priceNote, patch.priceNote),
        difficulty: mergeDifficulty(product.difficulty, patch.difficulty),
        playMinutes: preserveKnownValue(product.playMinutes, patch.playMinutes === undefined ? undefined : normalizePlayMinutes(patch.playMinutes)),
        players: preserveKnownValue(product.players, patch.players),
        isNew: preserveKnownValue(product.isNew, patch.isNew),
        limited: preserveKnownValue(product.limited, patch.limited),
        imageUrl: preserveKnownValue(product.imageUrl, patch.imageUrl),
        payment: preserveKnownValue(product.payment, patch.payment),
        hashtags: patch.hashtags === undefined ? product.hashtags : normalizeHashtags(patch.hashtags),
        sources: uniqueSources([...product.sources, ...(patch.sources ?? [])]),
      };
    }
    productById.set(productId, product);
  }

  const productsByBooth = new Map<string, Product[]>();
  for (const product of productById.values()) {
    product.unconfirmed = computeUnconfirmed(product);
    const products = productsByBooth.get(product.boothId) ?? [];
    products.push(product);
    productsByBooth.set(product.boothId, products);
  }

  const ordered: Product[] = [];
  const boothIds = [...productBoothOrder.keys()].sort((left, right) => productBoothOrder.get(left)! - productBoothOrder.get(right)!);
  for (const boothId of boothIds) {
    const products = productsByBooth.get(boothId);
    if (!products) continue;
    products.sort((left, right) => {
      const leftOfficial = officialIds.has(left.id);
      const rightOfficial = officialIds.has(right.id);
      if (leftOfficial !== rightOfficial) return leftOfficial ? -1 : 1;
      return compareNatural(left.id, right.id);
    });
    ordered.push(...products);
  }
  return ordered;
}

export function buildBooths(input: {
  officialBooths: OfficialBoothRow[];
  codes: Record<string, string | null>;
  shards: ShardFile[];
  retrievedAt: string;
}): Booth[] {
  const shardsByBooth = new Map<string, ShardFile["booths"][number][]>();
  for (const shard of input.shards) {
    for (const shardBooth of shard.booths) {
      const shards = shardsByBooth.get(shardBooth.boothId) ?? [];
      shards.push(shardBooth);
      shardsByBooth.set(shardBooth.boothId, shards);
    }
  }

  return [...input.officialBooths]
    .sort((left, right) => compareNatural(left.id, right.id))
    .map((officialBooth) => {
      const shardBooths = shardsByBooth.get(officialBooth.id) ?? [];
      const checked = new Set<CheckedSource>();
      const links: Booth["links"] = {
        site: [...officialBooth.links.site],
        x: [...officialBooth.links.x],
        instagram: [...officialBooth.links.instagram],
      };
      const sources: Source[] = [
        { url: `${OFFICIAL_BASE}booth/booth.html?no=${officialBooth.id}`, retrievedAt: input.retrievedAt },
      ];

      for (const shardBooth of shardBooths) {
        for (const source of shardBooth.checkedSources) checked.add(source);
        for (const key of ["site", "x", "instagram"] as const) {
          links[key].push(...(shardBooth.extraLinks?.[key] ?? []));
        }
        sources.push(...shardBooth.sources);
      }

      return {
        id: officialBooth.id,
        name: officialBooth.name,
        boothCode: input.codes[officialBooth.id] ?? null,
        days: [...officialBooth.days],
        summary: officialBooth.summary,
        links: {
          site: uniqueStrings(links.site),
          x: uniqueStrings(links.x),
          instagram: uniqueStrings(links.instagram),
        },
        logoUrl: `${OFFICIAL_BASE}img/booth/${officialBooth.id}/logo.png`,
        checkedSources: CHECKED_SOURCE_ORDER.filter((source) => source === "official" || checked.has(source)),
        sources: uniqueSources(sources),
        hashtags: normalizeHashtags(shardBooths.flatMap((shardBooth) => shardBooth.hashtags ?? [])),
      };
    });
}

export function collectCandidates(shards: ShardFile[]): (Candidate & { boothId: string })[] {
  const candidates: (Candidate & { boothId: string })[] = [];
  for (const shard of shards) {
    for (const booth of shard.booths) {
      for (const candidate of booth.candidates) candidates.push({ boothId: booth.boothId, ...candidate });
    }
  }
  return candidates;
}

export type Coverage = {
  boothCount: number;
  boothsWithProducts: number;
  productCount: number;
  productRate: number;
  withPrice: number;
  priceRate: number;
  withDifficulty: { official: number; estimated: number };
  difficultyCount: number;
  difficultyRate: number;
  boothsWithoutProducts: Booth[];
  boothsOnlyOfficial: Booth[];
  boothsWithoutX: number;
};

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

export function computeCoverage(booths: Booth[], products: Product[]): Coverage {
  const productsByBooth = new Map<string, number>();
  let withPrice = 0;
  let officialDifficulty = 0;
  let estimatedDifficulty = 0;
  for (const product of products) {
    productsByBooth.set(product.boothId, (productsByBooth.get(product.boothId) ?? 0) + 1);
    if (product.price !== null) withPrice += 1;
    if (product.difficulty.level !== null) {
      if (product.difficulty.source === "official") officialDifficulty += 1;
      if (product.difficulty.source === "estimated") estimatedDifficulty += 1;
    }
  }

  const boothsWithProducts = booths.filter((booth) => (productsByBooth.get(booth.id) ?? 0) > 0).length;
  const difficultyCount = officialDifficulty + estimatedDifficulty;
  return {
    boothCount: booths.length,
    boothsWithProducts,
    productCount: products.length,
    productRate: percent(boothsWithProducts, booths.length),
    withPrice,
    priceRate: percent(withPrice, products.length),
    withDifficulty: { official: officialDifficulty, estimated: estimatedDifficulty },
    difficultyCount,
    difficultyRate: percent(difficultyCount, products.length),
    boothsWithoutProducts: booths.filter((booth) => (productsByBooth.get(booth.id) ?? 0) === 0),
    boothsOnlyOfficial: booths.filter((booth) => booth.checkedSources.every((source) => source === "official")),
    boothsWithoutX: booths.filter((booth) => !booth.checkedSources.includes("x")).length,
  };
}

function formatBoothList(booths: Booth[]): string {
  if (booths.length === 0) return "なし";
  return booths.map((booth) => `- ${booth.id} ${booth.name}（ブース番号: ${booth.boothCode ?? "未確認"}）`).join("\n");
}

export function formatCoverageMarkdown(
  coverage: Coverage,
  dates: { generatedAt: string; officialRetrievedAt: string },
): string {
  return [
    "# データ収集カバレッジ",
    "",
    `生成日: ${dates.generatedAt}`,
    `公式データ取得日: ${dates.officialRetrievedAt}`,
    "",
    "## 商品の収集状況",
    "",
    `商品がある団体: ${coverage.boothsWithProducts}/${coverage.boothCount}（${coverage.productRate}%）`,
    `価格あり: ${coverage.withPrice}/${coverage.productCount}（${coverage.priceRate}%）`,
    `難易度あり: ${coverage.difficultyCount}/${coverage.productCount}（${coverage.difficultyRate}%）`,
    `- 公式: ${coverage.withDifficulty.official}件`,
    `- 推定: ${coverage.withDifficulty.estimated}件`,
    "",
    "## 商品が見つからなかった団体",
    "",
    formatBoothList(coverage.boothsWithoutProducts),
    "",
    "## 公式以外を確認していない団体",
    "",
    formatBoothList(coverage.boothsOnlyOfficial),
    "",
    "## X の確認状況",
    "",
    `未確認の団体: ${coverage.boothsWithoutX}件`,
  ].join("\n");
}
