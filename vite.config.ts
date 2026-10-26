import { defineConfig } from "vitest/config";

export default defineConfig({
  // 相対パスで出力し、GitHub Pages のサブパスやローカル配信でも動くようにする
  base: "./",
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
