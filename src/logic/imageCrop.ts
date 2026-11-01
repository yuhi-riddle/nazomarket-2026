export type ImageCrop = {
  imageUrl: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export function imageCropFor(
  product: { id: string; imageUrl: string | null },
  crops: Record<string, ImageCrop>,
): ImageCrop | null {
  if (!product.imageUrl) return null;
  const crop = crops[product.id];
  return crop?.imageUrl === product.imageUrl ? crop : null;
}

export function imageCropLayout(crop: ImageCrop): {
  aspectRatio: number;
  widthPercent: number;
  heightPercent: number;
  leftPercent: number;
  topPercent: number;
} {
  const visibleWidth = 1 - crop.left - crop.right;
  const visibleHeight = 1 - crop.top - crop.bottom;
  return {
    aspectRatio: crop.width * visibleWidth / (crop.height * visibleHeight),
    widthPercent: 100 / visibleWidth,
    heightPercent: 100 / visibleHeight,
    leftPercent: -crop.left / visibleWidth * 100,
    topPercent: crop.top === 0 ? 0 : -crop.top / visibleHeight * 100,
  };
}
