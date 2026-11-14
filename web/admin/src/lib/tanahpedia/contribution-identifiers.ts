/** Existing encyclopedia keys include prefixed identifiers as well as UUIDs.
 * Preserve their stored case; discussion/job IDs use the stricter UUID parser. */
export function contributionRecordId(value: unknown, field: string): string {
	if (
		typeof value !== "string" ||
		!/^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$/i.test(
			value,
		)
	)
		throw new Error(`${field}: invalid identifier`);
	return value;
}
