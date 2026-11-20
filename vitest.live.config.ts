import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Live checks against Stellar testnet. Run with `pnpm test:live`. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) } },
  test: { include: ["tests/live/**/*.live.test.ts"], environment: "node", testTimeout: 180_000, hookTimeout: 180_000, fileParallelism: false },
});
