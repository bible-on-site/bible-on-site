/** @type {import('next').NextConfig} */
const nextConfig = {
	experimental: {
		ppr: "incremental",
		esmExternals: true,
		externalDir: true,
		swcPlugins: [["swc-plugin-coverage-instrument", {}]],
	},
};

export default nextConfig;
