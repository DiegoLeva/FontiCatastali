/** @type {import('next').NextConfig} */

/**
 * Header di sicurezza a basso rischio (nessuna CSP rigida: lo script anti-FOUC
 * inline e gli stili inline di Framer Motion la renderebbero fragile).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // @libsql/client e unpdf (pdf.js) non vanno inclusi nel bundle server:
    // restano moduli Node esterni, tracciati da Vercel come dipendenze.
    serverComponentsExternalPackages: ["@libsql/client", "unpdf"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
