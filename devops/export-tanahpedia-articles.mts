/**
 * Exports article HTML for the annotation pipeline's article-domain
 * baseline (data/annotations/baseline_articles.py, issue #2516):
 *
 *   node devops/export-tanahpedia-articles.mts \
 *     --out <file.json> [--env-file <module/.dev.env>]
 *
 * Emits JSON [{"id": 1, "content": "<p>...</p>"}] — the pipeline hashes
 * `content` verbatim into each decoration's `content_hash` staleness key,
 * so the export must not normalize it.
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	loadDbUrl,
	parseDbUrl,
	parseFlags,
	websiteMysql,
} from "./website-mysql.mts";

interface ArticleRow {
	id: number;
	content: string | null;
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const outFile = flags.get("out");
	if (!outFile) throw new Error("--out <file> is required");
	const envFile = flags.get("env-file") ?? ".dev.env";
	const mysql = websiteMysql();
	const conn = await mysql.createConnection(parseDbUrl(loadDbUrl(envFile)));
	let rows: ArticleRow[];
	try {
		const [result] = await conn.execute(
			`SELECT id, content FROM tanah_article
			 WHERE content IS NOT NULL AND perek_id BETWEEN 1 AND 929
			 ORDER BY id`,
		);
		rows = result as ArticleRow[];
	} finally {
		await conn.end();
	}
	writeFileSync(outFile, JSON.stringify(rows, null, 1), "utf8");
	console.log(JSON.stringify({ articles: rows.length, out: outFile }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	await main();
}
