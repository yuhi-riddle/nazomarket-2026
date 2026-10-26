import { readFile, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ShardFile, VenueLayout } from "../src/types.ts";
import {
  buildBooths,
  buildProducts,
  collectCandidates,
  computeCoverage,
  formatCoverageMarkdown,
  matchBoothCodes,
} from "./lib/build.ts";
import { getJstDate, parseBoothTsv, parseProductTsv, type OfficialBoothRow, type OfficialProductRow } from "./lib/official.ts";

type OverrideFile = { overrides: { boothId: string; boothCode: string | null; reason: string }[] };

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(rootDirectory, "data");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readShards(directory: string): Promise<ShardFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const paths = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolve(directory, entry.name))
    .sort();
  return Promise.all(paths.map((path) => readJson<ShardFile>(path)));
}

async function main(): Promise<void> {
  const rawDirectory = resolve(dataDirectory, "raw");
  const rawEntries = await readdir(rawDirectory, { withFileTypes: true });
  const dates = rawEntries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const retrievedAt = dates[dates.length - 1];
  if (!retrievedAt) throw new Error("data/raw に YYYY-MM-DD 形式のスナップショットがありません。");

  const snapshotDirectory = resolve(rawDirectory, retrievedAt);
  const [boothTsv, productTsv, layout, overrideFile, shards] = await Promise.all([
    readFile(resolve(snapshotDirectory, "booth.tsv"), "utf8"),
    readFile(resolve(snapshotDirectory, "product.tsv"), "utf8"),
    readJson<VenueLayout>(resolve(dataDirectory, "venue-layout.json")),
    readJson<OverrideFile>(resolve(dataDirectory, "booth-code-overrides.json")),
    readShards(resolve(dataDirectory, "shards")),
  ]);
  const officialBooths: OfficialBoothRow[] = parseBoothTsv(boothTsv);
  const officialProducts: OfficialProductRow[] = parseProductTsv(productTsv);
  const matched = matchBoothCodes(officialBooths, layout, overrideFile.overrides ?? []);

  if (matched.unmatchedLabels.length > 0 || matched.unmatchedBooths.length > 0) {
    console.error("ブース番号を対応付けられない項目があります。データは書き出していません。");
    if (matched.unmatchedLabels.length > 0) {
      console.error("未対応の会場ラベル:");
      for (const item of matched.unmatchedLabels) console.error(`- ${item.code} (${item.day}): ${item.label}`);
    }
    if (matched.unmatchedBooths.length > 0) {
      console.error("未対応の団体 ID:");
      for (const id of matched.unmatchedBooths) console.error(`- ${id}`);
    }
    process.exitCode = 1;
    return;
  }

  const booths = buildBooths({ officialBooths, codes: matched.codes, shards, retrievedAt });
  const products = buildProducts({ officialProducts, officialBooths, shards, retrievedAt });
  const candidates = collectCandidates(shards);
  const coverage = computeCoverage(booths, products);
  const outputs: [string, string][] = [
    [resolve(dataDirectory, "booths.json"), `${JSON.stringify(booths, null, 2)}\n`],
    [resolve(dataDirectory, "products.json"), `${JSON.stringify(products, null, 2)}\n`],
    [resolve(dataDirectory, "candidates.json"), `${JSON.stringify(candidates, null, 2)}\n`],
    [resolve(dataDirectory, "COVERAGE.md"), `${formatCoverageMarkdown(coverage, {
      generatedAt: getJstDate(new Date()),
      officialRetrievedAt: retrievedAt,
    })}\n`],
  ];
  await Promise.all(outputs.map(([path, content]) => writeFile(path, content, "utf8")));
  process.stdout.write(
    `生成完了: 団体 ${booths.length}件 / 商品 ${products.length}件 / 候補 ${candidates.length}件 / カバー率 ${coverage.productRate}% (${coverage.boothsWithProducts}/${coverage.boothCount})\n`,
  );
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`データ生成に失敗しました: ${reason}`);
  process.exitCode = 1;
});
