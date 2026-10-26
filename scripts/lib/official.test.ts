import { describe, expect, it } from "vitest";
import {
  classifyLinks,
  diffOfficial,
  formatDiffMarkdown,
  htmlToText,
  parseBoothTsv,
  parseDays,
  parsePrice,
  parseProductTsv,
} from "./official.ts";

const BOOTH_HEADER =
  "管理用NO\tブースナンバー\t団体名\tブース概要\t1つ目のHP（複数ある場合は,で繋げる）\t1つ目のX\t1つ目のInstagram\t1つ目の団体名\t2つ目のHP（複数ある場合は,で繋げる）\t2つ目のX\t2つ目のInstagram\t2つ目の団体名";
const PRODUCT_HEADER =
  "管理用商品NO\tブース登録用シートのA列を記入\t商品名\t価格\t商品説明\tピックアップページ掲載（表示=1）\t新商品バッジ表示有無（表示する場合は1を記入）\t商品画像の枚数（商品画像が複数ある場合は枚数を記入）";

describe("parsePrice", () => {
  it("「2,000円」形式を数値にする", () => {
    expect(parsePrice("2,000円")).toBe(2000);
    expect(parsePrice("500円")).toBe(500);
  });
  it("前後の引用符・空白・全角数字・円記号を許す", () => {
    expect(parsePrice('"2,000円"')).toBe(2000);
    expect(parsePrice(" ３，５００円 ")).toBe(3500);
    expect(parsePrice("¥1,200")).toBe(1200);
  });
  it("数値として読めないものは null", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("未定")).toBeNull();
    expect(parsePrice("500円〜")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("<br> の各表記を改行にする", () => {
    expect(htmlToText("a<br>b<br/>c<br />d")).toBe("a\nb\nc\nd");
  });
  it("リンクは中の文字だけ残し、ほかのタグは消す", () => {
    expect(htmlToText('特設<br><a href="https://ex.com/a" target="_blank" class="underline">https://ex.com/a</a>')).toBe(
      "特設\nhttps://ex.com/a",
    );
    expect(htmlToText("<b>太字</b>")).toBe("太字");
  });
  it("文字参照を戻し、各行末と全体の前後の空白を落とす", () => {
    expect(htmlToText(" A &amp; B &lt;3&gt; <br> 次の行 ")).toBe("A & B <3>\n次の行");
  });
});

describe("parseDays", () => {
  it("出展日の表記を Day[] にする", () => {
    expect(parseDays("両日出展")).toEqual(["sat", "sun"]);
    expect(parseDays("土曜出展")).toEqual(["sat"]);
    expect(parseDays("日曜出展")).toEqual(["sun"]);
  });
  it("知らない表記は例外にする（公式の書式変更に気づくため）", () => {
    expect(() => parseDays("金曜出展")).toThrow(/金曜出展/);
  });
});

describe("classifyLinks", () => {
  it("カンマ区切りを分け、X・Instagram・それ以外に振り分ける", () => {
    expect(
      classifyLinks(["https://www.youtube.com/c/asayakerepublic,https://x.com/AsayakeRepublic", "", ""]),
    ).toEqual({
      site: ["https://www.youtube.com/c/asayakerepublic"],
      x: ["https://x.com/AsayakeRepublic"],
      instagram: [],
    });
    expect(classifyLinks(["https://x.com/nunazotoki,https://www.instagram.com/nazotoki_nu"])).toEqual({
      site: [],
      x: ["https://x.com/nunazotoki"],
      instagram: ["https://www.instagram.com/nazotoki_nu"],
    });
  });
  it("twitter.com も X として扱う", () => {
    expect(classifyLinks(["https://twitter.com/foo"]).x).toEqual(["https://twitter.com/foo"]);
  });
  it("X のリンクはクエリを落とし、ほかは追跡用パラメータだけ落とす", () => {
    expect(classifyLinks(["https://x.com/return_zero_thk?ref_src=twsrc%5Egoogle"]).x).toEqual([
      "https://x.com/return_zero_thk",
    ]);
    expect(classifyLinks(["https://the-nazo-store.com/?srsltid=AfmBO"]).site).toEqual(["https://the-nazo-store.com/"]);
    expect(
      classifyLinks(["https://www.tanteijelly.com/company?sa=D&source=editors&ust=1747&usg=AOv"]).site,
    ).toEqual(["https://www.tanteijelly.com/company"]);
    expect(classifyLinks(["https://ex.com/page?id=3&utm_source=x"]).site).toEqual(["https://ex.com/page?id=3"]);
  });
  it("重複は1つにまとめる", () => {
    expect(classifyLinks(["https://a.jp/", "https://a.jp/"]).site).toEqual(["https://a.jp/"]);
  });
});

describe("parseBoothTsv", () => {
  const tsv = [
    BOOTH_HEADER,
    "no03\t両日出展\tRIDDLER\t概要1<br>概要2\thttps://x.com/RIDDLER_nazo\t\t\t\t\t\t\t",
    "no92\t土曜出展\t4CE Dimension ＆ TRIQLET\t概要\thttps://x.com/triqlet\t\t\t\thttps://ex.jp/\t\t\t",
  ].join("\r\n");

  it("見出し行を飛ばし、CRLF でも1団体1要素にする", () => {
    const rows = parseBoothTsv(tsv + "\r\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "no03",
      name: "RIDDLER",
      days: ["sat", "sun"],
      dayLabel: "両日出展",
      summary: "概要1\n概要2",
      links: { site: [], x: ["https://x.com/RIDDLER_nazo"], instagram: [] },
    });
  });
  it("2つ目のリンク列（HP2・X2・Instagram2）もまとめる", () => {
    const rows = parseBoothTsv(tsv);
    expect(rows[1].days).toEqual(["sat"]);
    expect(rows[1].links).toEqual({ site: ["https://ex.jp/"], x: ["https://x.com/triqlet"], instagram: [] });
  });
  it("列が足りない行・空行があっても落ちない", () => {
    const rows = parseBoothTsv([BOOTH_HEADER, "no06\t両日出展\tYTE\t概要", ""].join("\n"));
    expect(rows).toEqual([
      {
        id: "no06",
        name: "YTE",
        days: ["sat", "sun"],
        dayLabel: "両日出展",
        summary: "概要",
        links: { site: [], x: [], instagram: [] },
      },
    ]);
  });
});

describe("parseProductTsv", () => {
  it("価格を数値にし、バッジ・ピックアップ・画像枚数を型付きにする", () => {
    const tsv = [
      PRODUCT_HEADER,
      "p02\tno67\tかぎのかかったふうとうからの脱出3 変化\t2,000円\t第3弾！<br>テーマは「変化」\t1\t1\t",
      'p04\tno72\tレッパンくんのだいぼうけん！\t"3,500円"\t説明\t0\t0\t3',
    ].join("\r\n");
    expect(parseProductTsv(tsv)).toEqual([
      {
        id: "p02",
        boothId: "no67",
        name: "かぎのかかったふうとうからの脱出3 変化",
        price: 2000,
        priceText: "2,000円",
        description: "第3弾！\nテーマは「変化」",
        pickup: true,
        isNew: true,
        imageCount: null,
      },
      {
        id: "p04",
        boothId: "no72",
        name: "レッパンくんのだいぼうけん！",
        price: 3500,
        priceText: "3,500円",
        description: "説明",
        pickup: false,
        isNew: false,
        imageCount: 3,
      },
    ]);
  });
});

describe("diffOfficial", () => {
  const prev = {
    booths: [
      { id: "no01", name: "A", summary: "s" },
      { id: "no02", name: "B", summary: "s" },
    ],
    products: [
      { id: "p01", name: "X", price: 500 },
      { id: "p02", name: "Y", price: 1000 },
    ],
  };
  const next = {
    booths: [
      { id: "no01", name: "A", summary: "s2" },
      { id: "no03", name: "C", summary: "s" },
    ],
    products: [
      { id: "p01", name: "X", price: 500 },
      { id: "p02", name: "Y", price: 1200 },
      { id: "p03", name: "Z", price: 300 },
    ],
  };

  it("追加・削除・変更（変わった項目名つき）を id で突き合わせて出す", () => {
    expect(diffOfficial(prev, next)).toEqual({
      booths: { added: ["no03"], removed: ["no02"], changed: [{ id: "no01", fields: ["summary"] }] },
      products: { added: ["p03"], removed: [], changed: [{ id: "p02", fields: ["price"] }] },
    });
  });
  it("前回が無いときは全件を追加として扱う", () => {
    expect(diffOfficial(null, next).products.added).toEqual(["p01", "p02", "p03"]);
  });
  it("差分の Markdown に日付・件数・id が入る", () => {
    const md = formatDiffMarkdown(diffOfficial(prev, next), "2026-10-24", "2026-11-06");
    expect(md).toContain("2026-10-24");
    expect(md).toContain("2026-11-06");
    expect(md).toContain("p03");
    expect(md).toContain("p02");
    expect(md).toContain("price");
    expect(md).toContain("no02");
  });
  it("差分が無ければ「変更なし」と書く", () => {
    const md = formatDiffMarkdown(diffOfficial(next, next), "2026-11-05", "2026-11-06");
    expect(md).toContain("変更なし");
  });
});
