import { argv } from "process";

/** @type {import('next').NextConfig} */
const nextConfig = {
	experimental: {
		ppr: "incremental",
		esmExternals: true,
		externalDir: true,
		swcPlugins: process.env.TURBOPACK
			? []
			: [["swc-plugin-coverage-instrument", {}]],
	},
};

export default nextConfig;
