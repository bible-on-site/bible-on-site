/**
 * Ensures tanah-dev is bootstrapped without bundled demo articles.
 * - If tanah_sefer has no rows → run mysql-populate-dev (structure + sefarim/perushim, no tanah_test_data.sql).
 * - If DB already had legacy demo authors (לדוגמא) → remove those rows so admin matches copyprod expectations.
 * Set KEEP_BUNDLED_TEST_ARTICLES=1 to skip removal (local E2E-style debugging).
 * For production-like content: devops/setup-dev-env.mts sync-from-prod
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const adminDir = resolve(__dirname, "..");
const projectRoot = resolve(adminDir, "../..");
const dataDir = resolve(projectRoot, "data");

function loadDevEnv() {
	const devEnvPath = resolve(adminDir, ".dev.env");
	try {
		const content = readFileSync(devEnvPath, "utf8");
		for (const line of content.split("\n")) {
			const m = line.match(/^\s*DB_URL=(.+)$/);
			if (m) return m[1].trim();
		}
	} catch {
		// missing
	}
	return null;
}

function parseDbUrl(url) {
	const u = new URL(url.replace(/^mysql:\/\//, "http://"));
	return {
		host: u.hostname || "localhost",
		port: Number.parseInt(u.port || "3306", 10),
		user: u.username || "root",
		password: u.password || "",
		database: u.pathname?.slice(1)?.split("?")[0] || "tanah-dev",
	};
}

/**
 * @returns {boolean|null} true = already bootstrapped, false = run populate, null = unreachable
 */
async function checkTanahBootstrapped(dbUrl) {
	const mysql = await import("mysql2/promise");
	const opts = parseDbUrl(dbUrl);
	try {
		const conn = await mysql.createConnection({
			...opts,
			connectTimeout: 5000,
		});
		try {
			const [rows] = await conn.execute(
				"SELECT 1 AS ok FROM tanah_sefer LIMIT 1",
			);
			return Array.isArray(rows) && rows.length > 0;
		} catch (queryErr) {
			const msg = String(queryErr?.message ?? queryErr);
			if (msg.includes("doesn't exist") || msg.includes("Unknown table")) {
				return false;
			}
			if (msg.includes("Unknown database") || msg.includes("Unknown Database")) {
				return false;
			}
			throw queryErr;
		} finally {
			await conn.end();
		}
	} catch (err) {
		const msg = String(err?.message ?? err);
		if (msg.includes("Unknown database") || msg.includes("Unknown Database")) {
			return false;
		}
		return null;
	}
}

/**
 * Removes rows from data/mysql/tanah_test_data.sql (demo authors + their articles).
 */
async function removeBundledTestArticleSeed(dbUrl) {
	if (process.env.KEEP_BUNDLED_TEST_ARTICLES === "1") {
		return;
	}
	const mysql = await import("mysql2/promise");
	const opts = parseDbUrl(dbUrl);
	let conn;
	try {
		conn = await mysql.createConnection({
			...opts,
			connectTimeout: 5000,
		});
	} catch {
		return;
	}
	try {
		const [authors] = await conn.execute(
			`SELECT id FROM tanah_author
			 WHERE name LIKE '%לדוגמא%'
			    OR name LIKE '%רב עם תיאור ארוך%'`,
		);
		if (!Array.isArray(authors) || authors.length === 0) {
			return;
		}
		console.info(
			"  admin ensure-dev-db: removing bundled demo authors/articles (הרב לדוגמא / …) — set KEEP_BUNDLED_TEST_ARTICLES=1 to keep",
		);
		await conn.execute(
			`DELETE ta FROM tanah_article ta
			 INNER JOIN tanah_author auth ON ta.author_id = auth.id
			 WHERE auth.name LIKE '%לדוגמא%'
			    OR auth.name LIKE '%רב עם תיאור ארוך%'`,
		);
		await conn.execute(
			`DELETE FROM tanah_author
			 WHERE name LIKE '%לדוגמא%'
			    OR name LIKE '%רב עם תיאור ארוך%'`,
		);
	} catch (e) {
		const msg = String(e?.message ?? e);
		if (
			msg.includes("doesn't exist") ||
			msg.includes("Unknown table")
		) {
			return;
		}
		throw e;
	} finally {
		await conn.end();
	}
}

function runMysqlPopulate() {
	console.info(
		"Populating tanah-dev (structure + sefarim/perushim; no bundled demo articles)…",
	);
	const result = spawnSync("cargo", ["make", "mysql-populate-dev"], {
		cwd: dataDir,
		stdio: "inherit",
		shell: true,
	});
	return result.status === 0;
}

async function main() {
	const dbUrl = loadDevEnv();
	if (!dbUrl) {
		console.warn(
			"  admin ensure-dev-db: .dev.env missing or DB_URL unset — skipping",
		);
		return;
	}

	const bootstrapped = await checkTanahBootstrapped(dbUrl);
	if (bootstrapped === null) {
		console.warn(
			"  admin ensure-dev-db: MySQL not reachable. Start MySQL or run: cd data && cargo make mysql-populate-dev",
		);
		return;
	}
	if (!bootstrapped) {
		if (!runMysqlPopulate()) {
			console.error("  admin ensure-dev-db: mysql-populate-dev failed");
			process.exit(1);
		}
	} else {
		console.info(
			"  admin ensure-dev-db: tanah_sefer present — skipping mysql-populate-dev",
		);
	}

	await removeBundledTestArticleSeed(dbUrl);
}

main().catch((err) => {
	console.error("admin ensure-dev-db:", err);
	process.exit(1);
});
