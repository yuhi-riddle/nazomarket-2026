import type { Product } from "../types.ts";

const X_IMAGE_HOST = "pbs.twimg.com";
const X_POST_HOSTS = new Set(["x.com", "twitter.com"]);
const X_ACCOUNT_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/\d+\/?$/;

export function isXImageUrl(imageUrl: string): boolean {
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:" && url.host === X_IMAGE_HOST;
  } catch {
    return false;
  }
}

function postCredit(sources: Product["sources"]): { account: string; url: string } | null {
  for (const source of sources) {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" || !X_POST_HOSTS.has(url.host)) continue;
      const match = X_ACCOUNT_PATH.exec(url.pathname);
      if (match) return { account: match[1], url: source.url };
    } catch {
      // Ignore malformed source URLs.
    }
  }
  return null;
}

export function productImage(
  product: Pick<Product, "id" | "imageUrl" | "sources">,
): { src: string; credit: { account: string; url: string } | null } | null {
  if (!product.imageUrl) return null;
  if (!isXImageUrl(product.imageUrl)) return { src: product.imageUrl, credit: null };

  return {
    src: `remote-images/${product.id}.jpg`,
    credit: postCredit(product.sources),
  };
}
