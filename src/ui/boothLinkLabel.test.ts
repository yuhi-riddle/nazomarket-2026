import { describe, expect, it } from "vitest";
import { boothLinkLabel } from "./boothLinkLabel.ts";

describe("boothLinkLabel", () => {
  it("用途が分からないサイトは公式HPと決めつけず、行き先を示す", () => {
    expect(boothLinkLabel("https://www.example.com/about", "site")).toBe("example.com/about");
  });

  it("既知のショップ基盤はショップと表示する", () => {
    expect(boothLinkLabel("https://booth.pm/items/123", "site")).toBe("ショップ · booth.pm/items/123");
  });

  it("XのプロフィールURLはアカウント名で区別する", () => {
    expect(boothLinkLabel("https://x.com/example", "x")).toBe("@example");
  });

  it("Xのプロフィール以外はURLの行き先をそのまま示す", () => {
    expect(boothLinkLabel("https://x.com/i/web/status/123", "x")).toBe("x.com/i/web/status/123");
  });
});
