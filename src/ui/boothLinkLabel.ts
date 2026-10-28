/** 出典にあるURLの種類を、判別できる場合だけ表示する。 */
export function boothSiteLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const shop = /(^|\.)(booth\.pm|stores\.jp|thebase\.in|base\.shop)$/.test(host)
      || /(^|\.)(shop|store)\./.test(host);
    return (shop ? "ショップ" : "団体サイト") + "（" + host + "）";
  } catch {
    return "団体サイト";
  }
}
