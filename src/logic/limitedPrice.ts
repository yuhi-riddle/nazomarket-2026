export function limitedPrice(
  price: number | null,
  priceNote: string | null,
): { label: "限定価格" | "先行価格"; regularPrice: number | null } | null {
  if (!priceNote || /M3/.test(priceNote)) return null;

  const match = /(?:通常(?:価格)?|定価|希望小売価格|一般販売(?:価格)?)[^\d]{0,12}(\d[\d,]*)\s*円/.exec(priceNote);
  const amount = match ? Number(match[1].replaceAll(",", "")) : null;
  const regularPrice = amount !== null && price !== null && amount > price ? amount : null;

  const isAdvance = /先行/.test(priceNote);
  const isExplicit = /限定価格|特別(?:割引)?価格|スペシャルプライス/.test(priceNote);
  // 「会場価格」「イベント価格」だけでは限定とは言えないので、通常より安いときに限る
  const isVenueDiscount = /ナゾ(?:トキ)?マーケット|ナゾマ/.test(priceNote) && /会場価格|イベント価格/.test(priceNote) && regularPrice !== null;
  if (!isAdvance && !isExplicit && !isVenueDiscount) return null;

  return { label: isAdvance ? "先行価格" : "限定価格", regularPrice };
}
