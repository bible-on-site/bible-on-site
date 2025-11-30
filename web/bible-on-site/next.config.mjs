const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;
/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	experimental: {
		esmExternals: true,
		externalDir: true,
		swcPlugins: ["swc-plugin-coverage-instrument"],
	},
	allowedDevOrigins: ["127.0.0.1"],
	cacheMaxMemorySize: 1 * GB,
};

export default nextConfig;
