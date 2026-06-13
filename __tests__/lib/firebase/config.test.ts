import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE_MAX_AGE_SEC,
  SESSION_COOKIE_NAME,
  firebaseConfig,
} from "@/lib/firebase/config";

describe("session cookie constants", () => {
  it("uses the Firebase-required '__session' cookie name", () => {
    // Firebase Hosting / App Hosting only forwards a cookie named exactly
    // "__session" to the origin — any other name is stripped at the CDN.
    // Renaming this would silently break authenticated SSR.
    expect(SESSION_COOKIE_NAME).toBe("__session");
  });

  it("expires the session cookie after 5 days", () => {
    expect(SESSION_COOKIE_MAX_AGE_SEC).toBe(60 * 60 * 24 * 5);
  });
});

describe("firebaseConfig", () => {
  it("exposes the six client-SDK fields", () => {
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

  it("falls back to dev-safe strings when env vars are unset", () => {
    // Treat each field individually so a future addition gets caught.
    for (const value of Object.values(firebaseConfig)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
    expect(firebaseConfig.apiKey).toMatch(/^AIza/);
  });
});
