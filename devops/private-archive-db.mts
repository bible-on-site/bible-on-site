/** Additive migration only. Never send this file through the destructive populator. */
import { readFile } from "node:fs/promises";
import mysql from "../web/admin/node_modules/mysql2/promise.js";

if (!process.env.DB_URL) throw new Error("DB_URL is required");
const connection = await mysql.createConnection(process.env.DB_URL);
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
