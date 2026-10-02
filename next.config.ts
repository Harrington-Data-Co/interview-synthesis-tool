import type { NextConfig } from "next";

// Where the app sits on its domain; see src/lib/basePath.ts. Empty locally,
// "/interview-synthesis" on tools.harringtondata.com.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  basePath: basePath || undefined,

  async redirects() {
    // Until the Harrington Tools hub exists, its root sends people here.
    return basePath ? [{ source: "/", destination: basePath, basePath: false, permanent: false }] : [];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never framed by another site (clickjacking).
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Links out (Drive, Meet) don't carry client and project names in the URL they came from.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS only, once deployed. Browsers ignore this over plain http, so it's harmless locally.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
