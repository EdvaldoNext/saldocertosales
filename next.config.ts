import type { NextConfig } from "next";

const noStore = [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@libsql/client", "libsql", "bcryptjs"],
  async headers() {
    return [
      { source: "/sw.js", headers: noStore },
      { source: "/version.js", headers: noStore },
      { source: "/manifest.json", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
