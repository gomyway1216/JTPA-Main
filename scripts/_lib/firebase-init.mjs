/**
 * Shared Firebase Admin init for one-off scripts.
 *
 * Why this exists: each script used to silently fall back to whatever
 * project ADC's gcloud default was set to when none of the env vars
 * were present, which meant running e.g. `npm run seed-guides` on a
 * machine whose `gcloud config get-value project` pointed somewhere
 * else would happily write seed data into the wrong Firestore. The
 * helper now refuses to run when the project ID isn't explicitly set,
 * with a hint about how to pass it.
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";

export function resolveProjectId() {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    console.error(
      "ERROR: Firebase project ID is not set.\n" +
        "  Set NEXT_PUBLIC_FIREBASE_PROJECT_ID, FIREBASE_PROJECT_ID, or\n" +
        "  GOOGLE_CLOUD_PROJECT before running, e.g.:\n" +
        "    NEXT_PUBLIC_FIREBASE_PROJECT_ID=jtpa-main npm run <script>\n" +
        "  (.env.local is NOT auto-loaded by these scripts — `node` runs\n" +
        "  outside Next.js, so the env var must be exported in your shell.)",
    );
    process.exit(1);
  }
  return projectId;
}

export function initAdmin() {
  const projectId = resolveProjectId();
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!getApps().length) {
    initializeApp(
      inline
        ? { credential: cert(JSON.parse(inline)), projectId }
        : { projectId },
    );
  }
  return projectId;
}
