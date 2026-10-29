const unconfirmedNames: Record<string, string> = {
  price: "価格",
  difficulty: "難易度",
  playMinutes: "所要時間",
  players: "人数",
  isNew: "新作かどうか",
  imageUrl: "画像",
  payment: "支払い",
};

/** 取れなかった項目を、利用者向けの名前で並べる。名前の無い項目は出さない。 */
export function unconfirmedText(keys: string[]): string {
  const names = keys.flatMap((key) => unconfirmedNames[key] ?? []);
  return names.length ? "未確認: " + names.join("・") : "";
}
