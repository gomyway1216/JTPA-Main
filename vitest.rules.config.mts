import { defineConfig } from "vitest/config";

// Config for the Firestore/Storage security-rules tests only. These talk to
// the Firebase emulators, so they are excluded from vitest.config.mts and
// run via `npm run test:rules`, which wraps vitest in
// `firebase emulators:exec` so the emulators are up for the whole run.
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/rules/**/*.test.ts"],
    // Both suites share one emulator instance and clear its state between
    // tests, so the files must not run concurrently.
    fileParallelism: false,
    // Emulator round-trips (rules compilation, clearFirestore, uploads) are
    // much slower than unit tests, especially on CI cold starts.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
