/**
 * The website side of the typed entity-change contract between the admin
 * server and the `/api/revalidate` endpoint: the fail-closed input
 * validation. The shared wire definitions (`EntityChange`,
 * `ArticleCoveringSpan`, `MAX_CHANGES_PER_REQUEST`) live in
 * `web/shared/revalidate/` — the admin sender and this receiver deploy
 * independently, so they must stay a single source.
 *
 * The admin identifies *what* changed (entities, their old and new
 * relationships); the website owns *which* rendered output depends on it
 * (see `./dependencies.ts`). Admin never names website routes or cache
 * tags — the route/tag mapping cannot drift out of sync with the pages.
 */
import {
	type ArticleCoveringSpan,
	type EntityChange,
	MAX_CHANGES_PER_REQUEST,
} from "../../../../shared/revalidate/index";

export type { ArticleCoveringSpan, EntityChange };
export { MAX_CHANGES_PER_REQUEST };

const MAX_STRING = 256;
const MAX_LIST = 512;
const MAX_PEREK_ID = 929;

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
	return (value as unknown[]).map((item, i) => reqString(item, `${at}[${i}]`));
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
				oldUniqueName: optString(rec.oldUniqueName, `${at}.oldUniqueName`),
				entityTypes: optStringList(rec.entityTypes, `${at}.entityTypes`),
				synonymNames: optStringList(rec.synonymNames, `${at}.synonymNames`),
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
				entityTypes: optStringList(rec.entityTypes, `${at}.entityTypes`),
				refPerekIds: optIntList(rec.refPerekIds, `${at}.refPerekIds`),
			};
		case "moed":
			return {
				kind: "moed",
				id: reqInt(rec.id, `${at}.id`),
				slug: reqString(rec.slug, `${at}.slug`),
				oldSlug: optString(rec.oldSlug, `${at}.oldSlug`),
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
