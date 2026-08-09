/**
 * Keeps tanah-dev populated for local development.
 * - Default: sync content from production; a failed download leaves local data untouched.
 * - Falls back to mysql-populate-dev only when the local DB is also empty.
 * - Removes legacy demo authors (לדוגמא) unless KEEP_BUNDLED_TEST_ARTICLES=1.
 * Set DEV_DB_SYNC_FROM_PROD=0 to always reuse the local database.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const webDir = resolve(__dirname, "..");
const projectRoot = resolve(webDir, "../..");
const dataDir = resolve(projectRoot, "data");
const devopsDir = resolve(projectRoot, "devops");

function loadDevEnv() {
	const devEnvPath = resolve(webDir, ".dev.env");
	try {
		const content = readFileSync(devEnvPath, "utf8");
		for (const line of content.split("\n")) {
			const m = line.match(/^\s*DB_URL=(.+)$/);
			if (m) return m[1].trim();
		}
	} catch {
		// .dev.env missing
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
 * @returns {boolean|null} true = bootstrapped, false = need populate, null = unreachable
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
			// Tanahpedia content only ships with the prod dump, so treat an empty
			// entry table as "not bootstrapped" too.
			for (const table of ["tanah_sefer", "tanahpedia_entry"]) {
				const [rows] = await conn.execute(
					`SELECT 1 AS ok FROM \`${table}\` LIMIT 1`,
				);
				if (!Array.isArray(rows) || rows.length === 0) return false;
			}
			return true;
		} catch (queryErr) {
			const msg = String(queryErr?.message ?? queryErr);
			if (msg.includes("doesn't exist") || msg.includes("Unknown table")) {
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
			"  ensure-dev-db: removing bundled demo authors/articles — set KEEP_BUNDLED_TEST_ARTICLES=1 to keep",
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
		if (msg.includes("doesn't exist") || msg.includes("Unknown table")) {
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

function runSyncFromProd() {
	console.info("Syncing tanah-dev from production\u2026");
	// The sync dumps to a file first and only restores after a successful dump,
	// so a failed download leaves the existing local data intact.
	const result = spawnSync(
		"npm",
		["run", "setup_dev_env", "--", "sync-from-prod"],
		{ cwd: devopsDir, stdio: "inherit", shell: true },
	);
	return result.status === 0;
}

async function main() {
	const dbUrl = loadDevEnv();
	if (!dbUrl) {
		console.warn(
			"  ensure-dev-db: .dev.env not found or DB_URL missing — skipping DB check",
		);
		return;
	}

	const bootstrapped = await checkTanahBootstrapped(dbUrl);
	if (bootstrapped === null) {
		console.warn(
			"  ensure-dev-db: MySQL not reachable. Start MySQL and run: cd data && cargo make mysql-populate-dev",
		);
		return;
	}

	const syncDisabled = process.env.DEV_DB_SYNC_FROM_PROD === "0";
	const synced = syncDisabled ? false : runSyncFromProd();

	if (!synced) {
		if (!syncDisabled) {
			console.warn(
				"  ensure-dev-db: production not available — keeping the existing local tanah-dev data",
			);
		}
		if (!bootstrapped && !runMysqlPopulate()) {
			console.error("  ensure-dev-db: dev database bootstrap failed");
			process.exit(1);
		}
	}

	await removeBundledTestArticleSeed(dbUrl);
}

main().catch((err) => {
	console.error("ensure-dev-db:", err);
	process.exit(1);
});
