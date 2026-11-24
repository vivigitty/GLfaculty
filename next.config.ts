import type { NextConfig } from "next";
import os from "node:os";

/**
 * Dev only: hosts other than localhost that may load the dev server's scripts.
 * This machine's own IPv4 addresses are allowed automatically (they change with DHCP),
 * plus anything listed in DEV_ALLOWED_ORIGINS (comma-separated hostnames/IPs).
 * Production builds ignore this setting.
 */
function devOrigins(): string[] {
  const own = Object.values(os.networkInterfaces())
    .flat()
    .filter((i): i is os.NetworkInterfaceInfo => Boolean(i && i.family === "IPv4" && !i.internal))
    .map((i) => i.address);
  const extra = (process.env.DEV_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([...own, ...extra])];
}

const nextConfig: NextConfig = {
  // pdfkit reads its font metric files from disk at runtime; keep it out of the bundle.
  serverExternalPackages: ["pdfkit", "bcryptjs", "nodemailer"],
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
