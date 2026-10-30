// データ形式の正本。データ検証テスト・収集スクリプト・画面のすべてがこの型を使う

export type Day = "sat" | "sun";
export type Source = { url: string; retrievedAt: string /* YYYY-MM-DD */ };
export type Hashtag = { tag: string; sources: Source[] };
export type CheckedSource = "official" | "site" | "x" | "search";
export type Category = "kit" | "booklet" | "online" | "goods" | "other";
export type PlayMinutes = { min: number; max: number | null };

export type Booth = {
  id: string;                  // booth.tsv の管理用NO（例 "no02"）
  name: string;
  boothCode: string | null;    // マップのブース番号（例 "A4"）
  days: Day[];
  summary: string;             // 公式のブース概要
  links: { site: string[]; x: string[]; instagram: string[] };
  logoUrl: string;
  checkedSources: CheckedSource[];  // 確認まで済んだ情報源
  sources: Source[];
  hashtags: Hashtag[];
};

export type Product = {
  id: string;                  // 公式は商品NO（"p02"）、それ以外は "<boothId>-<連番>"
  boothId: string;
  name: string;
  price: number | null;        // 円・税込
  priceNote: string | null;    // 「会場限定価格」「セット割あり」など
  category: Category;          // 持ち帰り謎キット / 冊子 / スマホ・Web謎 / グッズ / その他
  oneLiner: string;            // 40字以内の一言（説明文の要約）
  description: string;         // 原文（<br> は改行に）
  difficulty: {
    level: 1 | 2 | 3 | 4 | 5 | null;
    source: "official" | "estimated" | "unknown";
    basis: string | null;      // 換算ルールや推定の根拠を1文で
  };
  playMinutes: PlayMinutes | null;
  players: string | null;
  isNew: boolean | null;
  limited: string | null;      // 「数量限定」「会場限定」など
  days: Day[];                 // 売る日
  imageUrl: string | null;     // 参照のみ。保存しない
  payment: string[] | null;    // 「現金のみ」など分かれば
  sources: Source[];
  hashtags: Hashtag[];
  unconfirmed: string[];       // 取れなかった項目名
};

// ---- キャンペーン（data/campaigns.json）。ナゾトキマーケットに関係する団体・主催の企画を手で収集する ----

export type CampaignKind = "bonus" | "giveaway" | "discount" | "other";  // 購入特典 / 抽選・プレゼント / セット割・割引 / その他の会場企画

export type Campaign = {
  id: string;                  // "<boothId>-c<連番>"。主催の企画は "official-c<連番>"
  boothId: string | null;      // 主催の企画は null
  productIds: string[];        // 対象の商品。団体全体が対象なら []
  kind: CampaignKind;
  title: string;               // 30字以内の一言
  detail: string;              // 条件・もらえるもの・参加方法
  endsAt: string | null;       // 締切（日本時間）"YYYY-MM-DD" か "YYYY-MM-DDTHH:mm"。日付だけならその日の終わりまで。会場の特典などで締切の日時がなければ null
  days: Day[];                 // 会場で受けられる日。X の抽選など会場と関係ないものは []
  limit: string | null;        // 「先着100名」「抽選3名」など
  sources: Source[];           // 団体本人（または主催）の告知
};

// ---- 会場マップ（data/venue-layout.json）。座標は公式マップ画像のピクセル ----

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type LayoutBooth = Rect & {
  code: string;                // "A4" など
  area: string;                // "A" | "Ba" | "Bb" | "Ca" | "Cb" | "Cc" | "Cd" | "Ce"
  labels: Record<Day, string | null>;  // マップ凡例の団体名。土日で入れ替わるブースは別々、出展なしは null
};

export type VenueLayout = {
  source: { url: string; retrievedAt: string; note: string };
  image: { width: number; height: number };
  viewBox: Rect;
  walkway: [number, number][];  // 通路（会場の白い部分）の外形
  entrance: Point & { label: string };
  exit: Point & { label: string };
  areas: { id: string; label: string }[];
  booths: LayoutBooth[];
  landmarks: { kind: "sponsor" | "delivery" | "toilet"; label: string; rects: Rect[] }[];
};

// ---- 収集の途中データ（data/shards/*.json）。build-data がまとめて products.json にする ----

// 公式商品（id が "p" で始まる）は、公式 TSV に無い・上書きしたい項目だけを持つ
export type ShardOfficialPatch = Partial<Omit<Product, "id" | "boothId" | "unconfirmed" | "hashtags" | "playMinutes">> & { id: string; hashtags?: Hashtag[]; playMinutes?: number | PlayMinutes | null };
// 公式以外の商品は全項目を持つ（boothId は親の ShardBooth から、unconfirmed は build-data が付ける）
export type ShardProduct = Omit<Product, "boothId" | "unconfirmed" | "hashtags" | "playMinutes"> & { hashtags?: Hashtag[]; playMinutes: number | PlayMinutes | null };

// 今回の出品と言い切れない候補（去年の出品・通販のみ等）。products には入れない
export type Candidate = {
  name: string;
  price: number | null;
  reason: string;              // なぜ候補止まりか
  sources: Source[];
};

export type ShardBooth = {
  boothId: string;
  checkedSources: CheckedSource[];
  extraLinks?: Partial<Booth["links"]>;  // 公式 TSV に無いが見つかった団体のリンク
  hashtags?: Hashtag[];
  sources: Source[];                     // 確認したページ（商品が無くても残す）
  notes?: string;                        // 収集メモ（見つからなかった理由・飛ばしたサイトなど）
  officialPatches: ShardOfficialPatch[];
  products: ShardProduct[];
  candidates: Candidate[];
};

export type ShardFile = {
  range: string;               // "no01-no14" など
  collectedAt: string;         // YYYY-MM-DD
  booths: ShardBooth[];
};
