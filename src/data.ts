import productsData from "../data/products.json";
import boothsData from "../data/booths.json";
import layoutData from "../data/venue-layout.json";
import campaignsData from "../data/campaigns.json";
import imageCropsData from "../data/imageCrops.json";
import type { Booth, Product, VenueLayout } from "./types.ts";
import type { Campaign } from "./types.ts";
import { buildCatalog } from "./logic/catalog.ts";
import type { ImageCrop } from "./logic/imageCrop.ts";

export const products = productsData as Product[];
export const booths = boothsData as Booth[];
export const venueLayout = layoutData as VenueLayout;
export const campaigns = campaignsData as Campaign[];
export const imageCrops = imageCropsData as Record<string, ImageCrop>;
export const catalog = buildCatalog(products, booths, venueLayout);
export const productById = new Map(products.map((product): [string, Product] => [product.id, product]));
export const boothById = new Map(booths.map((booth): [string, Booth] => [booth.id, booth]));
export const dataGeneratedAt = products
  .flatMap((product) => product.sources.map((source) => source.retrievedAt))
  .sort()
  .at(-1) ?? "";
