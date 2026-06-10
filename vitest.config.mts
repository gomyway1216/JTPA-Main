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
    coverage: {
      provider: "v8",
      // Coverage is scoped to the layers the unit suite actually exercises:
      // pure logic in src/lib/** and the Server Actions in
      // src/app/actions/**. Pages/layouts/components under src/app/** and
      // src/components/** are server/client components that only run inside
      // Next's runtime — including them would bury the signal in
      // untestable 0% files.
      include: ["src/lib/**/*.{ts,tsx}", "src/app/actions/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/*.generated.*"],
      reporter: ["text", "html"],
      // Ratchet floors: ~5 points below the suite's actual numbers when
      // thresholds were introduced (stmts 35.82%, branches 35.03%,
      // funcs 50.31%, lines 35.80%), so CI fails on a coverage regression
      // without blocking unrelated PRs. Raise them as coverage grows;
      // never lower them to get a PR green.
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 45,
        lines: 30,
      },
    },
  },
});
