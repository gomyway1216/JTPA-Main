const DEV_FIREBASE_CONFIG = {
  apiKey: "AIzaSyD-000000000000000000000000000000000",
  authDomain: "demo-jtpa-main.firebaseapp.com",
  projectId: "demo-jtpa-main",
  storageBucket: "demo-jtpa-main.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
};

function publicEnv(name: string, devFallback: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  return process.env.NODE_ENV === "production" ? "" : devFallback;
}

export const firebaseConfig = {
  apiKey: publicEnv("NEXT_PUBLIC_FIREBASE_API_KEY", DEV_FIREBASE_CONFIG.apiKey),
  authDomain: publicEnv(
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    DEV_FIREBASE_CONFIG.authDomain,
  ),
  projectId: publicEnv(
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    DEV_FIREBASE_CONFIG.projectId,
  ),
  storageBucket: publicEnv(
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    DEV_FIREBASE_CONFIG.storageBucket,
  ),
  messagingSenderId: publicEnv(
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    DEV_FIREBASE_CONFIG.messagingSenderId,
  ),
  appId: publicEnv("NEXT_PUBLIC_FIREBASE_APP_ID", DEV_FIREBASE_CONFIG.appId),
};

export const useEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

export const SESSION_COOKIE_NAME = "__session";
export const SESSION_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 5; // 5 days
