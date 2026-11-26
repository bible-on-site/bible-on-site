import { isMysqlSchemaMissing } from "../mysql-errors";

export function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

export function toNum(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === "number" && !Number.isNaN(v)) return v;
	const n = Number.parseFloat(String(v));
	return Number.isFinite(n) ? n : null;
}

/** ER_NO_SUCH_TABLE — the external_reference deploy has not run here yet. */
export function isMissingMysqlSchema(error: unknown): boolean {
	return isMysqlSchemaMissing(error, { codes: ["ER_NO_SUCH_TABLE"] });
}

/**
 * ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR — a schema upgrade (new table or
 * new column on an existing table) has not reached this database yet,
 * like the reading-metrics/dedication tolerance in ../reading-metrics.ts.
 */
export function isMissingMysqlSchemaOrColumn(error: unknown): boolean {
	return isMysqlSchemaMissing(error, {
		codes: ["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"],
		errnos: [1146, 1054],
	});
}
