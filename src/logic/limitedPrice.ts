export function limitedPrice(
  price: number | null,
  priceNote: string | null,
): { label: "限定価格" | "先行価格"; regularPrice: number | null } | null {
  if (!priceNote) return null;
  if (/M3/.test(priceNote)) return null;

  const hasLocalContext = /ナゾ(?:トキ)?マーケット|ナゾマ/.test(priceNote);
  const isAdvance = /先行/.test(priceNote) && hasLocalContext;
  const isLimited = /会場限定価格|限定価格|特別価格|スペシャルプライス/.test(priceNote)
    || (hasLocalContext && /会場価格|イベント価格/.test(priceNote));
  const hasStandaloneAdvance = /先行/.test(priceNote);
  const hasSpecialDiscount = /特別割引価格/.test(priceNote);
  if (!isLimited && !isAdvance && !hasStandaloneAdvance && !hasSpecialDiscount) return null;

  const match = /(?:通常(?:価格)?|定価|希望小売価格|一般販売価格)[^\d]{0,12}(\d[\d,]*)\s*円/.exec(priceNote);
  const generalSaleMatch = /一般販売(?:価格)?[^\d]{0,12}(\d[\d,]*)\s*円/.exec(priceNote);
  const amountMatch = generalSaleMatch ?? match;
  const amount = amountMatch ? Number(amountMatch[1].replaceAll(",", "")) : null;
  const regularPrice = amount !== null && price !== null && amount > price ? amount : null;
  return { label: hasStandaloneAdvance ? "先行価格" : "限定価格", regularPrice };
}
