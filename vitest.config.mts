import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws on import outside Next's bundler. Replace it
      // with an empty shim so we can unit-test modules that declare the
      // server-only sentinel.
      "server-only": fileURLToPath(
        new URL("./__tests__/server-only-shim.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    // Pin TZ so the ja-JP date/time formatters in src/lib/utils.ts produce
    // identical strings across local machines and CI. The app is JST-only
    // (Asia/Tokyo) and the formatters render JST regardless of host TZ, so
    // tests assert against JST clock values.
    env: {
      TZ: "Asia/Tokyo",
    },
  },
});
