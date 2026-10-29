const organizationNameLimit = 7;

export function mapSelectionSummary(
  boothCode: string,
  organizationName: string,
  listedItems: readonly { bought: boolean }[],
): string {
  const characters = Array.from(organizationName);
  const shortName = characters.length > organizationNameLimit
    ? characters.slice(0, organizationNameLimit).join("") + "…"
    : organizationName;
  const unboughtCount = listedItems.filter((item) => !item.bought).length;
  return `${boothCode} ${shortName} ・リスト${listedItems.length}件（未購入${unboughtCount}件）`;
}
