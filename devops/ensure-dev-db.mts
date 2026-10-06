/**
 * Keeps the local dev database (tanah-dev) usable for a web module.
 *
 * Shared implementation for web/bible-on-site and web/admin — run it from the
 * module directory via its `predev` script. mysql2 is resolved from the
 * caller's package, so this script has no runtime deps of its own.
 *
 * Behavior:
 * - Reads DB_URL from the environment or the module's env file (--env-file).
 * - If none of the --tables has rows → runs `cargo make mysql-populate-dev`.
 * - With --sync-from-prod, first tries `npm run setup_dev_env -- sync-from-prod`
 *   (a failed download leaves local data untouched); populate is the fallback.
 * - Removes bundled demo authors/articles unless KEEP_BUNDLED_TEST_ARTICLES=1.
 *
 * Usage:
 *   node --import tsx <repo>/devops/ensure-dev-db.mts \
 *     [--env-file .dev.env] [--tables tanah_sefer,tanahpedia_entry] [--sync-from-prod]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = await yargs(hideBin(process.argv))
	.option("env-file", {
		type: "string",
		default: ".dev.env",
		describe: "env file in the module directory used as a DB_URL fallback",
	})
	.option("tables", {
		type: "string",
		default: "tanah_sefer",
		describe: "comma-separated tables that must each contain rows for the DB to count as bootstrapped",
	})
	.option("sync-from-prod", {
		type: "boolean",
		default: false,
		describe: "refresh content from production before falling back to local populate",
	})
	.strict()
	.parse();

const moduleDir = process.cwd();
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(repoRoot, "data");
const devopsDir = resolve(repoRoot, "devops");
const label = readPackageName(moduleDir);

const requiredTables = (argv.tables as string)
	.split(",")
	.map((t) => t.trim())
	.filter(Boolean);

const requireFromModule = createRequire(resolve(moduleDir, "package.json"));
const mysql = requireFromModule("mysql2/promise") as typeof import("mysql2/promise");

function readPackageName(dir: string): string {
	try {
		const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8"));
		return pkg.name ?? dir;
	} catch {
		return dir;
	}
}

function loadDbUrl(): string | null {
	if (process.env.DB_URL) return process.env.DB_URL;
	const envPath = resolve(moduleDir, argv["env-file"] as string);
	if (existsSync(envPath)) {
		loadEnv({ path: envPath, override: false });
	}
	return process.env.DB_URL ?? null;
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

/**
 * @returns {boolean|null} true = bootstrapped, false = need populate, null = unreachable
 */
async function checkTanahBootstrapped(dbUrl: string): Promise<boolean | null> {
	const opts = parseDbUrl(dbUrl);
	try {
		const conn = await mysql.createConnection({
			...opts,
			connectTimeout: 5000,
		});
		try {
			for (const table of requiredTables) {
				const [rows] = await conn.execute(
					`SELECT 1 AS ok FROM \`${table}\` LIMIT 1`,
				);
				if (!Array.isArray(rows) || rows.length === 0) return false;
			}
			return true;
		} catch (queryErr) {
			const msg = String((queryErr as Error)?.message ?? queryErr);
			if (
				msg.includes("doesn't exist") ||
				msg.includes("Unknown table") ||
				msg.includes("Unknown database") ||
				msg.includes("Unknown Database")
			) {
				return false;
			}
			throw queryErr;
		} finally {
			await conn.end();
		}
	} catch (err) {
		const msg = String((err as Error)?.message ?? err);
		if (msg.includes("Unknown database") || msg.includes("Unknown Database")) {
			return false;
		}
		return null;
	}
}

/**
 * Removes rows from data/mysql/tanah_test_data.sql (demo authors + their articles).
 */
async function removeBundledTestArticleSeed(dbUrl: string): Promise<void> {
	if (process.env.KEEP_BUNDLED_TEST_ARTICLES === "1") {
		return;
	}
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
			`  ensure-dev-db (${label}): removing bundled demo authors/articles (הרב לדוגמא / …) — set KEEP_BUNDLED_TEST_ARTICLES=1 to keep`,
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
		const msg = String((e as Error)?.message ?? e);
		if (msg.includes("doesn't exist") || msg.includes("Unknown table")) {
			return;
		}
		throw e;
	} finally {
		await conn.end();
	}
}

function runMysqlPopulate(): boolean {
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

function runSyncFromProd(): boolean {
	console.info("Syncing tanah-dev from production…");
	// The sync dumps to a file first and only restores after a successful dump,
	// so a failed download leaves the existing local data intact.
	const result = spawnSync(
		"npm",
		["run", "setup_dev_env", "--", "sync-from-prod"],
		{ cwd: devopsDir, stdio: "inherit", shell: true },
	);
	return result.status === 0;
}

async function main(): Promise<void> {
	const dbUrl = loadDbUrl();
	if (!dbUrl) {
		console.warn(
			`  ensure-dev-db (${label}): ${argv["env-file"]} not found or DB_URL missing — skipping DB check`,
		);
		return;
	}

	const bootstrapped = await checkTanahBootstrapped(dbUrl);
	if (bootstrapped === null) {
		console.warn(
			`  ensure-dev-db (${label}): MySQL not reachable. Start MySQL or run: cd data && cargo make mysql-populate-dev`,
		);
		return;
	}

	if (argv["sync-from-prod"]) {
		const syncDisabled = process.env.DEV_DB_SYNC_FROM_PROD === "0";
		const synced = syncDisabled ? false : runSyncFromProd();
		if (!synced) {
			if (!syncDisabled) {
				console.warn(
					`  ensure-dev-db (${label}): production not available — keeping the existing local tanah-dev data`,
				);
			}
			if (!bootstrapped && !runMysqlPopulate()) {
				console.error(`  ensure-dev-db (${label}): dev database bootstrap failed`);
				process.exit(1);
			}
		}
	} else if (!bootstrapped) {
		if (!runMysqlPopulate()) {
			console.error(`  ensure-dev-db (${label}): mysql-populate-dev failed`);
			process.exit(1);
		}
	} else {
		console.info(
			`  ensure-dev-db (${label}): ${requiredTables.join(", ")} present — skipping mysql-populate-dev`,
		);
	}

	await removeBundledTestArticleSeed(dbUrl);
}

main().catch((err) => {
	console.error(`ensure-dev-db (${label}):`, err);
	process.exit(1);
});
