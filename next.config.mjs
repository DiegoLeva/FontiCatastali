/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @libsql/client non va incluso nel bundle server: lasciato esterno
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client"],
  },
};

export default nextConfig;
