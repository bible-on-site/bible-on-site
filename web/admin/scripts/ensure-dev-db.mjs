/**
 * Ensures tanah-dev is populated only when empty (parshan has no rows).
 * Matches web/bible-on-site predev behavior so `npm run dev` does not overwrite
 * a DB restored via sync-from-prod (prod articles) with tanah_test_data.
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
 * @returns {boolean|null} true = populated, false = needs populate, null = unreachable
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
			const [rows] = await conn.execute("SELECT 1 FROM parshan LIMIT 1");
			return Array.isArray(rows) && rows.length > 0;
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
			"  admin ensure-dev-db: .dev.env missing or DB_URL unset — skipping",
		);
		return;
	}

	const hasRows = await checkParshanHasRows(dbUrl);
	if (hasRows === null) {
		console.warn(
			"  admin ensure-dev-db: MySQL not reachable. Start MySQL or run: cd data && cargo make mysql-populate-dev",
		);
		return;
	}
	if (hasRows) {
		console.info(
			"  admin ensure-dev-db: database already has data — skipping mysql-populate-dev (keeps prod sync / existing dev data)",
		);
		return;
	}

	if (!runMysqlPopulate()) {
		console.error("  admin ensure-dev-db: mysql-populate-dev failed");
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("admin ensure-dev-db:", err);
	process.exit(1);
});
