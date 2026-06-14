import { afterEach, describe, expect, it, vi } from "vitest";

const FIREBASE_ENV_KEYS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

async function importConfig() {
  vi.resetModules();
  return await import("@/lib/firebase/config");
}

function stubFirebaseEnv(value: string) {
  for (const key of FIREBASE_ENV_KEYS) {
    vi.stubEnv(key, value);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session cookie constants", () => {
  it("uses the Firebase-required '__session' cookie name", async () => {
    const { SESSION_COOKIE_NAME } = await importConfig();
    // Firebase Hosting / App Hosting only forwards a cookie named exactly
    // "__session" to the origin — any other name is stripped at the CDN.
    // Renaming this would silently break authenticated SSR.
    expect(SESSION_COOKIE_NAME).toBe("__session");
  });

  it("expires the session cookie after 5 days", async () => {
    const { SESSION_COOKIE_MAX_AGE_SEC } = await importConfig();
    expect(SESSION_COOKIE_MAX_AGE_SEC).toBe(60 * 60 * 24 * 5);
  });
});

describe("firebaseConfig", () => {
  it("exposes the six client-SDK fields", async () => {
    const { firebaseConfig } = await importConfig();
    expect(firebaseConfig).toEqual(
      expect.objectContaining({
        apiKey: expect.any(String),
        authDomain: expect.any(String),
        projectId: expect.any(String),
        storageBucket: expect.any(String),
        messagingSenderId: expect.any(String),
        appId: expect.any(String),
      }),
    );
  });

  it("falls back to dev-safe strings in development when env vars are unset", async () => {
    vi.stubEnv("NODE_ENV", "test");
    stubFirebaseEnv("");
    const { firebaseConfig } = await importConfig();

    // Treat each field individually so a future addition gets caught.
    for (const value of Object.values(firebaseConfig)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
    expect(firebaseConfig.apiKey).toMatch(/^AIza/);
  });

  it("keeps production missing-env behavior visible as empty strings", async () => {
    vi.stubEnv("NODE_ENV", "production");
    stubFirebaseEnv("");
    const { firebaseConfig } = await importConfig();

    expect(Object.values(firebaseConfig)).toEqual(["", "", "", "", "", ""]);
  });

  it("uses explicit env values when all Firebase Web config fields are set", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "real-api-key");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "auth.example.com");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "real-project");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "real-bucket");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "12345");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:12345:web:abc");

    const { firebaseConfig } = await importConfig();

    expect(firebaseConfig).toEqual({
      apiKey: "real-api-key",
      authDomain: "auth.example.com",
      projectId: "real-project",
      storageBucket: "real-bucket",
      messagingSenderId: "12345",
      appId: "1:12345:web:abc",
    });
  });
});
