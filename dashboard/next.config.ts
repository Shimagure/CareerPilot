import type { NextConfig } from "next";

const adminApiUrl = (
  process.env.CAREERPILOT_ADMIN_API_URL || "http://localhost:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  allowedDevOrigins: ["careerpilot"],
  async rewrites() {
    return [
      {
        source: "/api/admin/:path*",
        destination: `${adminApiUrl}/api/admin/:path*`,
      },
    ];
  },
};

export default nextConfig;
