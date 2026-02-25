const KB = 1024;
const MB = KB * KB;

const isProduction = process.env.NODE_ENV === "production";

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	transpilePackages: ["html-flip-book-react"],
	turbopack: {
		root: import.meta.dirname,
	},
	images: {
		// Allow fetching images from loopback addresses in development
		dangerouslyAllowSVG: true,
		remotePatterns: [
			// MinIO for development (all buckets)
			{
				protocol: "http",
				hostname: "localhost",
				port: "4566",
			},
			{
				protocol: "http",
				hostname: "127.0.0.1",
				port: "4566",
			},
			// AWS S3 for production
			{
				protocol: "https",
				hostname: "bible-on-site-assets.s3.*.amazonaws.com",
			},
			{
				protocol: "https",
				hostname: "*.s3.*.amazonaws.com",
			},
		],
	},
	experimental: {
		esmExternals: true,
		externalDir: true,
		turbopackFileSystemCacheForDev: true,
		// Only include coverage instrumentation in non-production builds
		...(isProduction
			? {}
			: {
					swcPlugins: [
						[
							"swc-plugin-coverage-instrument",
							{
								unstableExclude: (await import("./.covignore.mjs"))
									.covIgnoreList,
							},
						],
					],
				}),
	},
	allowedDevOrigins: ["127.0.0.1"],
	// Increasing this further may cause OOM kills on the 1024 MB Fargate task.
	cacheMaxMemorySize: 256 * MB,

	async rewrites() {
		return [
			// /929/rabbis → /929/authors alias
			{ source: "/929/rabbis", destination: "/929/authors" },
			{
				source: "/929/rabbis/:authorParam*",
				destination: "/929/authors/:authorParam*",
			},
		];
	},

	async redirects() {
		return [
			// Legacy /authors → /929/authors permanent redirect
			{
				source: "/authors",
				destination: "/929/authors",
				permanent: true,
			},
			{
				source: "/authors/:authorParam*",
				destination: "/929/authors/:authorParam*",
				permanent: true,
			},
		];
	},
};

export default nextConfig;
