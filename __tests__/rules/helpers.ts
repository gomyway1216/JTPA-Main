import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

// Well-known uids reused across the rules suites. Auth contexts built from
// them carry custom claims exactly the way the rules read them
// (`request.auth.token.admin` etc. — set in production by
// scripts/set-admin.mjs and friends).
export const ALICE = "alice";
export const BOB = "bob";
export const CAROL = "carol";
export const ADMIN = "admin-user";
export const EDITOR = "editor-user";
export const CONTRIBUTOR = "contributor-user";

function rulesFile(file: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${file}`, import.meta.url)),
    "utf8",
  );
}

// Both suites talk to the emulators started by `npm run test:rules`
// (firebase emulators:exec). Hosts/ports mirror firebase.json so the suite
// also works against a manually started `firebase emulators:start`.
export function createRulesTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    // demo-* project ids are emulator-only, so no credentials are needed.
    // Must match the --project flag in the `test:rules` npm script.
    projectId: "demo-jtpa",
    firestore: {
      rules: rulesFile("firestore.rules"),
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: rulesFile("storage.rules"),
      host: "127.0.0.1",
      port: 9199,
    },
  });
}

// RulesTestContext hands back compat-typed instances, but the modular
// firebase/* entry points unwrap compat wrappers at runtime
// (getModularInstance), so these casts let the tests use the same modular
// API style as src/.
export function firestoreOf(ctx: RulesTestContext): Firestore {
  return ctx.firestore() as unknown as Firestore;
}

export function storageOf(ctx: RulesTestContext): FirebaseStorage {
  return ctx.storage() as unknown as FirebaseStorage;
}
