#!/usr/bin/env node
/**
 * Grant or revoke the `contributor` custom claim on a Firebase user.
 *
 * Contributors can self-publish their OWN guides (no admin review),
 * but cannot edit anyone else's guide. Strictly less privileged than
 * `editor` — see scripts/set-editor.mjs for the cross-author tier.
 *
 * Normal flow: the `decideGuide` Server Action auto-grants this claim
 * on a user's first admin-approved guide. This script is the manual
 * fallback for bootstrap, recovery, or proactively trusting a known
 * contributor.
 *
 * Usage:
 *   node scripts/set-contributor.mjs <email> [--revoke]
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
 * JSON for the Firebase project, OR the FIREBASE_SERVICE_ACCOUNT env var
 * containing the JSON inline.
 */

import { getAuth } from "firebase-admin/auth";

import { initAdmin } from "./_lib/firebase-init.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/set-contributor.mjs <email> [--revoke]");
  process.exit(1);
}
const email = args[0];
const revoke = args.includes("--revoke");

initAdmin();

const auth = getAuth();
const user = await auth.getUserByEmail(email);
const claims = { ...(user.customClaims ?? {}), contributor: !revoke };
if (revoke) delete claims.contributor;
await auth.setCustomUserClaims(user.uid, claims);
console.log(
  `${revoke ? "Revoked" : "Granted"} contributor for ${email} (uid: ${user.uid}).`,
);
console.log("User must sign out and back in for the claim to take effect.");
