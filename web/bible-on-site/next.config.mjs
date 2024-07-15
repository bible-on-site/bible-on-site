import { argv } from "process";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    esmExternals: true,
    externalDir: true,
    ppr: "incremental",
    swcPlugins: process.env.TURBOPACK
      ? []
      : [["swc-plugin-coverage-instrument", {}]],
  },
};

export default nextConfig;
