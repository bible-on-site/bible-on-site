/** Existing encyclopedia keys include prefixed identifiers as well as UUIDs.
 * Preserve their stored case; discussion/job IDs use the stricter UUID parser. */
export function isContributionRecordId(value: unknown): value is string {
	if (typeof value !== "string" || value.length !== 36) return false;
	const parts = value.split("-");
	return (
		parts.length === 5 &&
		parts.every(
			(part, index) =>
				part.length === [8, 4, 4, 4, 12][index] &&
				[...part.toLowerCase()].every(
					(char) =>
						(char >= "a" && char <= "z") || (char >= "0" && char <= "9"),
				),
		)
	);
}
/** MySQL's identifier columns use a case-insensitive collation. */
export function contributionIdentifierKey(value: string): string {
	return value.toLowerCase();
}
export function contributionRecordId(value: unknown, field: string): string {
	if (!isContributionRecordId(value))
		throw new Error(`${field}: invalid identifier`);
	return value;
}
