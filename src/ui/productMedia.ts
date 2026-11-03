import { CATEGORY_NAMES, type ProductView } from "../logic/catalog.ts";
import { imageCropFor, imageCropLayout } from "../logic/imageCrop.ts";
import { productImage } from "../logic/remoteImage.ts";
import { imageCrops } from "../data.ts";
import { el } from "./dom.ts";

export function productMedia(product: ProductView["product"]): HTMLDivElement {
  const media = el("div", "product-media");
  const crop = imageCropFor(product, imageCrops);
  const cropLayout = crop ? imageCropLayout(crop) : null;
  if (cropLayout) media.classList.add("product-media-cropped");
  const fallback = el("span", "image-fallback", CATEGORY_NAMES[product.category]);
  const imageSrc = productImage(product);
  if (imageSrc) {
    const image = el("img", "product-image");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 640;
    image.height = 480;
    let cropFrame: HTMLDivElement | null = null;
    if (cropLayout) {
      cropFrame = el("div", "product-image-crop");
      cropFrame.style.setProperty("--crop-ratio", String(cropLayout.aspectRatio));
      image.style.width = cropLayout.widthPercent + "%";
      image.style.height = cropLayout.heightPercent + "%";
      image.style.left = cropLayout.leftPercent + "%";
      image.style.top = cropLayout.topPercent + "%";
      cropFrame.append(image);
    }
    image.addEventListener("error", () => {
      image.hidden = true;
      if (cropFrame) cropFrame.hidden = true;
      fallback.hidden = false;
    }, { once: true });
    fallback.hidden = true;
    if (cropFrame) media.append(cropFrame, fallback);
    else media.append(image, fallback);
    image.src = imageSrc;
  } else {
    media.append(fallback);
  }
  return media;
}
