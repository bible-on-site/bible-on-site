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
		swcPlugins: [
			["swc-plugin-coverage-instrument", { unstableExclude: covIgnoreList }],
		],
	},
	allowedDevOrigins: ["127.0.0.1"],
	cacheMaxMemorySize: 1 * GB,
};

export default nextConfig;
