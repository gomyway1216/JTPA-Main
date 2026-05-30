import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Firebase Auth surfaces Google account avatars from this host
    // (used in the admin user table). next/image refuses unknown
    // remote hosts, so allow it explicitly.
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
