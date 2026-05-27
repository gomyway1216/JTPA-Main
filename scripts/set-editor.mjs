#!/usr/bin/env node
/**
 * Grant or revoke the `editor` custom claim on a Firebase user.
 *
 * Editors can create, edit, and publish entries in the `guides` collection
 * but do NOT get admin powers (events, projects, user management).
 *
 * Usage:
 *   node scripts/set-editor.mjs <email> [--revoke]
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account
 * JSON for the Firebase project, OR the FIREBASE_SERVICE_ACCOUNT env var
 * containing the JSON inline.
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/set-editor.mjs <email> [--revoke]");
  process.exit(1);
}
const email = args[0];
const revoke = args.includes("--revoke");

const projectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
  process.env.GOOGLE_CLOUD_PROJECT;

const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!getApps().length) {
  initializeApp(
    inline
      ? { credential: cert(JSON.parse(inline)), projectId }
      : { projectId },
  );
}

const auth = getAuth();
const user = await auth.getUserByEmail(email);
const claims = { ...(user.customClaims ?? {}), editor: !revoke };
if (revoke) delete claims.editor;
await auth.setCustomUserClaims(user.uid, claims);
console.log(
  `${revoke ? "Revoked" : "Granted"} editor for ${email} (uid: ${user.uid}).`,
);
console.log("User must sign out and back in for the claim to take effect.");
