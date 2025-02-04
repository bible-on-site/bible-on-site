/** @type {import('next').NextConfig} */
const nextConfig = {
  // TODO: check if can still work in next 15
  // ppr: "incremental",
  // esmExternals: true,
  // externalDir: true,
  // swcPlugins: process.env.TURBOPACK
  //   ? []
  //   : [["swc-plugin-coverage-instrument", {}]],
};

export default nextConfig;
