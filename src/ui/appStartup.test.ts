import { describe, expect, it } from "vitest";
import { appStartupPlan } from "./appStartup.ts";

describe("app startup with a shared room", () => {
  it("keeps the selected tab while preconnecting a room with saved credentials", () => {
    expect(appStartupPlan("map", true, false, true)).toEqual({
      initialTab: "map",
      preconnectSharedList: true,
    });
  });

  it("opens the list tab when the shared link key needs to be pasted", () => {
    expect(appStartupPlan("catalog", false, true, true)).toEqual({
      initialTab: "cart",
      preconnectSharedList: false,
    });
  });
});
