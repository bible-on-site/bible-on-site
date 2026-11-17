/**
 * Whether a query failure means the schema it needs is not deployed yet —
 * the only errors a caller may degrade on during a schema-upgrade window;
 * anything else is a real failure. `codes` lists the MySQL error codes
 * accepted (ER_NO_SUCH_TABLE for a missing table, ER_BAD_FIELD_ERROR for a
 * missing column); `errnos` the accepted numeric equivalents when the
 * driver reports those instead.
 *
 * Pure by contract — no db imports — so client-safe modules like
 * covering-sources.ts can degrade on the same predicate without shipping
 * mysql2 into the browser bundle.
 */
export function isMysqlSchemaMissing(
	error: unknown,
	accepted: { codes: readonly string[]; errnos?: readonly number[] },
): boolean {
	if (typeof error !== "object" || error === null) return false;
	const { code, errno } = error as { code?: unknown; errno?: unknown };
	return (
		accepted.codes.includes(code as string) ||
		(accepted.errnos?.includes(errno as number) ?? false)
	);
}
