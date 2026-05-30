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

  // Storage bucket for `adminStorage().bucket()`. The Admin SDK does NOT
  // infer a default bucket from the project id — without this option every
  // `.bucket()` call throws "Bucket name not specified or invalid"
  // synchronously. We reuse the SAME value the client embeds in its
  // download URLs (NEXT_PUBLIC_* is readable server-side too) so a URL
  // built client-side and validated server-side reference the identical
  // bucket name (e.g. `jtpa-main.firebasestorage.app`, NOT the legacy
  // `*.appspot.com` the SDK would otherwise have guessed).
  // `|| undefined` so an empty-string env var isn't passed as a literal
  // (invalid) bucket name — undefined lets `.bucket()` fail loudly only when
  // actually used, rather than the SDK treating "" as a real bucket. Per
  // PR #109 Gemini review.
  const storageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined;

  // FIREBASE_SERVICE_ACCOUNT lets you inject a JSON-stringified key in CI/dev.
  // In production (App Hosting / Cloud Run / GCE), ADC is picked up automatically.
  const inlineKey = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineKey) {
    return initializeApp({
      credential: cert(JSON.parse(inlineKey)),
      projectId,
      storageBucket,
    });
  }
  return initializeApp({ projectId, storageBucket });
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}

// Cached Firestore instance. Keeping a module-scoped cache means we only
// pay the `settings()` overhead once per module evaluation:
//
// - In production the module is evaluated once at boot; every subsequent
//   `adminDb()` returns the cached instance immediately, with no
//   throw/catch on the hot path.
// - In dev the cache is reset on every Turbopack module re-eval. The
//   first `adminDb()` after a re-eval calls `settings()` against a
//   Firestore that firebase-admin already configured under the previous
//   module instance — that throws, we swallow the "already been
//   initialized" error specifically, and cache the same Firestore. All
//   subsequent calls inside the re-eval window skip the throw.
let cachedDb: Firestore | null = null;

export function adminDb(): Firestore {
  if (cachedDb) return cachedDb;
  const db = getFirestore(getAdminApp());
  // Optional fields like `presentationTitle` come through as `undefined`
  // when the user is an attendee, not a presenter. Without
  // `ignoreUndefinedProperties: true`, Firestore throws "Cannot use
  // 'undefined' as a Firestore value", which surfaces in Next.js
  // production as the generic Server Components render error.
  //
  // `settings()` can only be called once per Firestore instance — second
  // call throws "Firestore has already been initialized". firebase-admin
  // keeps the Firestore singleton attached to the App object across
  // Turbopack hot reloads, while our `cachedDb` dies on every re-eval —
  // so the post-reload first call lands on an already-configured
  // Firestore and throws. We can't switch to `initializeFirestore`
  // either; its public `FirestoreSettings` type only exposes
  // `preferRest` and silently drops everything else
  // (`ignoreUndefinedProperties` included).
  //
  // Swallow only the specific "already initialized" error. Settings are
  // a static literal so this is genuinely idempotent — there is no risk
  // of silently overriding a different config.
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
  cachedDb = db;
  return db;
}

export function adminStorage(): Storage {
  return getStorage(getAdminApp());
}
