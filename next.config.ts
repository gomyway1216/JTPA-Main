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
    // Firebase Auth surfaces Google account avatars from this host
    // (used in the admin user table). next/image refuses unknown
    // remote hosts, so allow it explicitly.
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
