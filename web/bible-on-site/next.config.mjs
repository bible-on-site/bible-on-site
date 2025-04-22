/** @type {import('next').NextConfig} */
const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;
const nextConfig = {
	output: "standalone",
	experimental: {
		esmExternals: true,
		externalDir: true,
		swcPlugins:
			// Currently there are a few bugs with swc-plugin-coverage-instrument when using turbopack
			// 1. It decorates next/font with some overhead which breaks a next constraint that next/font should be top level something
			//    This can be solved quite easily by adding "layout.tsx" to the unstableExclude array (and maybe break layout.tsx in order to lose as least coverage data as possible)
			// 2. It resolves source paths as just their name breaking coverage tree structure
			//    TODO: open an issue in swc-plugin-coverage-instrument repo with an MCVE
			process.env.TURBOPACK
				? []
				: [
						[
							"swc-plugin-coverage-instrument",
							{ unstableExclude: ["coverage/route.ts"] },
						],
					],
	},
	allowedDevOrigins: ["127.0.0.1"],
	cacheMaxMemorySize: 1 * GB,
};

export default nextConfig;
