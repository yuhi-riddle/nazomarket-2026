import type { TabId } from "../state.ts";

export function appStartupPlan(
  selectedTab: TabId,
  hasSharedCredentials: boolean,
  needsSharedLinkPaste: boolean,
  hasSharedApi: boolean,
): { initialTab: TabId; preconnectSharedList: boolean } {
  return {
    initialTab: needsSharedLinkPaste ? "cart" : selectedTab,
    preconnectSharedList: hasSharedCredentials && hasSharedApi,
  };
}
