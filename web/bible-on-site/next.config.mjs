const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

import { covIgnoreList } from "./.covignore.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	turbopack: {
		root: import.meta.dirname,
	},
	experimental: {
		esmExternals: true,
		externalDir: true,
		turbopackFileSystemCacheForDev: true,
		swcPlugins: !process.env.WEBPACK
			? // Currently there are a few bugs with swc-plugin-coverage-instrument when using turbopack
				// 1. It decorates next/font with some overhead which breaks a next constraint that next/font should be top level something
				//    This can be solved quite easily by adding "layout.tsx" to the unstableExclude array (and maybe break layout.tsx in order to lose as least coverage data as possible)
				// 2. It resolves source paths as just their name breaking coverage tree structure
				//    TODO: open an issue in swc-plugin-coverage-instrument repo with an MCVE
				[]
			: [
					[
						"swc-plugin-coverage-instrument",
						{ unstableExclude: covIgnoreList },
					],
				],
	},
	allowedDevOrigins: ["127.0.0.1"],
	cacheMaxMemorySize: 1 * GB,
};

export default nextConfig;
