/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    ppr: "incremental",
    esmExternals: true,
    externalDir: true,
  },
};

export default nextConfig;
