const KB = 1024;
const MB = KB * KB;
const GB = MB * KB;

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
			// LocalStack/MinIO for development
			{
				protocol: "http",
				hostname: "localhost",
				port: "4566",
				pathname: "/bible-on-site-rabbis/**",
			},
			// Also allow 127.0.0.1 for LocalStack
			{
				protocol: "http",
				hostname: "127.0.0.1",
				port: "4566",
				pathname: "/bible-on-site-rabbis/**",
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
	cacheMaxMemorySize: 1 * GB,
};

export default nextConfig;
