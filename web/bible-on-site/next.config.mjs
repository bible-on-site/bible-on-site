import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";
import { getBuildWorkerCount } from "./scripts/build-worker-budget.mjs";

const KB = 1024;
const MB = KB * KB;

const isProduction = process.env.NODE_ENV === "production";
const localAssetEndpoint = [
	"http://localhost:4566",
	"http://127.0.0.1:4566",
].includes(process.env.S3_ENDPOINT ?? "");
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
/** First parasha canonical slug per Torah sefer — the book-chrome URLs
 * land there. Internal rewrite destinations carry the canonical slug so
 * only canonical params reach the /parasha/[unit] route (issue #2738). */
const parashaSeferFirstSlugs = Object.entries(
	parashaDivision.units.reduce((first, unit) => {
		if (!(unit.sefer in first)) first[unit.sefer] = unit.slug;
		return first;
	}, {}),
);

/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	// Route handlers and SSR have separate bundle runtimes. Use Node's shared
	// module cache so readiness warms the same sanitizer used by public pages,
	// rather than constructing a second JSDOM window on their first request.
	serverExternalPackages: ["isomorphic-dompurify"],
	// Route-cache keys are built from decoded pathnames, so quoted Hebrew slugs
	// like רש"י produce filenames NTFS rejects. The handler subclasses the
	// default filesystem cache and encodes unsafe filesystem path segments,
	// preserving logical cache keys and existing build seeds (issue #1999).
	cacheHandler: fileURLToPath(new URL("./cache-handler.mjs", import.meta.url)),
	// Keep the canonical source bytes outside JavaScript chunks and present in
	// standalone images for both route handlers and server component runtimes.
	// The cache handler is required at runtime by the standalone server too.
	outputFileTracingIncludes: {
		"/*": [
			"./src/data/db/sefaria-dump-5784-sivan-4.tanah_view.json.br",
			"./cache-handler.mjs",
		],
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
		// Production-mode tests use the same explicitly configured local store
		// as development. Public S3 endpoints keep Next's default IP restriction.
		dangerouslyAllowLocalIP: localAssetEndpoint,
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
		// Dependency-graph CSS chunking: routes download close to only the CSS
		// they import instead of one large shared chunk (~94% unused CSS on
		// perek pages before; #2735). Turbopack-only; webpack ignores it.
		// Next.js supports graph chunking only under Turbopack; keep the
		// documented dev-webpack command usable too.
		cssChunking: process.env.TURBOPACK ? "graph" : true,
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

	async headers() {
		return [
			// Stable join routes (#2939) resolve admin-managed destinations at
			// request time; the redirect may never be cached by browsers or
			// the CDN.
			{
				source: "/dailyBulletin/join/telegram",
				headers: [{ key: "Cache-Control", value: "no-store" }],
			},
			{
				source: "/dailyBulletin/join/whatsapp",
				headers: [{ key: "Cache-Control", value: "no-store" }],
			},
			{
				// Reader book assets (#3095) are precompressed Brotli bytes the
				// generator writes under public/generated/sefarim/. They are
				// served as static files — NOT a route handler — because the App
				// Router response pipeline can drop Content-Encoding while still
				// sending the encoded body, leaving browsers unable to decode it.
				// Content-addressed names make the immutable cache safe.
				source: "/generated/sefarim/:path*",
				headers: [
					{
						key: "Content-Type",
						value: "application/json; charset=utf-8",
					},
					{ key: "Content-Encoding", value: "br" },
					{
						key: "Cache-Control",
						value: "public, max-age=31536000, immutable",
					},
					{ key: "Vary", value: "Accept-Encoding" },
				],
			},
		];
	},

	async rewrites() {
		return {
			beforeFiles: [
				// Installed native apps use these public join URLs. Resolve them
				// through the same live destinations and signup page as the website.
				...["telegram", "whatsapp", "email"].map((channel) => ({
					source: `/bulletin/${channel}/join`,
					destination: `/dailyBulletin/join/${channel}`,
				})),
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
				// /מועדים — the DB-backed מועדים על הפרק section (#3101) lives
				// in the ASCII /moadim route dir; slugs are canonical Hebrew
				// and pass through the :path* wildcard like מסורה does.
				{ source: "/מועדים", destination: "/moadim" },
				{ source: `/${encodeURIComponent("מועדים")}`, destination: "/moadim" },
				{ source: "/מועדים/:path*", destination: "/moadim/:path*" },
				{
					source: `/${encodeURIComponent("מועדים")}/:path*`,
					destination: "/moadim/:path*",
				},
				// /פרשה — the parasha reading division's public Hebrew root.
				// Book-chrome URLs (/פרשה/{sefer}/{cover-slug}) land on the
				// sefer's first parasha in book mode; unit URLs resolve through
				// the /parasha route dir like מסורה does through /masora.
				{ source: "/פרשה", destination: "/parasha" },
				{ source: `/${encodeURIComponent("פרשה")}`, destination: "/parasha" },
				...parashaSeferFirstSlugs.flatMap(([sefer, firstSlug]) =>
					Object.entries(bookPageSlugs).flatMap(([page, slug]) =>
						["פרשה", encodeURIComponent("פרשה")].flatMap((root) =>
							[
								`/${root}/${sefer}/${slug}`,
								`/${root}/${encodeURIComponent(sefer)}/${encodeURIComponent(slug)}`,
							].map((source) => ({
								source,
								destination: `/parasha/${encodeURIComponent(firstSlug)}?book&bookPage=${page}`,
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
			// Same convention for /moadim — the public canonical URLs are
			// the Hebrew /מועדים ones (#3101).
			{
				source: "/moadim",
				destination: "/מועדים",
				permanent: true,
			},
			{
				source: "/moadim/:path*",
				destination: "/מועדים/:path*",
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
			// /sitemap_www.xml is a public sitemap URL external consumers
			// still fetch — e.g. past Search Console submissions on the
			// supported www host. Keep it pointing at the single canonical
			// document instead of letting it hit the missing-page 404
			// (issue #2935).
			{
				source: "/sitemap_www.xml",
				destination: "/sitemap.xml",
				permanent: true,
			},
		];
	},
};

export default (phase, { defaultConfig }) => {
	if (phase !== PHASE_PRODUCTION_BUILD) return nextConfig;
	return {
		...nextConfig,
		experimental: {
			...nextConfig.experimental,
			// Concurrent prerenders queued over 180 output writes on Windows;
			// even small HTML files waited beyond the 60-second page deadline.
			// Bound the producer queue without changing that deadline or retries.
			...(process.platform === "win32"
				? { staticGenerationMaxConcurrency: 1 }
				: {}),
			cpus: getBuildWorkerCount({
				defaultCpuLimit: defaultConfig.experimental.cpus,
				parallelism: availableParallelism(),
				availableBytes: process.availableMemory(),
				constrainedBytes: process.constrainedMemory(),
			}),
		},
	};
};
