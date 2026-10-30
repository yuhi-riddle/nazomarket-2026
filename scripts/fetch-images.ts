import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Product } from "../src/types.ts";
import { downloadImages, planImageDownloads } from "./lib/remoteImages.ts";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(rootDirectory, "public/remote-images");
const userAgent = "nazomarket-2026-image-fetch (+https://github.com/yuhi-riddle/nazomarket-2026)";

async function readProducts(): Promise<Product[]> {
  return JSON.parse(await readFile(resolve(rootDirectory, "data/products.json"), "utf8")) as Product[];
}

async function clearOutputDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const entry of await readdir(directory)) {
    await rm(join(directory, entry), { recursive: true, force: true });
  }
}

const products = await readProducts();
await clearOutputDirectory(outputDirectory);
const result = await downloadImages(planImageDownloads(products), outputDirectory, {
  fetch: (url) => fetch(url, { headers: { "User-Agent": userAgent } }),
  writeFile: (path, data) => writeFile(path, data),
  sleep: (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  warn: (message) => console.warn(message),
});

console.log(`画像: ${result.saved.length}件保存、${result.failed.length}件失敗`);
