import "@tanstack/react-start/server-only";
import mysql from "mysql2/promise";
import { ArchiveStore, type Sql } from "~/server/archive/store";
import { resolveMysqlUrl } from "../db-config";
import { databaseConnectionOptions } from "../db-tls.server";

// Upload transitions may wait on S3. They never borrow an ordinary admin connection.
let pool: mysql.Pool | undefined;
function uploadPool() {
	pool ??= mysql.createPool({
		...databaseConnectionOptions(new URL(resolveMysqlUrl())),
		connectionLimit: 3,
		waitForConnections: true,
		queueLimit: 25,
	});
	return pool;
}

function sql(connection: Pick<mysql.Pool, "execute">): Sql {
	return {
		query: async <T>(statement: string, params?: unknown[]) => {
			// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- repository-owned parameterized SQL only; caller values are bound separately.
			return (await connection.execute(statement, params as never))[0] as T[];
		},
		execute: async (statement, params) => {
			// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- repository-owned parameterized SQL only; caller values are bound separately.
			return connection.execute(statement, params as never);
		},
	};
}

export const archiveStore = new ArchiveStore({
	// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- only parameterized repository ArchiveStore statements reach this adapter.
	query: (statement, params) => sql(uploadPool()).query(statement, params),
	// nosemgrep: javascript.lang.security.audit.db.formatted-sql-string, node-mysql-sqli -- only parameterized repository ArchiveStore statements reach this adapter.
	execute: (statement, params) => sql(uploadPool()).execute(statement, params),
	transaction: async (fn) => {
		const connection = await uploadPool().getConnection();
		try {
			await connection.beginTransaction();
			const result = await fn(sql(connection));
			await connection.commit();
			return result;
		} catch (error) {
			await connection.rollback();
			throw error;
		} finally {
			connection.release();
		}
	},
});
