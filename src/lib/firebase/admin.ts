import "server-only";

import { App, cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, getAuth } from "firebase-admin/auth";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { Storage, getStorage } from "firebase-admin/storage";

function getAdminApp(): App {
  if (getApps().length) return getApps()[0];

  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  // FIREBASE_SERVICE_ACCOUNT lets you inject a JSON-stringified key in CI/dev.
  // In production (App Hosting / Cloud Run / GCE), ADC is picked up automatically.
  const inlineKey = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineKey) {
    return initializeApp({
      credential: cert(JSON.parse(inlineKey)),
      projectId,
    });
  }
  return initializeApp({ projectId });
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function adminDb(): Firestore {
  const db = getFirestore(getAdminApp());
  // Optional fields like `presentationTitle` come through as `undefined`
  // when the user is an attendee, not a presenter. Without
  // `ignoreUndefinedProperties: true`, Firestore throws "Cannot use
  // 'undefined' as a Firestore value", which surfaces in Next.js
  // production as the generic Server Components render error.
  //
  // `settings()` can only be called once per Firestore instance — second
  // call throws "Firestore has already been initialized". That's awkward
  // here because firebase-admin keeps the Firestore singleton attached to
  // the App object across Turbopack hot reloads, while our own
  // module-scoped cache dies on every re-eval. We can't switch to
  // `initializeFirestore` either; its public `FirestoreSettings` type
  // only exposes `preferRest` and silently drops everything else
  // (`ignoreUndefinedProperties` included).
  //
  // The pragmatic shape that survives both production and the
  // hot-reload edge case: call settings every time and swallow only the
  // specific "already initialized" error. Settings are static (same
  // object literal each call) so this is genuinely idempotent — there
  // is no risk of overriding a different config silently.
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (err) {
    if (
      !(err instanceof Error) ||
      !err.message.includes("already been initialized")
    ) {
      throw err;
    }
  }
  return db;
}

export function adminStorage(): Storage {
  return getStorage(getAdminApp());
}
