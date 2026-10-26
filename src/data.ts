import productsData from "../data/products.json";
import boothsData from "../data/booths.json";
import layoutData from "../data/venue-layout.json";
import type { Booth, Product, VenueLayout } from "./types.ts";
import { buildCatalog } from "./logic/catalog.ts";

export const products = productsData as Product[];
export const booths = boothsData as Booth[];
export const venueLayout = layoutData as VenueLayout;
export const catalog = buildCatalog(products, booths, venueLayout);
export const productById = new Map(products.map((product): [string, Product] => [product.id, product]));
export const boothById = new Map(booths.map((booth): [string, Booth] => [booth.id, booth]));
export const dataGeneratedAt = products
  .flatMap((product) => product.sources.map((source) => source.retrievedAt))
  .sort()
  .at(-1) ?? "";
