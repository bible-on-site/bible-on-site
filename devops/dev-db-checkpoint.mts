/**
 * Dev/prod freshness checkpoint — pure comparison helpers shared by
 * setup-dev-env.mts (records + probes) and its tests.
 *
 * The watermark is each table's information_schema.TABLES.UPDATE_TIME,
 * captured on prod at sync time and stored in the dev DB's
 * dev_sync_checkpoint table. A probe compares current prod values against
 * that snapshot: any table that gained a write, appeared, or disappeared
 * marks the dev copy stale, so `pnpm run dev` only pays the full
 * dump+restore when production actually changed.
 */

/**
 * @param stored table → UPDATE_TIME recorded by the last successful sync
 * @param prod   table → UPDATE_TIME currently reported by prod
 * @returns true when the dev copy provably matches prod
 */
export function isCheckpointCurrent(
	stored: ReadonlyMap<string, string | null>,
	prod: ReadonlyMap<string, string | null>,
): boolean {
	// Prod reported no tables (wrong schema/unreadable) or its engine doesn't
	// track UPDATE_TIME at all — freshness can't be proven, so sync.
	if (prod.size === 0) return false;
	if ([...prod.values()].every((t) => t === null)) return false;
	// No checkpoint row (never synced) or the table set diverged.
	if (stored.size === 0 || stored.size !== prod.size) return false;
	for (const [name, time] of prod) {
		if (stored.get(name) !== time) return false;
	}
	return true;
}

/**
 * Parses `mysql -N -B` rows of `TABLE_NAME \t UPDATE_TIME` (NULL prints as the
 * literal "NULL") into the comparison map.
 */
export function parseTableTimes(tsv: string): Map<string, string | null> {
	const map = new Map<string, string | null>();
	for (const line of tsv.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const [name, time] = line.split("\t");
		if (!name) continue;
		map.set(name, !time || time === "NULL" ? null : time);
	}
	return map;
}
