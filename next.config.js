const createNextIntlPlugin = require("next-intl/plugin");

const firebaseProjectId =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "jtpa-main";
const firebaseHostingOrigin = `https://${firebaseProjectId}.firebaseapp.com`;

const nextConfig = {
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
    unoptimized: process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true",
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        pathname: "/v0/b/**",
      },
    ],
  },
};

const withNextIntl = createNextIntlPlugin();

module.exports = withNextIntl(nextConfig);
