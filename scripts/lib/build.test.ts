import { describe, expect, it } from "vitest";
import type { ShardFile, VenueLayout } from "../../src/types.ts";
import type { OfficialBoothRow, OfficialProductRow } from "./official.ts";
import {
  buildBooths,
  buildProducts,
  collectCandidates,
  computeCoverage,
  computeUnconfirmed,
  extractDifficulty,
  extractPlayers,
  extractPlayMinutes,
  formatCoverageMarkdown,
  guessCategory,
  makeOneLiner,
  matchBoothCodes,
  normalizeName,
} from "./build.ts";

const DATE = "2026-10-25";
const BASE = "https://www.scrapmagazine.com/s/nazomarket/";

function booth(id: string, name: string, days: ("sat" | "sun")[] = ["sat", "sun"]): OfficialBoothRow {
  return {
    id,
    name,
    days,
    dayLabel: days.length === 2 ? "両日出展" : days[0] === "sat" ? "土曜出展" : "日曜出展",
    summary: `${name}の概要`,
    links: { site: [], x: [], instagram: [] },
  };
}

function layoutWith(booths: VenueLayout["booths"]): VenueLayout {
  return {
    source: { url: "", retrievedAt: DATE, note: "" },
    image: { width: 2000, height: 1413 },
    viewBox: { x: 0, y: 0, w: 2000, h: 1413 },
    walkway: [],
    entrance: { x: 1905, y: 645, label: "入口" },
    exit: { x: 480, y: 465, label: "出口" },
    areas: [],
    booths,
    landmarks: [],
  };
}

function lb(code: string, sat: string | null, sun: string | null = sat): VenueLayout["booths"][number] {
  return { code, area: code.startsWith("A") ? "A" : code.slice(0, 2), x: 0, y: 0, w: 10, h: 10, labels: { sat, sun } };
}

describe("normalizeName", () => {
  it("全角/半角・大文字小文字・空白・記号の揺れを吸収する", () => {
    expect(normalizeName("ＸＥＯＸＹ")).toBe(normalizeName("XEOXY"));
    expect(normalizeName("？無策師？")).toBe(normalizeName("?無策師?"));
    expect(normalizeName("広島大学ナゾサークル　おにラビ")).toBe(normalizeName("広島大学ナゾサークル おにラビ"));
    expect(normalizeName("みかん箱&Toy× ボーズ& エレメンツ")).toBe(normalizeName("みかん箱&Toy×ボーズ&エレメンツ"));
    expect(normalizeName("きりんぐたいむに象の群れ＆3年え組")).toBe(normalizeName("きりんぐたいむに象の群れ＆３年え組"));
    expect(normalizeName("MOT!&pintoLab& なぞねこ")).toBe(normalizeName("MOT!&pintoLab&なぞねこ"));
  });
  it("違う名前は違うまま", () => {
    expect(normalizeName("NazoLock")).not.toBe(normalizeName("NazoGram"));
  });
});

describe("matchBoothCodes", () => {
  const booths = [
    booth("no12", "ＸＥＯＸＹ"),
    booth("no92", "4CE Dimension ＆ TRIQLET", ["sat"]),
    booth("no95", "WHYNU", ["sun"]),
    booth("no94", "立川茜＆なぞる", ["sat"]),
    booth("no97", "レイトン教授と秘密の招待状 in 東京ドームシティ"),
    booth("no50", "SBGC"),
  ];
  const layout = layoutWith([
    lb("Bb2", "XEOXY"),
    lb("Cc6", "4CE Dimension ＆ TRIQLET", "WHYNU"),
    lb("Ce5", "立川茜＆なぞる", null),
    lb("Cc17", "SBGC"),
    lb("Ca99", "どこにもいない団体"),
  ]);
  const overrides = [{ boothId: "no97", boothCode: null, reason: "マップに無い" }];

  it("正規化した名前で対応付け、土日の入れ替わりも別々に付ける", () => {
    const r = matchBoothCodes(booths, layout, overrides);
    expect(r.codes).toEqual({ no12: "Bb2", no92: "Cc6", no95: "Cc6", no94: "Ce5", no97: null, no50: "Cc17" });
  });
  it("手動の対応は自動より優先し、理由つきで返す", () => {
    const r = matchBoothCodes(booths, layout, [{ boothId: "no50", boothCode: "Cc18", reason: "テスト" }, ...overrides]);
    expect(r.codes.no50).toBe("Cc18");
    expect(r.manual).toEqual([
      { boothId: "no50", boothCode: "Cc18", reason: "テスト" },
      { boothId: "no97", boothCode: null, reason: "マップに無い" },
    ]);
  });
  it("対応しなかったマップの名前と、手動対応も無い団体を返す", () => {
    const r = matchBoothCodes([...booths, booth("no60", "C-lock-row")], layout, overrides);
    expect(r.unmatchedLabels).toEqual([{ code: "Ca99", day: "sat", label: "どこにもいない団体" }, { code: "Ca99", day: "sun", label: "どこにもいない団体" }]);
    expect(r.unmatchedBooths).toEqual(["no60"]);
  });
});

describe("extractDifficulty", () => {
  it("★の5段階表記はそのまま", () => {
    expect(extractDifficulty("難易度　　：★★★★☆ (結構難しい)")).toEqual({
      level: 4,
      basis: "公式表記 ★★★★☆（4/5）をそのまま採用",
    });
  });
  it("「N/5」表記はそのまま", () => {
    expect(extractDifficulty("総合難易度：3/5\nプレイ時間：90分〜")?.level).toBe(3);
  });
  it("★の3段階表記は5段階に比例換算して四捨五入する", () => {
    expect(extractDifficulty("難易度：★★☆ (物語を読むのが好きな方向け)")).toEqual({
      level: 3,
      basis: "公式表記 ★★☆（2/3）を5段階に換算（2/3×5=3.3→3）",
    });
    expect(extractDifficulty("難易度：★☆☆ (絶望した夜に)")?.level).toBe(2);
    expect(extractDifficulty("難易度：★★★ (物語も謎も楽しみたい方に)")?.level).toBe(5);
  });
  it("表記が無ければ null", () => {
    expect(extractDifficulty("ストーリー：★★★★★ (とても重厚)")).toBeNull();
    expect(extractDifficulty("謎解きキットです")).toBeNull();
  });
});

describe("extractPlayMinutes", () => {
  it.each([
    ["所要時間　：2〜4時間", 120],
    ["所要時間　：2.5〜4時間", 150],
    ["所要時間　：4時間〜", 240],
    ["プレイ時間：210分〜", 210],
    ["想定時間： 45分（目安）", 45],
    ["所要時間：60分~ ", 60],
    ["プレイ時間目安：45分～120分（サクッと遊べるボリュームです）", 45],
    ["・想定所要時間：120分程度", 120],
    ["所要時間：1時間30分", 90],
    ["所要時間：1.5時間", 90],
    ["所要時間：約1時間半", 90],
  ])("%s → %i 分（範囲は下限）", (text, minutes) => {
    expect(extractPlayMinutes(text)).toBe(minutes);
  });
  it("時間の表記が無ければ null", () => {
    expect(extractPlayMinutes("制限時間：なし")).toBeNull();
    expect(extractPlayMinutes("謎解きキット")).toBeNull();
  });
});

describe("extractPlayers", () => {
  it("人数の表記を原文に近い形で抜き出す", () => {
    expect(extractPlayers("推奨人数：1~2人")).toBe("1~2人");
    expect(extractPlayers("プレイ人数：1人 ")).toBe("1人");
    expect(extractPlayers("・人数：1人用")).toBe("1人用");
    expect(extractPlayers("謎解きキット")).toBeNull();
  });
});

describe("makeOneLiner", () => {
  it("飾り罫線や【見出し】の行を飛ばし、最初の文を40字以内にする", () => {
    expect(makeOneLiner("───────【あらすじ】───────\n雪に閉ざされた極地に佇む巨大施設。")).toBe(
      "雪に閉ざされた極地に佇む巨大施設。",
    );
  });
  it("40字を超えたら39字＋「…」にする", () => {
    const long = "あ".repeat(50);
    const r = makeOneLiner(long);
    expect(r).toHaveLength(40);
    expect(r.endsWith("…")).toBe(true);
  });
  it("説明が空なら代わりの文字列を使う", () => {
    expect(makeOneLiner("", "商品名")).toBe("商品名");
  });
  it("罫線と【見出し】の間に空白がある行も飛ばす", () => {
    expect(makeOneLiner("─────── 【あらすじ】 ───────\n雪に閉ざされた極地に佇む巨大施設。")).toBe(
      "雪に閉ざされた極地に佇む巨大施設。",
    );
  });
});

describe("guessCategory", () => {
  it.each([
    ["アクリルキーホルダーと日常生活にあるものを組み合わせて謎をつくりましょう", "goods"],
    ["スマホ専用、全4問のライトな謎解きです。", "online"],
    ["ミステリー小説第2作", "booklet"],
    ["鍵がかかっているふうとうをあけることを目指す完全オフライン謎解きキット", "kit"],
    ["よく分からないもの", "other"],
  ])("%s → %s", (text, category) => {
    expect(guessCategory(text)).toBe(category);
  });
});

describe("computeUnconfirmed", () => {
  it("null の項目名を返す（難易度は level が null のとき。priceNote と limited は対象外）", () => {
    expect(
      computeUnconfirmed({
        price: null,
        priceNote: null,
        limited: null,
        difficulty: { level: null, source: "unknown", basis: null },
        playMinutes: 60,
        players: null,
        isNew: true,
        imageUrl: null,
        payment: null,
      }),
    ).toEqual(["price", "difficulty", "players", "imageUrl", "payment"]);
  });
});

const officialProducts: OfficialProductRow[] = [
  {
    id: "p03",
    boothId: "no72",
    name: "気怠げ終末レジスタンス",
    price: 2500,
    priceText: "2,500円",
    description: "あらすじ\n難易度　　：★★★★☆ (結構難しい)\n所要時間　：2〜4時間",
    pickup: true,
    isNew: true,
    imageCount: null,
  },
  {
    id: "p19",
    boothId: "no41",
    name: "Loops",
    price: 1200,
    priceText: "1,200円",
    description: "Loops",
    pickup: true,
    isNew: false,
    imageCount: null,
  },
];

const shards: ShardFile[] = [
  {
    range: "no41-no72",
    collectedAt: DATE,
    booths: [
      {
        boothId: "no72",
        checkedSources: ["official", "site"],
        sources: [{ url: "https://primalade.example/", retrievedAt: DATE }],
        officialPatches: [
          {
            id: "p03",
            category: "booklet",
            oneLiner: "AIが凍らせる世界を二人で救う長編謎解きブック",
            priceNote: "会場限定価格（通常2,800円）",
            sources: [{ url: "https://primalade.example/resistance", retrievedAt: DATE }],
          },
        ],
        products: [
          {
            id: "no72-1",
            name: "新作キット",
            price: null,
            priceNote: null,
            category: "kit",
            oneLiner: "新作の持ち帰りキット",
            description: "新作です",
            difficulty: { level: null, source: "unknown", basis: null },
            playMinutes: null,
            players: null,
            isNew: true,
            limited: "数量限定",
            days: ["sat", "sun"],
            imageUrl: null,
            payment: null,
            sources: [{ url: "https://primalade.example/new", retrievedAt: DATE }],
          },
        ],
        candidates: [{ name: "去年の作品", price: 1000, reason: "2025年の出品", sources: [{ url: "https://primalade.example/old", retrievedAt: DATE }] }],
      },
    ],
  },
];

const officialBooths = [booth("no41", "K-dush2"), booth("no72", "Primalade / プライマレード"), booth("no10", "タカラッシュ！")];

describe("buildProducts", () => {
  const products = buildProducts({ officialProducts, officialBooths, shards, retrievedAt: DATE });
  const p03 = products.find((p) => p.id === "p03")!;
  const p19 = products.find((p) => p.id === "p19")!;

  it("公式商品は TSV の値を土台に、説明文から難易度・所要時間を読み取る", () => {
    expect(p19).toMatchObject({
      boothId: "no41",
      name: "Loops",
      price: 1200,
      description: "Loops",
      isNew: null,
      days: ["sat", "sun"],
      imageUrl: `${BASE}img/booth/no41/product/p19_photo1.png`,
      difficulty: { level: null, source: "unknown", basis: null },
    });
    expect(p19.sources).toEqual([{ url: `${BASE}product/product.html?pno=p19`, retrievedAt: DATE }]);
    expect(p03.difficulty).toEqual({ level: 4, source: "official", basis: "公式表記 ★★★★☆（4/5）をそのまま採用" });
    expect(p03.playMinutes).toBe(120);
  });
  it("収集結果の追記で上書きし、出典は重複なしで足す", () => {
    expect(p03.category).toBe("booklet");
    expect(p03.oneLiner).toBe("AIが凍らせる世界を二人で救う長編謎解きブック");
    expect(p03.priceNote).toBe("会場限定価格（通常2,800円）");
    expect(p03.price).toBe(2500);
    expect(p03.isNew).toBe(true);
    expect(p03.sources.map((s) => s.url)).toEqual([
      `${BASE}product/product.html?pno=p03`,
      "https://primalade.example/resistance",
    ]);
  });
  it("追記の無い公式商品は一言とカテゴリを説明文から作る", () => {
    expect(p19.oneLiner).toBe("Loops");
    expect(p19.category).toBe("other");
  });
  it("公式以外の商品は団体 id を付け、unconfirmed を計算する", () => {
    const p = products.find((x) => x.id === "no72-1")!;
    expect(p.boothId).toBe("no72");
    expect(p.unconfirmed).toEqual(["price", "difficulty", "playMinutes", "players", "imageUrl", "payment"]);
  });
  it("並びは団体の管理用NO順、同じ団体の中は公式→それ以外の id 順", () => {
    expect(products.map((p) => p.id)).toEqual(["p19", "p03", "no72-1"]);
  });
  it("同じ id が2回出たら例外", () => {
    const dup: ShardFile[] = [shards[0], { ...shards[0], range: "dup" }];
    expect(() => buildProducts({ officialProducts, officialBooths, shards: dup, retrievedAt: DATE })).toThrow(/no72-1/);
  });
  it("追記の null や不明は、公式に値があれば上書きしない（公式が後から埋まっても消さない）", () => {
    const withNulls: ShardFile[] = [{
      ...shards[0],
      booths: [{
        ...shards[0].booths[0],
        officialPatches: [{ id: "p03", difficulty: { level: null, source: "unknown", basis: null }, playMinutes: null, isNew: null, players: "1〜2人" }],
      }],
    }];
    const p = buildProducts({ officialProducts, officialBooths, shards: withNulls, retrievedAt: DATE }).find((x) => x.id === "p03")!;
    expect(p.difficulty.level).toBe(4);
    expect(p.playMinutes).toBe(120);
    expect(p.isNew).toBe(true);
    expect(p.players).toBe("1〜2人");
  });
  it("公式以外の商品が、同じ団体の公式商品と同じ名前なら例外（後から公式に載った二重登録を止める）", () => {
    const dup: ShardFile[] = [{
      ...shards[0],
      booths: [{ ...shards[0].booths[0], products: [{ ...shards[0].booths[0].products[0], id: "no72-9", name: "気怠げ終末 レジスタンス" }] }],
    }];
    expect(() => buildProducts({ officialProducts, officialBooths, shards: dup, retrievedAt: DATE })).toThrow(/no72-9.*p03|p03.*no72-9/);
  });
  it("存在しない公式商品への追記は例外", () => {
    const bad: ShardFile[] = [
      { range: "x", collectedAt: DATE, booths: [{ ...shards[0].booths[0], officialPatches: [{ id: "p99" }], products: [] }] },
    ];
    expect(() => buildProducts({ officialProducts, officialBooths, shards: bad, retrievedAt: DATE })).toThrow(/p99/);
  });
});

describe("buildBooths", () => {
  const booths = buildBooths({
    officialBooths,
    codes: { no41: "Cb5", no72: "Cd3", no10: "Bb7" },
    shards: [
      {
        ...shards[0],
        booths: [{ ...shards[0].booths[0], extraLinks: { x: ["https://x.com/primalade"] }, checkedSources: ["search", "site"] }],
      },
    ],
    retrievedAt: DATE,
  });

  it("公式の情報にブース番号・ロゴ・出典を付ける", () => {
    const b = booths.find((x) => x.id === "no10")!;
    expect(b).toEqual({
      id: "no10",
      name: "タカラッシュ！",
      boothCode: "Bb7",
      days: ["sat", "sun"],
      summary: "タカラッシュ！の概要",
      links: { site: [], x: [], instagram: [] },
      logoUrl: `${BASE}img/booth/no10/logo.png`,
      checkedSources: ["official"],
      sources: [{ url: `${BASE}booth/booth.html?no=no10`, retrievedAt: DATE }],
      hashtags: [],
    });
  });
  it("収集結果のリンク・確認済みの情報源・出典を足す（情報源は official, site, x, search の順）", () => {
    const b = booths.find((x) => x.id === "no72")!;
    expect(b.links.x).toEqual(["https://x.com/primalade"]);
    expect(b.checkedSources).toEqual(["official", "site", "search"]);
    expect(b.sources.map((s) => s.url)).toEqual([`${BASE}booth/booth.html?no=no72`, "https://primalade.example/"]);
  });
  it("並びは管理用NO順", () => {
    expect(booths.map((b) => b.id)).toEqual(["no10", "no41", "no72"]);
  });
});

describe("ハッシュタグ", () => {
  const tag = (t: string) => ({ tag: t, sources: [{ url: "https://x.com/primalade/status/1", retrievedAt: DATE }] });
  const withTags: ShardFile[] = [
    {
      ...shards[0],
      booths: [
        {
          ...shards[0].booths[0],
          hashtags: [tag("ナゾトキマーケット"), tag("プライマレード")],
          officialPatches: [{ ...shards[0].booths[0].officialPatches[0], hashtags: [tag("レジスタンス")] }],
          products: [{ ...shards[0].booths[0].products[0], hashtags: [tag("新作キット")] }],
        },
      ],
    },
  ];
  it("団体のタグを booths に入れる。無ければ空", () => {
    const booths = buildBooths({ officialBooths, codes: { no41: "Cb5", no72: "Cd3", no10: "Bb7" }, shards: withTags, retrievedAt: DATE });
    expect(booths.find((b) => b.id === "no72")!.hashtags.map((h) => h.tag)).toEqual(["ナゾトキマーケット", "プライマレード"]);
    expect(booths.find((b) => b.id === "no41")!.hashtags).toEqual([]);
  });
  it("商品のタグは公式商品への追記・公式以外の商品のどちらからも入る。無ければ空", () => {
    const products = buildProducts({ officialProducts, officialBooths, shards: withTags, retrievedAt: DATE });
    expect(products.find((p) => p.id === "p03")!.hashtags).toEqual([tag("レジスタンス")]);
    expect(products.find((p) => p.id === "no72-1")!.hashtags).toEqual([tag("新作キット")]);
    expect(products.find((p) => p.id === "p19")!.hashtags).toEqual([]);
  });
  it("タグに # が付いていたら外し、前後の空白を取る。空のタグは捨てる", () => {
    const messy: ShardFile[] = [{ ...shards[0], booths: [{ ...shards[0].booths[0], hashtags: [tag("#ナゾマ "), tag("  "), tag("＃謎解き")] }] }];
    const booths = buildBooths({ officialBooths, codes: { no41: "Cb5", no72: "Cd3", no10: "Bb7" }, shards: messy, retrievedAt: DATE });
    expect(booths.find((b) => b.id === "no72")!.hashtags.map((h) => h.tag)).toEqual(["ナゾマ", "謎解き"]);
  });
});

describe("collectCandidates", () => {
  it("団体 id を付けて候補を集める", () => {
    expect(collectCandidates(shards)).toEqual([
      { boothId: "no72", name: "去年の作品", price: 1000, reason: "2025年の出品", sources: [{ url: "https://primalade.example/old", retrievedAt: DATE }] },
    ]);
  });
});

describe("computeCoverage / formatCoverageMarkdown", () => {
  const booths = buildBooths({ officialBooths, codes: { no41: "Cb5", no72: "Cd3", no10: "Bb7" }, shards, retrievedAt: DATE });
  const products = buildProducts({ officialProducts, officialBooths, shards, retrievedAt: DATE });
  const cov = computeCoverage(booths, products);

  it("商品のある団体数・価格あり率・難易度あり率（公式/推定の内訳）を出す", () => {
    expect(cov).toMatchObject({
      boothCount: 3,
      boothsWithProducts: 2,
      productCount: 3,
      withPrice: 2,
      withDifficulty: { official: 1, estimated: 0 },
    });
  });
  it("何も取れなかった団体と、公式以外を確認していない団体を一覧にする", () => {
    expect(cov.boothsWithoutProducts.map((b) => b.id)).toEqual(["no10"]);
    expect(cov.boothsOnlyOfficial.map((b) => b.id)).toEqual(["no10", "no41"]);
  });
  it("Markdown に数値と一覧が入る", () => {
    const md = formatCoverageMarkdown(cov, { generatedAt: "2026-10-26", officialRetrievedAt: DATE });
    expect(md).toContain("2/3");
    expect(md).toContain("67%");
    expect(md).toContain("no10");
    expect(md).toContain("タカラッシュ！");
  });
  it("生成日（この表を作った日）と公式データの取得日を分けて書く", () => {
    const md = formatCoverageMarkdown(cov, { generatedAt: "2026-10-26", officialRetrievedAt: DATE });
    expect(md).toContain("生成日: 2026-10-26");
    expect(md).toContain(`公式データ取得日: ${DATE}`);
  });
});
