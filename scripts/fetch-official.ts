import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  diffOfficial,
  formatDiffMarkdown,
  formatMapHashStatus,
  getJstDate,
  getSnapshotRelativePath,
  parseBoothTsv,
  parseProductTsv,
  resolveFetchDate,
  selectPreviousDate,
  type OfficialSnapshot,
} from "./lib/official.ts";

const baseUrl = "https://www.scrapmagazine.com/s/nazomarket/";
const userAgent = "nazomarket-2026-planner (personal, non-commercial)";
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function waitOneSecond(): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, 1000));
}

async function readPreviousMapHash(snapshotDirectory: string): Promise<string | null> {
  let content: string;
  try {
    content = await readFile(resolve(snapshotDirectory, "meta.json"), "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }

  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null) return null;
  const map = (parsed as Record<string, unknown>).map;
  if (typeof map !== "object" || map === null) return null;
  const hash = (map as Record<string, unknown>).sha256;
  return typeof hash === "string" ? hash : null;
}

async function readSnapshot(snapshotDirectory: string): Promise<OfficialSnapshot> {
  const [boothTsv, productTsv] = await Promise.all([
    readFile(resolve(snapshotDirectory, "booth.tsv"), "utf8"),
    readFile(resolve(snapshotDirectory, "product.tsv"), "utf8"),
  ]);
  return {
    booths: parseBoothTsv(boothTsv),
    products: parseProductTsv(productTsv),
  };
}

async function main(): Promise<void> {
  const date = resolveFetchDate(process.argv.slice(2), getJstDate(new Date()));
  const rawRoot = resolve(rootDirectory, "data", "raw");
  await mkdir(rawRoot, { recursive: true });

  const entries = await readdir(rawRoot, { withFileTypes: true });
  const previousDate = selectPreviousDate(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    date,
  );
  const previousDirectory = previousDate
    ? resolve(rootDirectory, getSnapshotRelativePath(previousDate))
    : null;
  const previous = previousDirectory ? await readSnapshot(previousDirectory) : null;

  const boothUrl = new URL("data/booth.tsv", baseUrl).href;
  const productUrl = new URL("data/product.tsv", baseUrl).href;
  const mapUrl = new URL("img/top/map_2026.jpg", baseUrl).href;
  const boothBytes = await fetchBytes(boothUrl);
  await waitOneSecond();
  const productBytes = await fetchBytes(productUrl);
  await waitOneSecond();
  const mapBytes = await fetchBytes(mapUrl);

  const mapHash = createHash("sha256").update(mapBytes).digest("hex");
  const currentDirectory = resolve(rootDirectory, getSnapshotRelativePath(date));
  await mkdir(currentDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(currentDirectory, "booth.tsv"), boothBytes),
    writeFile(resolve(currentDirectory, "product.tsv"), productBytes),
  ]);

  const metadata = {
    retrievedAt: new Date().toISOString(),
    urls: { booth: boothUrl, product: productUrl, map: mapUrl },
    map: { sha256: mapHash, bytes: mapBytes.byteLength },
  };
  await writeFile(resolve(currentDirectory, "meta.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  const current: OfficialSnapshot = {
    booths: parseBoothTsv(boothBytes.toString("utf8")),
    products: parseProductTsv(productBytes.toString("utf8")),
  };
  const diff = diffOfficial(previous, current);
  const previousMapHash = previousDirectory ? await readPreviousMapHash(previousDirectory) : null;
  const markdown = [
    formatDiffMarkdown(diff, previousDate, date),
    formatMapHashStatus(previousMapHash, mapHash, previousDirectory !== null),
  ].join("\n");
  await writeFile(resolve(currentDirectory, "diff.md"), `${markdown}\n`, "utf8");
  process.stdout.write(`${markdown}\n`);
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`公式データの取得に失敗しました: ${reason}`);
  process.exitCode = 1;
});
