import "server-only";

import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, getAuth } from "firebase-admin/auth";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { Storage, getStorage } from "firebase-admin/storage";

let cachedApp: App | null = null;
let cachedDb: Firestore | null = null;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  if (getApps().length) {
    cachedApp = getApps()[0];
    return cachedApp;
  }

  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  // FIREBASE_SERVICE_ACCOUNT lets you inject a JSON-stringified key in CI/dev.
  // In production (App Hosting / Cloud Run / GCE), ADC is picked up automatically.
  const inlineKey = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineKey) {
    cachedApp = initializeApp({
      credential: cert(JSON.parse(inlineKey)),
      projectId,
    });
  } else {
    cachedApp = initializeApp({ projectId });
  }
  return cachedApp;
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function adminDb(): Firestore {
  if (cachedDb) return cachedDb;
  const db = getFirestore(getAdminApp());
  // Optional fields like `presentationTitle` come through as `undefined` when
  // the user is an attendee, not a presenter. Without this, Firestore throws
  // "Cannot use 'undefined' as a Firestore value", which surfaces in Next.js
  // production as the generic Server Components render error.
  db.settings({ ignoreUndefinedProperties: true });
  cachedDb = db;
  return cachedDb;
}

export function adminStorage(): Storage {
  return getStorage(getAdminApp());
}
