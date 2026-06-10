#!/usr/bin/env node
/**
 * Grant or revoke the `admin` custom claim on a Firebase user.
 *
 * Usage:
 *   node scripts/set-admin.mjs <email> [--revoke] [--dry-run]
 *
 * --dry-run resolves the user and prints the claim change that would be
 * made (current → new) without writing anything.
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
 * JSON for the Firebase project, OR the FIREBASE_SERVICE_ACCOUNT env var
 * containing the JSON inline.
 */

import { getAuth } from "firebase-admin/auth";

import { initAdmin } from "./_lib/firebase-init.mjs";

const USAGE =
  "Usage: node scripts/set-admin.mjs <email> [--revoke] [--dry-run]";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positionals = args.filter((a) => !a.startsWith("--"));
const unknownFlags = flags.filter((f) => f !== "--revoke" && f !== "--dry-run");
if (positionals.length !== 1 || unknownFlags.length > 0) {
  if (unknownFlags.length > 0) {
    console.error(`Unknown flag(s): ${unknownFlags.join(", ")}`);
  }
  console.error(USAGE);
  process.exit(1);
}
const [email] = positionals;
const revoke = flags.includes("--revoke");
const dryRun = flags.includes("--dry-run");

initAdmin();

const auth = getAuth();
let user;
try {
  user = await auth.getUserByEmail(email);
} catch (err) {
  if (err?.code === "auth/user-not-found") {
    console.error(`ERROR: no Firebase user exists with email ${email}.`);
    process.exit(1);
  }
  if (err?.code === "auth/invalid-email") {
    console.error(`ERROR: "${email}" is not a valid email address.`);
    process.exit(1);
  }
  throw err;
}

// Show the operator exactly what they're touching before any write.
const before = user.customClaims ?? {};
console.log(`Target user:    ${user.email} (uid: ${user.uid})`);
console.log(`Current claims: ${JSON.stringify(before)}`);

const claims = { ...before, admin: !revoke };
if (revoke) delete claims.admin;
console.log(`New claims:     ${JSON.stringify(claims)}`);

if (dryRun) {
  console.log(
    `[dry-run] Would ${revoke ? "revoke" : "grant"} admin for ${email}; nothing written.`,
  );
  process.exit(0);
}

await auth.setCustomUserClaims(user.uid, claims);
console.log(
  `${revoke ? "Revoked" : "Granted"} admin for ${email} (uid: ${user.uid}).`,
);
console.log("User must sign out and back in for the claim to take effect.");
