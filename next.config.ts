import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const firebaseProjectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "jtpa-main";
const firebaseHostingOrigin = `https://${firebaseProjectId}.firebaseapp.com`;

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/__/auth/:path*",
          destination: `${firebaseHostingOrigin}/__/auth/:path*`,
        },
        {
          source: "/__/firebase/init.json",
          destination: "/api/firebase/init",
        },
      ],
      afterFiles: [
        {
          source: "/__/firebase/:path*",
          destination: `${firebaseHostingOrigin}/__/firebase/:path*`,
        },
      ],
    };
  },
  images: {
    // With the Firebase emulators on, uploaded assets resolve to a
    // local-only host (e.g. http://localhost:9199 — see
    // `publicDownloadUrl()` in src/lib/firebase/uploads.ts), which the
    // image optimizer refuses to fetch. Serve images as-is in that mode;
    // production keeps full optimization.
    unoptimized: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true",
    remotePatterns: [
      // Firebase Auth surfaces Google account avatars from this host
      // (used in the admin user table). next/image refuses unknown
      // remote hosts, so allow it explicitly.
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      // User-uploaded content (event/blog covers, showcase thumbnails
      // and screenshots, custom avatars) lives in Firebase Storage and
      // is addressed via token-less download URLs built by
      // `publicDownloadUrl()` in src/lib/firebase/uploads.ts. The
      // pathname pins the download-API shape; the query string is left
      // open because the URLs carry `?alt=media` (and legacy ones may
      // carry `&token=`).
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/v0/b/**",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
