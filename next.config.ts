import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "twilio"],
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/*": ["./db/migrations/*.sql"],
  },
  devIndicators: process.env.UPTICK_DEMO_MODE === "true" ? false : undefined,
  turbopack: {},
  experimental:
    process.env.UPTICK_LOW_DISK === "true"
      ? { cpus: 1, staticGenerationMaxConcurrency: 1 }
      : undefined,
  webpack(config) {
    if (process.env.UPTICK_LOW_DISK === "true") config.cache = false;
    return config;
  },
  logging: {
    incomingRequests: {
      ignore: [/\/(p|t|u|tap|phone-change)\//, /\/account\/recovery/],
    },
    browserToTerminal: false,
    serverFunctions: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === "development" ? "'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};
export default config;
