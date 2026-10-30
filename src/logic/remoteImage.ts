import type { Product } from "../types.ts";

const X_IMAGE_HOST = "pbs.twimg.com";

export function isXImageUrl(imageUrl: string): boolean {
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:" && url.host === X_IMAGE_HOST;
  } catch {
    return false;
  }
}

export function productImage(product: Pick<Product, "id" | "imageUrl">): string | null {
  if (!product.imageUrl) return null;
  if (!isXImageUrl(product.imageUrl)) return product.imageUrl;
  return `remote-images/${product.id}.jpg`;
}
