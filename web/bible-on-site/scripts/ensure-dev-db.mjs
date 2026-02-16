/**
 * Ensures tanah-dev MySQL database is populated before dev (perushim, articles, etc.).
 * Skips if parshan table already has rows. Runs cargo make mysql-populate-dev when needed.
 * If MySQL is not reachable, logs a warning and continues — dev server will start
 * but DB-dependent features (perushim, articles) will not work.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const webDir = resolve(__dirname, "..");
const projectRoot = resolve(webDir, "../..");
const dataDir = resolve(projectRoot, "data");

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
	const u = new URL(url.replace(/^mysql:\/\//, "mysql://"));
	return {
		host: u.hostname || "localhost",
		port: Number.parseInt(u.port || "3306", 10),
		user: u.username || "root",
		password: u.password || "",
		database: u.pathname?.slice(1) || "tanah-dev",
	};
}

/**
 * @returns {boolean|null} true = populated, false = needs populate, null = MySQL unreachable
 */
async function checkParshanHasRows(dbUrl) {
	const mysql = await import("mysql2/promise");
	const opts = parseDbUrl(dbUrl);
	try {
		const conn = await mysql.createConnection({
			...opts,
			connectTimeout: 5000,
		});
		try {
			const [rows] = await conn.execute(
				"SELECT 1 FROM parshan LIMIT 1",
			);
			return Array.isArray(rows) && rows.length > 0;
		} catch (queryErr) {
			// Table may not exist yet
			const msg = String(queryErr?.message ?? queryErr);
			if (
				msg.includes("doesn't exist") ||
				msg.includes("Unknown table")
			) {
				return false;
			}
			throw queryErr;
		} finally {
			await conn.end();
		}
	} catch (err) {
		const msg = String(err?.message ?? err);
		if (
			msg.includes("Unknown database") ||
			msg.includes("Unknown Database")
		) {
			return false; // DB doesn't exist, need to populate
		}
		return null; // connection refused, etc.
	}
}

function runMysqlPopulate() {
	console.info("Populating tanah-dev (structure + data + perushim)...");
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
			"  ensure-dev-db: .dev.env not found or DB_URL missing — skipping DB check",
		);
		return;
	}

	const hasRows = await checkParshanHasRows(dbUrl);
	if (hasRows === null) {
		console.warn(
			"  ensure-dev-db: MySQL not reachable. Start MySQL and run: cd data && cargo make mysql-populate-dev",
		);
		return;
	}
	if (hasRows) {
		return; // already populated
	}

	if (!runMysqlPopulate()) {
		console.error("  ensure-dev-db: mysql-populate-dev failed");
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("ensure-dev-db:", err);
	process.exit(1);
});
