import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/__/auth/:path*",
          destination: "https://jtpa-main.firebaseapp.com/__/auth/:path*",
        },
        {
          source: "/__/firebase/init.json",
          destination:
            "https://jtpa-main.firebaseapp.com/__/firebase/init.json",
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
