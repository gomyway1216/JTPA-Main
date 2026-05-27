#!/usr/bin/env node
/**
 * Grant or revoke the `admin` custom claim on a Firebase user.
 *
 * Usage:
 *   node scripts/set-admin.mjs <email> [--revoke]
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
 * JSON for the Firebase project, OR the FIREBASE_SERVICE_ACCOUNT env var
 * containing the JSON inline.
 */

import { getAuth } from "firebase-admin/auth";

import { initAdmin } from "./_lib/firebase-init.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/set-admin.mjs <email> [--revoke]");
  process.exit(1);
}
const email = args[0];
const revoke = args.includes("--revoke");

initAdmin();

const auth = getAuth();
const user = await auth.getUserByEmail(email);
const claims = { ...(user.customClaims ?? {}), admin: !revoke };
if (revoke) delete claims.admin;
await auth.setCustomUserClaims(user.uid, claims);
console.log(
  `${revoke ? "Revoked" : "Granted"} admin for ${email} (uid: ${user.uid}).`,
);
console.log("User must sign out and back in for the claim to take effect.");
