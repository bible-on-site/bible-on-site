import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KB = 1024;
const MB = KB * KB;

const isProduction = process.env.NODE_ENV === "production";
const productionBulletinClient = path.resolve(
	import.meta.dirname,
	"src/lib/download/bulletin-client-local.production.ts",
);
const sefarimForBookRoutes = JSON.parse(
	readFileSync(
		path.resolve(
			import.meta.dirname,
			"src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json",
		),
		"utf8",
	),
);
const bookPageSlugs = JSON.parse(
	readFileSync(
		path.resolve(import.meta.dirname, "src/data/book-page-slugs.json"),
		"utf8",
	),
);
const parashaDivision = JSON.parse(
	readFileSync(
		path.resolve(import.meta.dirname, "src/data/parasha/parasha-division.json"),
		"utf8",
	),
);
/** First parasha unitId per Torah sefer — the book-chrome URLs land
 * there. Unit ids are positional (index + 1) like the data module's. */
const parashaSeferFirstUnits = Object.entries(
	parashaDivision.units.reduce((first, unit, index) => {
		if (!(unit.sefer in first)) first[unit.sefer] = index + 1;
		return first;
	}, {}),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	// Keep the canonical source bytes outside JavaScript chunks and present in
	// standalone images for both route handlers and server component runtimes.
	outputFileTracingIncludes: {
		"/*": ["./src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json"],
	},
	transpilePackages: ["html-flip-book-react"],
	turbopack: {
		root: import.meta.dirname,
		// Preserve the canonical JSON number literals: Turbopack's JSON parser
		// can change the last digit of alignment diagnostics during bundling.
		rules: {
			"sefaria-dump-5784-sivan-4.tanah_view.json": { type: "text" },
		},
		...(isProduction
			? {
					resolveAlias: {
						"@/lib/download/bulletin-client-local":
							"./src/lib/download/bulletin-client-local.production.ts",
					},
				}
			: {}),
	},
	webpack(config) {
		config.module.rules.push({
			test: /sefaria-dump-5784-sivan-4\.tanah_view\.json$/,
			type: "asset/source",
		});
		// The package exports only ESM entry points; coverage instrumentation can
		// turn its imports into require calls. Resolve those exports as ESM first.
		for (const entry of [
			"html-flip-book-react",
			"html-flip-book-react/toolbar",
		]) {
			config.resolve.alias[`${entry}$`] = fileURLToPath(
				import.meta.resolve(entry),
			);
		}
		if (isProduction) {
			config.resolve.alias["@/lib/download/bulletin-client-local"] =
				productionBulletinClient;
		}
		return config;
	},
	images: {
		unoptimized: !isProduction,
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
			// Assets CDN (ASSETS_BASE_URL) — custom domain or raw distribution host
			{
				protocol: "https",
				hostname: "assets.xn--febl3a.co.il",
			},
			{
				protocol: "https",
				hostname: "**.cloudfront.net",
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
		return {
			beforeFiles: [
				// Requests for /לוח arrive percent-encoded and never match the
				// decoded filesystem route; serve the page from /calendar instead.
				{ source: "/לוח", destination: "/calendar" },
				{ source: "/%D7%9C%D7%95%D7%97", destination: "/calendar" },
				...sefarimForBookRoutes.flatMap((sefer) =>
					Object.entries(bookPageSlugs).flatMap(([page, slug]) => {
						const destination = `/929/${sefer.perekFrom ?? sefer.additionals[0].perekFrom}?book&bookPage=${page}`;
						// Browser requests and client navigation may supply percent-encoded
						// Hebrew. Next matches rewrite sources before decoding the path.
						return [
							`/929/${sefer.name}/${slug}`,
							`/929/${encodeURIComponent(sefer.name)}/${encodeURIComponent(slug)}`,
						].map((source) => ({ source, destination }));
					}),
				),
			],
			afterFiles: [
				// /929/rabbis → /929/authors alias
				{ source: "/929/rabbis", destination: "/929/authors" },
				{
					source: "/929/rabbis/:authorParam*",
					destination: "/929/authors/:authorParam*",
				},
				// /מסורה — the Masoretic reading division's public Hebrew root
				// lives in an ASCII route dir (non-ASCII route directories are
				// unreliable across dev/build). Like the book rewrites above,
				// both raw and percent-encoded sources are needed because Next
				// matches rewrite sources before decoding the path.
				{ source: "/מסורה", destination: "/masora" },
				{ source: `/${encodeURIComponent("מסורה")}`, destination: "/masora" },
				// Book-chrome pages for the מסורה sefer book:
				// /מסורה/{firstUnitId}/{cover-slug}?book →
				// /masora/{firstUnitId}?book&bookPage={page}. The unit id in
				// the path resolves the sefer — masora units derive in TS,
				// so unlike /פרשה there is no config-side sefer→unit table.
				// Raw and percent-encoded variants cover client navigation
				// and direct hits; numeric unit ids keep perush/article
				// query-param routes out of this rule.
				...Object.entries(bookPageSlugs).flatMap(([page, slug]) =>
					["מסורה", encodeURIComponent("מסורה")].flatMap((root) =>
						[slug, encodeURIComponent(slug)].map((pageSlug) => ({
							source: `/${root}/:unitId(\\d+)/${pageSlug}`,
							destination: `/masora/:unitId?book&bookPage=${page}`,
						})),
					),
				),
				{ source: "/מסורה/:path*", destination: "/masora/:path*" },
				{
					source: `/${encodeURIComponent("מסורה")}/:path*`,
					destination: "/masora/:path*",
				},
				// /פרשה — the parasha reading division's public Hebrew root.
				// Book-chrome URLs (/פרשה/{sefer}/{cover-slug}) land on the
				// sefer's first parasha in book mode; unit URLs resolve through
				// the /parasha route dir like מסורה does through /masora.
				{ source: "/פרשה", destination: "/parasha" },
				{ source: `/${encodeURIComponent("פרשה")}`, destination: "/parasha" },
				...parashaSeferFirstUnits.flatMap(([sefer, unitId]) =>
					Object.entries(bookPageSlugs).flatMap(([page, slug]) =>
						["פרשה", encodeURIComponent("פרשה")].flatMap((root) =>
							[
								`/${root}/${sefer}/${slug}`,
								`/${root}/${encodeURIComponent(sefer)}/${encodeURIComponent(slug)}`,
							].map((source) => ({
								source,
								destination: `/parasha/${unitId}?book&bookPage=${page}`,
							})),
						),
					),
				),
				{ source: "/פרשה/:path*", destination: "/parasha/:path*" },
				{
					source: `/${encodeURIComponent("פרשה")}/:path*`,
					destination: "/parasha/:path*",
				},
			],
			fallback: [],
		};
	},

	async redirects() {
		return [
			// The learning calendar lives at /calendar internally; its canonical
			// URL is the Hebrew /לוח served through the rewrite above.
			{
				source: "/calendar",
				destination: "/לוח",
				permanent: true,
			},
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
			// Legacy /tanahpedia/entry/:uniqueName → /pedia/:uniqueName permanent redirect
			{
				source: "/tanahpedia/entry/:uniqueName",
				destination: "/pedia/:uniqueName",
				permanent: true,
			},
		];
	},
};

export default nextConfig;
