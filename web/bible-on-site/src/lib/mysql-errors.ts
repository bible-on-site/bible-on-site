/**
 * Whether a query rejection means an optional content table/column is not
 * deployed yet. MySQL reports ER_BAD_FIELD_ERROR (1054) for a missing
 * column and ER_NO_SUCH_TABLE (1146) for a missing table — the only
 * errors a reader may degrade on during a schema-upgrade window;
 * anything else is a real failure and must propagate.
 */
export function isMissingMysqlSchema(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const { code, errno } = error as { code?: unknown; errno?: unknown };
	return (
		code === "ER_BAD_FIELD_ERROR" ||
		code === "ER_NO_SUCH_TABLE" ||
		errno === 1054 ||
		errno === 1146
	);
}
