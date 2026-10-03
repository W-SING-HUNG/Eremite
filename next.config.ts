import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Development and production must never rewrite the same runtime chunks.
  distDir: process.env.EREMITE_NEXT_DIST_DIR ?? (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  // Eremite owns its concise engineering guide; do not generate framework-specific agent text into it.
  agentRules: false,
  // The local smoke harness uses the loopback address while the dev server advertises localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Server-side PDF validation must load the installed Node build directly;
  // bundling pdfjs into a Next server chunk breaks its worker/module resolution.
  serverExternalPackages: ["pdfjs-dist/legacy/build/pdf.mjs"],
};

export default nextConfig;
