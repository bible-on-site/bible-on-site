/** Additive migration only. Never send this file through the destructive populator. */
import { readFile } from "node:fs/promises";
import mysql from "../web/admin/node_modules/mysql2/promise.js";
import { databaseTls } from "../web/bible-on-site/src/lib/db-config.ts";

if (!process.env.DB_URL) throw new Error("DB_URL is required");
const url = new URL(process.env.DB_URL);
const ssl = databaseTls(url.hostname, url.searchParams.get("ssl-mode"));
url.searchParams.delete("ssl-mode");
const connection = await mysql.createConnection(
	ssl ? { uri: url.href, ssl } : url.href,
);
try {
	const sql = await readFile(
		new URL("../data/mysql/private_archive_upgrade.sql", import.meta.url),
		"utf8",
	);
	for (const statement of sql.replace(/^--.*$/gm, "").split(";")) {
		if (statement.trim()) await connection.query(statement);
	}
} finally {
	await connection.end();
}
