import { join } from "node:path";
import type { Product } from "../../src/types.ts";
import { isXImageUrl } from "../../src/logic/remoteImage.ts";

const SAFE_PRODUCT_ID = /^[a-z0-9-]+$/;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_INTERVAL_MS = 1000;

export type ImageDownload = { id: string; url: string; file: string };

type ImageProduct = Pick<Product, "id" | "imageUrl">;

export function planImageDownloads(products: ImageProduct[]): ImageDownload[] {
  return products.flatMap((product) => {
    if (!product.imageUrl || !SAFE_PRODUCT_ID.test(product.id) || !isXImageUrl(product.imageUrl)) return [];
    return [{ id: product.id, url: product.imageUrl, file: `${product.id}.jpg` }];
  });
}

type ImageResponse = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type DownloadImageDependencies = {
  fetch: (url: string) => Promise<ImageResponse>;
  writeFile: (path: string, data: Uint8Array) => Promise<unknown>;
  sleep: (milliseconds: number) => Promise<void>;
  warn: (message: string) => void;
};

export async function downloadImages(
  plan: ImageDownload[],
  outDir: string,
  deps: DownloadImageDependencies,
): Promise<{ saved: string[]; failed: string[] }> {
  const saved: string[] = [];
  const failed: string[] = [];

  for (let index = 0; index < plan.length; index++) {
    const item = plan[index];
    try {
      const response = await deps.fetch(item.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get("content-type");
      if (!contentType?.toLowerCase().startsWith("image/")) {
        throw new Error(`content-type が画像ではありません: ${contentType ?? "なし"}`);
      }

      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength > MAX_IMAGE_BYTES) throw new Error("画像が5MBを超えています");

      await deps.writeFile(join(outDir, item.file), data);
      saved.push(item.id);
    } catch (error) {
      failed.push(item.id);
      deps.warn(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (index < plan.length - 1) await deps.sleep(DOWNLOAD_INTERVAL_MS);
  }

  return { saved, failed };
}
