import { describe, expect, it } from "vitest";
import { sharedPanelOpen } from "./sharedPanelOpen.ts";

describe("sharedPanelOpen", () => {
  it("何もしていなければ閉じておく", () => {
    expect(sharedPanelOpen({ userChoice: null, needsMe: false })).toBe(false);
  });

  it("参加したのに自分が未選択なら開いておく", () => {
    expect(sharedPanelOpen({ userChoice: null, needsMe: true })).toBe(true);
  });

  it("手で開閉したらその操作を優先する", () => {
    expect(sharedPanelOpen({ userChoice: true, needsMe: false })).toBe(true);
    expect(sharedPanelOpen({ userChoice: false, needsMe: true })).toBe(false);
  });
});
