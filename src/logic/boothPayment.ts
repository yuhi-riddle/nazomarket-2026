import { acceptsCashless } from "./cart.ts";

export function boothPayment(
  payments: ReadonlyArray<readonly string[] | null>,
): { text: string; cashOnly: boolean; unknown: boolean } {
  const methods: string[] = [];
  const methodSet = new Set<string>();
  const productMethods = new Set<string>();
  let hasUnknownProduct = false;
  let hasCashless = false;

  for (const payment of payments) {
    if (!payment?.length) {
      hasUnknownProduct = true;
      continue;
    }
    if (acceptsCashless(payment)) hasCashless = true;
    for (const method of payment) {
      if (methodSet.has(method)) continue;
      methodSet.add(method);
      methods.push(method);
    }
    const signature = acceptsCashless(payment)
      ? [...new Set(payment.map((method) => method === "現金のみ" ? "現金" : method))].sort()
      : ["現金のみ"];
    productMethods.add(JSON.stringify(signature));
  }

  const unknown = methods.length === 0;
  if (unknown) return { text: "支払い: 未確認", cashOnly: false, unknown: true };

  const suffixes: string[] = [];
  if (productMethods.size > 1) suffixes.push("商品により異なる");
  if (hasUnknownProduct) suffixes.push("一部未確認");
  const suffix = suffixes.length > 0 ? "（" + suffixes.join("・") + "）" : "";
  const cashOnly = !hasUnknownProduct && !hasCashless;
  const text = hasCashless ? methods.join("・") : "現金のみ";

  return {
    text: "支払い: " + text + suffix,
    cashOnly,
    unknown: false,
  };
}
