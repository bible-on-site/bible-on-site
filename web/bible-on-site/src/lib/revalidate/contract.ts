/**
 * The typed entity-change contract between the admin server and the
 * website's `/api/revalidate` endpoint.
 *
 * The admin identifies *what* changed (entities, their old and new
 * relationships); the website owns *which* rendered output depends on it
 * (see `./dependencies.ts`). Admin never names website routes or cache
 * tags — the route/tag mapping cannot drift out of sync with the pages.
 *
 * Every optional field named `old*` carries the pre-commit relationship
 * for rename/move/delete: after the commit the old edge may no longer be
 * queryable, so it must arrive inside the event itself. Fields that are
 * sets (e.g. `perekIds`, `entryUniqueNames`) hold the union of the old
 * and new relationship — the caller merges across a burst before
 * enqueueing, and the resolver treats them as "any of these".
 */
export const MAX_CHANGES_PER_REQUEST = 64;
const MAX_STRING = 256;
const MAX_LIST = 512;
const MAX_PEREK_ID = 929;

/** A pasuk-granular scripture span of verified article coverage (#2189). */
export interface ArticleCoveringSpan {
	perekId: number;
	pasukFrom: number;
	pasukTo: number;
}

export type EntityChange =
	| {
			kind: "article";
			/** tanah_article.id — survives moves/deletes. */
			id: number;
			/** Old ∪ new primary perek ids the article belongs to. */
			perekIds: number[];
			/** Old ∪ new tanah_article.author_id — author page deps. */
			authorIds?: number[];
			/**
			 * The destroyed side of covering-source coverage: spans that no
			 * longer exist after the commit (replaced/deleted rows, or the
			 * whole set when verification flipped off). The resolver unions
			 * them with the article's live covering rows, so create/update
			 * payloads may omit the surviving side entirely.
			 */
			coveringSpans?: ArticleCoveringSpan[];
	  }
	| {
			kind: "author";
			/** tanah_author.id — resolves the author's articles. */
			id: number;
			/** Current name (the post-commit slug source). */
			name: string;
			/** Pre-commit name when it changed (rename). */
			oldName?: string;
	  }
	| {
			kind: "pedia-entry";
			/** tanahpedia_entry.unique_name after the change. */
			uniqueName: string;
			/** Pre-commit unique_name on rename/delete. */
			oldUniqueName?: string;
			/** Old ∪ new entity types — for category-page deps on delete. */
			entityTypes?: string[];
			/** Old ∪ new synonym names — alias/disambiguation pages. */
			synonymNames?: string[];
			/** Perakim whose curated refs link the entry (pre-resolved on delete). */
			refPerekIds?: number[];
	  }
	| {
			kind: "pedia-entity";
			/** tanahpedia_entity.id — person/place/saying/… rows share it. */
			entityId: string;
			/** Entity type when known — category-page dep on delete. */
			entityType?: string;
			/** Pre-resolved linked entry unique_names (deletes/unlinks). */
			entryUniqueNames?: string[];
			/** Pre-resolved perakim sourcing the entity (deletes/unlinks). */
			refPerekIds?: number[];
	  }
	| {
			kind: "pedia-entries";
			/** Entry unique_names the caller resolved before commit. */
			uniqueNames: string[];
			entityTypes?: string[];
			refPerekIds?: number[];
	  }
	| {
			kind: "dedication";
			/** tanah_dedication.id — survives edits/deletes. */
			id: number;
			/**
			 * Old ∪ new assignments of the dedication (#2731). The admin
			 * resolves them post-commit from the link tables (pre-commit on
			 * delete), and the website maps them to the scoped cache tags
			 * and pages that render them.
			 */
			perekRanges?: { low: number; high: number }[];
			seferIds?: number[];
			helekIds?: number[];
			parashaIds?: number[];
			articleIds?: number[];
			/** Canonical tanahpedia_entry ids of entry-scoped assignments. */
			entryIds?: string[];
			/** True when the dedication carries the whole-masora scope. */
			masora?: boolean;
	  };

/** Thrown when a change payload fails validation — maps to HTTP 400. */
export class ChangeValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ChangeValidationError";
	}
}

function fail(message: string): never {
	throw new ChangeValidationError(message);
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(`${at}: expected object`);
	}
	return value as Record<string, unknown>;
}

function reqInt(value: unknown, at: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		fail(`${at}: expected positive integer`);
	}
	return value;
}

function reqString(value: unknown, at: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_STRING
	) {
		fail(`${at}: expected non-empty string up to ${MAX_STRING} chars`);
	}
	return value;
}

function optString(value: unknown, at: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	return reqString(value, at);
}

function intList(value: unknown, at: string): number[] {
	if (!Array.isArray(value) || value.length > MAX_LIST) {
		fail(`${at}: expected an array of up to ${MAX_LIST} integers`);
	}
	return (value as unknown[]).map((item, i) => reqInt(item, `${at}[${i}]`));
}

function optIntList(value: unknown, at: string): number[] | undefined {
	if (value === undefined || value === null) return undefined;
	return intList(value, at);
}

function stringList(value: unknown, at: string): string[] {
	if (!Array.isArray(value) || value.length > MAX_LIST) {
		fail(`${at}: expected an array of up to ${MAX_LIST} strings`);
	}
	return (value as unknown[]).map((item, i) =>
		reqString(item, `${at}[${i}]`),
	);
}

function optStringList(value: unknown, at: string): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	return stringList(value, at);
}

function optPerekRanges(
	value: unknown,
	at: string,
): { low: number; high: number }[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.length > MAX_LIST) {
		fail(`${at}: expected an array of up to ${MAX_LIST} ranges`);
	}
	return (value as unknown[]).map((range, i) => {
		const r = asRecord(range, `${at}[${i}]`);
		const low = reqInt(r.low, `${at}[${i}].low`);
		const high = reqInt(r.high, `${at}[${i}].high`);
		// Every reading surface uses the canonical 1..929 corpus. Bound
		// ranges before dependency resolution expands each member into
		// cache tags and routes; list-size limits alone do not bound work.
		if (low > MAX_PEREK_ID) {
			fail(`${at}[${i}].low: expected perek id 1..${MAX_PEREK_ID}`);
		}
		if (high > MAX_PEREK_ID) {
			fail(`${at}[${i}].high: expected perek id 1..${MAX_PEREK_ID}`);
		}
		if (high < low) {
			fail(`${at}[${i}]: high before low`);
		}
		return { low, high };
	});
}

function optBool(value: unknown, at: string): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "boolean") {
		fail(`${at}: expected boolean`);
	}
	return value;
}

function optCoveringSpans(
	value: unknown,
	at: string,
): ArticleCoveringSpan[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value) || value.length > MAX_LIST) {
		fail(`${at}: expected an array of up to ${MAX_LIST} spans`);
	}
	return (value as unknown[]).map((span, i) => {
		const s = asRecord(span, `${at}[${i}]`);
		const perekId = reqInt(s.perekId, `${at}[${i}].perekId`);
		const pasukFrom = reqInt(s.pasukFrom, `${at}[${i}].pasukFrom`);
		const pasukTo = reqInt(s.pasukTo, `${at}[${i}].pasukTo`);
		if (pasukTo < pasukFrom) {
			fail(`${at}[${i}]: pasukTo before pasukFrom`);
		}
		return { perekId, pasukFrom, pasukTo };
	});
}

function parseChange(value: unknown, at: string): EntityChange {
	const rec = asRecord(value, at);
	switch (rec.kind) {
		case "article":
			return {
				kind: "article",
				id: reqInt(rec.id, `${at}.id`),
				perekIds: intList(rec.perekIds, `${at}.perekIds`),
				authorIds: optIntList(rec.authorIds, `${at}.authorIds`),
				coveringSpans: optCoveringSpans(
					rec.coveringSpans,
					`${at}.coveringSpans`,
				),
			};
		case "author":
			return {
				kind: "author",
				id: reqInt(rec.id, `${at}.id`),
				name: reqString(rec.name, `${at}.name`),
				oldName: optString(rec.oldName, `${at}.oldName`),
			};
		case "pedia-entry":
			return {
				kind: "pedia-entry",
				uniqueName: reqString(rec.uniqueName, `${at}.uniqueName`),
				oldUniqueName: optString(
					rec.oldUniqueName,
					`${at}.oldUniqueName`,
				),
				entityTypes: optStringList(
					rec.entityTypes,
					`${at}.entityTypes`,
				),
				synonymNames: optStringList(
					rec.synonymNames,
					`${at}.synonymNames`,
				),
				refPerekIds: optIntList(rec.refPerekIds, `${at}.refPerekIds`),
			};
		case "pedia-entity":
			return {
				kind: "pedia-entity",
				entityId: reqString(rec.entityId, `${at}.entityId`),
				entityType: optString(rec.entityType, `${at}.entityType`),
				entryUniqueNames: optStringList(
					rec.entryUniqueNames,
					`${at}.entryUniqueNames`,
				),
				refPerekIds: optIntList(rec.refPerekIds, `${at}.refPerekIds`),
			};
		case "pedia-entries":
			return {
				kind: "pedia-entries",
				uniqueNames: stringList(rec.uniqueNames, `${at}.uniqueNames`),
				entityTypes: optStringList(
					rec.entityTypes,
					`${at}.entityTypes`,
				),
				refPerekIds: optIntList(rec.refPerekIds, `${at}.refPerekIds`),
			};
		case "dedication":
			return {
				kind: "dedication",
				id: reqInt(rec.id, `${at}.id`),
				perekRanges: optPerekRanges(rec.perekRanges, `${at}.perekRanges`),
				seferIds: optIntList(rec.seferIds, `${at}.seferIds`),
				helekIds: optIntList(rec.helekIds, `${at}.helekIds`),
				parashaIds: optIntList(rec.parashaIds, `${at}.parashaIds`),
				articleIds: optIntList(rec.articleIds, `${at}.articleIds`),
				entryIds: optStringList(rec.entryIds, `${at}.entryIds`),
				masora: optBool(rec.masora, `${at}.masora`),
			};
		default:
			fail(`${at}.kind: unknown entity change kind`);
	}
}

/**
 * Validates the `{changes}` request body into typed entity changes.
 * Fails closed: any malformed item rejects the whole request before any
 * invalidation side effect runs.
 */
export function parseEntityChanges(body: unknown): EntityChange[] {
	const rec = asRecord(body, "body");
	if (!Array.isArray(rec.changes)) {
		fail("body.changes: expected an array of entity changes");
	}
	if (
		rec.changes.length === 0 ||
		rec.changes.length > MAX_CHANGES_PER_REQUEST
	) {
		fail(
			`body.changes: expected 1..${MAX_CHANGES_PER_REQUEST} changes, got ${rec.changes.length}`,
		);
	}
	return (rec.changes as unknown[]).map((change, i) =>
		parseChange(change, `changes[${i}]`),
	);
}
