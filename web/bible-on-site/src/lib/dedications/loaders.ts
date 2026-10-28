/**
 * Cached dedication reads per reading surface (#2731). Every loader goes
 * through `cachedPerKey`/`unstable_cache` so the tags a page render
 * collects let `/api/revalidate` expire exactly the consumed entries —
 * a sefer dedication change invalidates that sefer's perek pages via the
 * scoped tags the dependency resolver emits.
 */
import { unstable_cache } from "next/cache";
import {
	articleDedicationsTag,
	bookshelfDedicationsTag,
	cachedPerKey,
	COLLECTION_TAGS,
	entryDedicationsTag,
	helekDedicationsTag,
	masoraDedicationsTag,
	parashaDedicationsTag,
	perekDedicationsTag,
	seferDedicationsTag,
} from "@/lib/revalidate/tags";
import {
	HELEK_NAME_BY_ID,
	HELEK_SEFER_IDS,
	helekIdBySeferId,
	resolveDedications,
	SEFER_NAME_BY_ID,
	seferIdByPerekId,
	seferPerekIds,
} from "./service";
import { formatDedication, type Dedication } from "./types";

/**
 * Dedication expiry is clock-driven: the admin server arms a wake-up at
 * every stored `expires_at` instant (web/admin server/dedications.ts),
 * but a down or unreachable admin leaves only the event-driven tag
 * invalidations — an expired line would sit on rendered pages forever.
 * A modest time bound guarantees every dedication cache — and every
 * prerendered route that collected it — refreshes within an hour even
 * without the wake-up; tag invalidation still governs immediately
 * (#2731).
 */
const DEDICATION_CACHE_MAX_AGE_S = 60 * 60;
const TIME_BOUND = { revalidate: DEDICATION_CACHE_MAX_AGE_S };

/** Every cache tag a perek resolution consumes: its own plus the sefer and
 * helek ancestors whose scopes it inherits — an ancestor-scope change must
 * expire the entry or the flat heading keeps serving it stale. */
function perekContextTags(perekId: number): string[] {
	const seferId = seferIdByPerekId(perekId);
	const helekId =
		seferId === undefined ? undefined : helekIdBySeferId(seferId);
	return [
		COLLECTION_TAGS.dedications,
		perekDedicationsTag(perekId),
		...(seferId === undefined ? [] : [seferDedicationsTag(seferId)]),
		...(helekId === undefined ? [] : [helekDedicationsTag(helekId)]),
	];
}

/** Every cache tag a sefer resolution consumes: its own plus its helek
 * ancestor's (same stale-ancestor reasoning as `perekContextTags`). */
function seferContextTags(seferId: number): string[] {
	const helekId = helekIdBySeferId(seferId);
	return [
		COLLECTION_TAGS.dedications,
		seferDedicationsTag(seferId),
		...(helekId === undefined ? [] : [helekDedicationsTag(helekId)]),
	];
}

/** Active dedications for one perek (direct range + sefer + helek ancestors). */
export const getPerekDedications = cachedPerKey(
	"perek-dedications",
	(perekId: number) => String(perekId),
	(key) => perekContextTags(Number(key)),
	(perekId: number) => resolveDedications({ perekIds: [perekId] }),
	TIME_BOUND,
);

/** Active dedications for one sefer (direct + helek ancestor). */
export const getSeferDedications = cachedPerKey(
	"sefer-dedications",
	(seferId: number) => String(seferId),
	(key) => seferContextTags(Number(key)),
	(seferId: number) => resolveDedications({ seferIds: [seferId] }),
	TIME_BOUND,
);

/**
 * Perek-scoped dedication lines keyed by canonical perek id — the in-book
 * spread headers of one sefer (#2731). A single resolution over the sefer's
 * whole perek range replaces a per-perek fan-out; each dedication's line
 * attaches to exactly the perakim its matched PEREK scopes cover (the
 * resolver already returns only scopes applicable to the requested range),
 * so perek-range changes expire the entry through the same
 * `perek:{id}:dedications` tags the flat heading consumes.
 */
export const getSeferPerekDedicationLines = cachedPerKey(
	"sefer-perek-dedication-lines",
	(seferId: number) => String(seferId),
	(key) => [
		COLLECTION_TAGS.dedications,
		...seferPerekIds(Number(key)).map(perekDedicationsTag),
	],
	async (seferId: number): Promise<Record<number, string[]>> => {
		const perekIds = seferPerekIds(seferId);
		const dedications = await resolveDedications({ perekIds });
		const lines: Record<number, string[]> = {};
		for (const dedication of dedications) {
			const covered = new Set<number>();
			for (const scope of dedication.scopes) {
				if (
					scope.kind !== "PEREK" ||
					scope.perekIdLow === undefined ||
					scope.perekIdHigh === undefined
				) {
					continue;
				}
				// Clamp to this sefer: a range may span a sefer boundary, but
				// the map belongs to the queried sefer's spreads only.
				const low = Math.max(scope.perekIdLow, perekIds[0]);
				const high = Math.min(scope.perekIdHigh, perekIds[perekIds.length - 1]);
				for (let id = low; id <= high; id++) {
					covered.add(id);
				}
			}
			const line = formatDedication(dedication);
			for (const id of covered) {
				const bucket = lines[id] ?? [];
				bucket.push(line);
				lines[id] = bucket;
			}
		}
		return lines;
	},
	TIME_BOUND,
);

/** Active dedications for one helek. */
export const getHelekDedications = cachedPerKey(
	"helek-dedications",
	(helekId: number) => String(helekId),
	(key) => [COLLECTION_TAGS.dedications, helekDedicationsTag(Number(key))],
	(helekId: number) => resolveDedications({ helekIds: [helekId] }),
	TIME_BOUND,
);

/** Active dedications for one weekly parasha unit. */
export const getParashaDedications = cachedPerKey(
	"parasha-dedications",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.dedications, parashaDedicationsTag(Number(key))],
	(unitId: number) => resolveDedications({ parashaIds: [unitId] }),
	TIME_BOUND,
);

/** Active dedications for one article (the preserved legacy scope). */
export const getArticleDedications = cachedPerKey(
	"article-dedications",
	(articleId: number) => String(articleId),
	(key) => [COLLECTION_TAGS.dedications, articleDedicationsTag(Number(key))],
	(articleId: number) => resolveDedications({ articleIds: [articleId] }),
	TIME_BOUND,
);

/** Active dedications for one Tanahpedia entry (canonical entry id). */
export const getEntryDedications = cachedPerKey(
	"pedia-entry-dedications",
	(entryId: string) => entryId,
	(key) => [COLLECTION_TAGS.dedications, entryDedicationsTag(key)],
	(entryId: string) => resolveDedications({ entryIds: [entryId] }),
	TIME_BOUND,
);

/**
 * The feature-level מסורה על הפרק dedications — one shared entry for the
 * whole feature, so every masora reading unit renders the same set once.
 */
export const getMasoraDedications = unstable_cache(
	() => resolveDedications({ masora: true }),
	["masora-dedications"],
	{
		tags: [COLLECTION_TAGS.dedications, masoraDedicationsTag],
		revalidate: DEDICATION_CACHE_MAX_AGE_S,
	},
);

/**
 * The bookshelf's aggregate view: every active helek- and sefer-scoped
 * dedication grouped for display — helek dedications beside the helek
 * heading, sefer dedications pinned beside each sefer (#2731). Keyed by
 * canonical ids so the client never re-derives identity.
 */
export const getBookshelfDedications = unstable_cache(
	async (): Promise<{
		helek: Record<number, Dedication[]>;
		sefer: Record<number, Dedication[]>;
	}> => {
		// One resolution over every helek and sefer id — the link tables are
		// scanned regardless, so a cold render buckets the single result set
		// instead of repeating the scan once per shelf entry.
		const dedications = await resolveDedications({
			helekIds: Object.keys(HELEK_SEFER_IDS).map(Number),
			seferIds: Object.keys(SEFER_NAME_BY_ID).map(Number),
		});
		const helek: Record<number, Dedication[]> = {};
		for (const helekId of Object.keys(HELEK_SEFER_IDS)) {
			helek[Number(helekId)] = [];
		}
		const sefer: Record<number, Dedication[]> = {};
		for (const dedication of dedications) {
			for (const scope of dedication.scopes) {
				if (scope.kind === "HELEK" && scope.helekId !== undefined) {
					helek[scope.helekId]?.push(dedication);
				}
				// Only sefer-scoped matches land beside a sefer — a helek
				// dedication already renders at the helek heading, not beside
				// every sefer it owns.
				if (scope.kind === "SEFER" && scope.seferId !== undefined) {
					const bucket = sefer[scope.seferId] ?? [];
					bucket.push(dedication);
					sefer[scope.seferId] = bucket;
				}
			}
		}
		return { helek, sefer };
	},
	["bookshelf-dedications"],
	{
		tags: [COLLECTION_TAGS.dedications, bookshelfDedicationsTag],
		revalidate: DEDICATION_CACHE_MAX_AGE_S,
	},
);

/** What the Bookshelf client component renders: formatted display lines
 * keyed by the canonical sefer/helek names the shelf uses. */
export interface BookshelfDedicationLines {
	/** Sefer name -> its sefer-scoped dedication lines. */
	bySefer: Record<string, string[]>;
	/** Helek name (תורה/נביאים/כתובים) -> its helek-scoped lines. */
	byHelek: Record<string, string[]>;
}

/**
 * The cached aggregate projected to display lines keyed by name — the
 * shape the 3D bookshelf takes as a prop and the in-reader picker loads
 * on demand via a server action.
 */
export async function getBookshelfDedicationLines(): Promise<BookshelfDedicationLines> {
	const { helek, sefer } = await getBookshelfDedications();
	const bySefer: Record<string, string[]> = {};
	for (const [id, dedications] of Object.entries(sefer)) {
		const name = SEFER_NAME_BY_ID[Number(id)];
		if (name) bySefer[name] = dedications.map(formatDedication);
	}
	const byHelek: Record<string, string[]> = {};
	for (const [id, dedications] of Object.entries(helek)) {
		const name = HELEK_NAME_BY_ID[Number(id)];
		if (name && dedications.length > 0) {
			byHelek[name] = dedications.map(formatDedication);
		}
	}
	return { bySefer, byHelek };
}
