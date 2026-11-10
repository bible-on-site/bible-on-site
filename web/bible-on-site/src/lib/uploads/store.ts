import "server-only";
import { UploadStore } from "../../../../shared/private-upload-store";
import { execute, query, transaction, txExecute, txQuery } from "../api-client";

export const uploadStore = new UploadStore({
	query,
	execute,
	transaction: (fn) =>
		transaction((connection) =>
			fn({
				query: (sql, params) => txQuery(connection, sql, params),
				execute: (sql, params) => txExecute(connection, sql, params),
			}),
		),
});
