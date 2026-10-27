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
	resolveDedications,
	SEFER_NAME_BY_ID,
} from "./service";
import { formatDedication, type Dedication } from "./types";

/** Active dedications for one perek (direct range + sefer + helek ancestors). */
export const getPerekDedications = cachedPerKey(
	"perek-dedications",
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.dedications, perekDedicationsTag(Number(key))],
	(perekId: number) => resolveDedications({ perekIds: [perekId] }),
);

/** Active dedications for one sefer (direct + helek ancestor). */
export const getSeferDedications = cachedPerKey(
	"sefer-dedications",
	(seferId: number) => String(seferId),
	(key) => [COLLECTION_TAGS.dedications, seferDedicationsTag(Number(key))],
	(seferId: number) => resolveDedications({ seferIds: [seferId] }),
);

/** Active dedications for one helek. */
export const getHelekDedications = cachedPerKey(
	"helek-dedications",
	(helekId: number) => String(helekId),
	(key) => [COLLECTION_TAGS.dedications, helekDedicationsTag(Number(key))],
	(helekId: number) => resolveDedications({ helekIds: [helekId] }),
);

/** Active dedications for one weekly parasha unit. */
export const getParashaDedications = cachedPerKey(
	"parasha-dedications",
	(unitId: number) => String(unitId),
	(key) => [COLLECTION_TAGS.dedications, parashaDedicationsTag(Number(key))],
	(unitId: number) => resolveDedications({ parashaIds: [unitId] }),
);

/** Active dedications for one article (the preserved legacy scope). */
export const getArticleDedications = cachedPerKey(
	"article-dedications",
	(articleId: number) => String(articleId),
	(key) => [COLLECTION_TAGS.dedications, articleDedicationsTag(Number(key))],
	(articleId: number) => resolveDedications({ articleIds: [articleId] }),
);

/** Active dedications for one Tanahpedia entry (canonical entry id). */
export const getEntryDedications = cachedPerKey(
	"pedia-entry-dedications",
	(entryId: string) => entryId,
	(key) => [COLLECTION_TAGS.dedications, entryDedicationsTag(key)],
	(entryId: string) => resolveDedications({ entryIds: [entryId] }),
);

/**
 * The feature-level מסורה על הפרק dedications — one shared entry for the
 * whole feature, so every masora reading unit renders the same set once.
 */
export const getMasoraDedications = unstable_cache(
	() => resolveDedications({ masora: true }),
	["masora-dedications"],
	{ tags: [COLLECTION_TAGS.dedications, masoraDedicationsTag], revalidate: false },
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
		const helek: Record<number, Dedication[]> = {};
		for (const helekId of Object.keys(HELEK_SEFER_IDS)) {
			helek[Number(helekId)] = await resolveDedications({
				helekIds: [Number(helekId)],
			});
		}
		const sefer: Record<number, Dedication[]> = {};
		for (let seferId = 1; seferId <= 35; seferId++) {
			const dedications = await resolveDedications({
				seferIds: [seferId],
			});
			// Keep only sefer-scoped matches — the helek dedication already
			// renders at the helek heading, not beside every sefer.
			const scoped = dedications.filter((dedication) =>
				dedication.scopes.some((scope) => scope.kind === "SEFER"),
			);
			if (scoped.length > 0) sefer[seferId] = scoped;
		}
		return { helek, sefer };
	},
	["bookshelf-dedications"],
	{
		tags: [COLLECTION_TAGS.dedications, bookshelfDedicationsTag],
		revalidate: false,
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
