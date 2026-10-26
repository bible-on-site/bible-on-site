/**
 * Exports article HTML for the annotation pipeline's article-domain
 * baseline (data/annotations/baseline_articles.py, issue #2516):
 *
 *   node --import tsx devops/export-tanahpedia-articles.mts \
 *     --out <file.json> [--env-file <module/.dev.env>]
 *
 * Emits JSON [{"id": 1, "content": "<p>...</p>"}] — the pipeline hashes
 * `content` verbatim into each decoration's `content_hash` staleness key,
 * so the export must not normalize it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseFlags(argv: string[]) {
	const flags = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const raw = argv[i];
		if (!raw.startsWith("--")) throw new Error(`unexpected argument "${raw}"`);
		const [name, inline] = raw.slice(2).split("=", 2);
		flags.set(name, inline ?? argv[++i] ?? "true");
	}
	return flags;
}

function loadDbUrl(envFile: string): string {
	if (process.env.DB_URL) return process.env.DB_URL;
	if (existsSync(envFile)) {
		for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
			const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
			if (!m || process.env[m[1]] !== undefined) continue;
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
		}
	}
	if (!process.env.DB_URL) throw new Error("DB_URL not set and no env file provided");
	return process.env.DB_URL;
}

function parseDbUrl(url: string) {
	const u = new URL(url.replace(/^mysql:\/\//, "http://"));
	return {
		host: u.hostname || "localhost",
		port: Number.parseInt(u.port || "3306", 10),
		user: u.username || "root",
		password: u.password || "",
		database: u.pathname?.slice(1)?.split("?")[0] || "tanah-dev",
	};
}

interface ArticleRow {
	id: number;
	content: string | null;
}

async function main() {
	const flags = parseFlags(process.argv.slice(2));
	const outFile = flags.get("out");
	if (!outFile) throw new Error("--out <file> is required");
	const envFile = flags.get("env-file") ?? ".dev.env";
	const requireFromModule = createRequire(resolve(process.cwd(), "package.json"));
	const mysql =
		requireFromModule("mysql2/promise") as typeof import("mysql2/promise");
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
