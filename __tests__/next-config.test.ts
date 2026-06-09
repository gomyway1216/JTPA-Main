import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getRewrittenUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";

import nextConfig from "../next.config";

describe("next.config rewrites", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("proxies Firebase Auth helper paths to the Firebase Hosting helper origin", async () => {
    const response = await unstable_getResponseFromNextConfig({
      nextConfig,
      url: "https://bayarea-ai.com/__/auth/handler",
    });

    expect(getRewrittenUrl(response)).toBe(
      "https://jtpa-main.firebaseapp.com/__/auth/handler",
    );
  });

  it("builds the Firebase Hosting helper origin from NEXT_PUBLIC_FIREBASE_PROJECT_ID", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "demo-project");
    vi.resetModules();
    const { default: configWithEnv } = await import("../next.config");

    const response = await unstable_getResponseFromNextConfig({
      nextConfig: configWithEnv,
      url: "https://demo.example/__/auth/handler",
    });

    expect(getRewrittenUrl(response)).toBe(
      "https://demo-project.firebaseapp.com/__/auth/handler",
    );
  });

  it("proxies Firebase SDK helper assets to the Firebase Hosting helper origin", async () => {
    const response = await unstable_getResponseFromNextConfig({
      nextConfig,
      url: "https://bayarea-ai.com/__/firebase/10.0.0/firebase-app.js",
    });

    expect(getRewrittenUrl(response)).toBe(
      "https://jtpa-main.firebaseapp.com/__/firebase/10.0.0/firebase-app.js",
    );
  });

  it("serves Firebase init config from the app before the SDK asset fallback", async () => {
    const response = await unstable_getResponseFromNextConfig({
      nextConfig,
      url: "https://bayarea-ai.com/__/firebase/init.json",
    });

    expect(getRewrittenUrl(response)).toBe(
      "https://bayarea-ai.com/api/firebase/init",
    );
  });
});
