import path from "node:path";
import { fileURLToPath } from "node:url";

/** Count actual anchor markup, excluding link data serialized in RSC scripts. */
export function links(html, pattern) {
	// Consume script blocks as tokens so their serialized anchors are never read.
	const tokens =
		/<script\b[^>]*>[\s\S]*?<\/script\s*>|<a\b[^>]*\bhref="([^"]+)"/gi;
	return [
		...new Set(
			[...html.matchAll(tokens)]
				.map((match) => match[1])
				.filter((href) => href !== undefined && pattern.test(href)),
		),
	];
}

/** Verify user-facing content even when HTTP 200 and recitation both pass. */
export async function verifyPublicContent(
	origin,
	{ fetchPage = fetch, baseline } = {},
) {
	const read = async (route) => {
		const response = await fetchPage(new URL(route, origin), {
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
		return response;
	};
	const readiness = await (await read("/api/health/ready")).json();
	const authorsHtml = await (await read("/929/authors")).text();
	const authors = links(authorsHtml, /^\/929\/authors\/[^/?#]+$/);
	const expectedAuthors = Number(
		baseline?.authorCount ?? readiness.content?.authorCount ?? 1,
	);
	if (
		!Number.isSafeInteger(expectedAuthors) ||
		expectedAuthors < 1 ||
		authors.length < expectedAuthors
	) {
		throw new Error(
			`Authors listing: expected at least ${expectedAuthors} authors, rendered ${authors.length}`,
		);
	}
	const perekId = baseline?.perekId ?? 1;
	const chapter = await (await read(`/929/${perekId}`)).text();
	const articles = links(chapter, new RegExp(`^/929/${perekId}/\\d+$`));
	const expectedArticles = Number(baseline?.articleCount ?? 1);
	if (
		!Number.isSafeInteger(expectedArticles) ||
		expectedArticles < 1 ||
		articles.length < expectedArticles
	) {
		throw new Error(
			`Chapter ${perekId}: expected at least ${expectedArticles} articles, rendered ${articles.length}`,
		);
	}
	const authorPage = await (await read(authors[0])).text();
	if (links(authorPage, /^\/929\/\d+\/\d+$/).length === 0)
		throw new Error("Author detail has no article links");
	const articlePage = await (await read(articles[0])).text();
	if (!/<h1\b[^>]*>[^<]*\S/.test(articlePage))
		throw new Error("Article detail has no title");
	return { authors: authors.length, perekId, articles: articles.length };
}

/** The packaged image must contain the real source corpus, regardless of approval. */
async function databaseBaseline() {
	if (!process.env.DB_URL)
		throw new Error("DB_URL is required for the production content baseline");
	const { default: mysql } = await import("mysql2/promise");
	const connection = await mysql.createConnection(process.env.DB_URL);
	try {
		const [[authors]] =
			await connection.execute(`SELECT COUNT(DISTINCT a.author_id) AS authorCount
		 FROM tanah_article a JOIN tanah_author au ON au.id = a.author_id WHERE a.perek_id BETWEEN 1 AND 929`);
		const [[chapter]] =
			await connection.execute(`SELECT a.perek_id AS perekId, COUNT(*) AS articleCount
		 FROM tanah_article a JOIN tanah_author au ON au.id = a.author_id WHERE a.perek_id BETWEEN 1 AND 929
		 GROUP BY a.perek_id ORDER BY a.perek_id LIMIT 1`);
		if (!chapter) throw new Error("Production article corpus is empty");
		return { ...authors, ...chapter };
	} finally {
		await connection.end();
	}
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const originIndex = args.indexOf("--origin");
	const origin = originIndex >= 0 ? args[originIndex + 1] : undefined;
	if (!origin)
		throw new Error(
			"Usage: node verify-public-content.mjs --origin URL [--database]",
		);
	const baseline = args.includes("--database")
		? await databaseBaseline()
		: undefined;
	console.log(
		"Public content verified:",
		await verifyPublicContent(origin, { baseline }),
	);
}
