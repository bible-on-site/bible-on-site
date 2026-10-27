import { getAllMasoraUnits } from "@/data/masora/masora-units";
import {
	getAllParashaUnits,
	parashaAuxiliaryRanges,
} from "@/data/parasha/parasha-units";
import { parashaCanonicalSlug } from "@/data/parasha/parasha-slugs";
import { query } from "@/lib/api-client";
import { authorNameToSlug, normalizeAuthorName } from "@/lib/authors";
import { isMissingMysqlSchema } from "@/lib/mysql-errors";
import { type PerekSlice, rangesPerekSlices } from "@/lib/reading/ranges";
import { canonicalPasukCount } from "@/lib/reading/queries";
import { CATEGORY_SLUGS } from "@/lib/tanahpedia/category-slug";
import type { CategoryKey } from "@/lib/tanahpedia/types";
import type {
	ArticleCoveringSpan,
	EntityChange,
} from "@/lib/revalidate/contract";
import {
	articleTag,
	authorArticlesTag,
	authorTag,
	COLLECTION_TAGS,
	entityRefsTag,
	masoraArticlesTag,
	parashaArticlesTag,
	perekArticlesTag,
} from "@/lib/revalidate/tags";

/**
 * The website-owned dependency index: maps a committed entity change to
 * the cache tags and route paths whose rendered output consumes it.
 *
 * - `tags` expire `unstable_cache` data entries; because a route's render
 *   collects the tags of the caches it read, the tag also expires the
 *   rendered pages of those entries.
 * - `paths` expire prerendered routes directly — needed where the page's
 *   data is not tag-cached (every `/pedia/*` view reads the DB plainly).
 * - `patterns` cover the fallback case where precise enumeration is
 *   impossible (a dynamic route pattern is expired whole rather than
 *   losing the update).
 */
export interface ResolvedInvalidation {
	tags: string[];
	paths: string[];
	patterns: { path: string; type: "page" }[];
	/** Public URLs to submit to IndexNow — literal paths that changed. */
	urls: string[];
}

/**
 * Hard bound on the invalidation fan-out of one request. Beyond it the
 * resolver degrades to collection tags + the `/pedia/[slug]` pattern —
 * still correct, no longer surgical, and bounded work per request.
 */
const MAX_RESOLVED = 2000;

interface Sink {
	tags: Set<string>;
	paths: Set<string>;
	patterns: Set<string>;
	overflowed: boolean;
}

function newSink(): Sink {
	return {
		tags: new Set(),
		paths: new Set(),
		patterns: new Set(),
		overflowed: false,
	};
}

function addTag(sink: Sink, tag: string) {
	sink.tags.add(tag);
	checkOverflow(sink);
}

function addPath(sink: Sink, path: string) {
	sink.paths.add(path);
	checkOverflow(sink);
}

function checkOverflow(sink: Sink) {
	if (sink.tags.size + sink.paths.size > MAX_RESOLVED) {
		sink.overflowed = true;
	}
}

/** Degrade an over-broad resolution to collection-level expiry. */
function applyOverflowFallback(sink: Sink) {
	sink.tags = new Set([
		COLLECTION_TAGS.articles,
		COLLECTION_TAGS.authors,
		COLLECTION_TAGS.pediaEntityRefs,
		COLLECTION_TAGS.pediaMentionRefs,
	]);
	sink.patterns.add("/pedia/[slug]");
	sink.paths.add("/pedia");
	sink.paths.add("/929/authors");
}

function categoryPath(entityType: string): string | null {
	const slug = CATEGORY_SLUGS[entityType as CategoryKey];
	return slug ? `/pedia/${slug}` : null;
}

// --- range-unit resolution -------------------------------------------------

interface UnitRef {
	division: "parasha" | "masora";
	unitId: number;
	scope?: string;
	slices: PerekSlice[];
}

/**
 * Static division → covered perek/pasuk slices, computed once per
 * process. Readings are closed data (the divisions are fixed), so the
 * index never expires within a process.
 */
let unitIndex: UnitRef[] | null = null;

function readingUnitIndex(): UnitRef[] {
	if (!unitIndex) {
		const index: UnitRef[] = [];
		for (const unit of getAllParashaUnits()) {
			index.push({
				division: "parasha",
				unitId: unit.unitId,
				scope: "torah",
				slices: rangesPerekSlices(unit.ranges, canonicalPasukCount),
			});
			const aux = parashaAuxiliaryRanges(unit);
			if (aux.length > 0) {
				index.push({
					division: "parasha",
					unitId: unit.unitId,
					scope: "haftara",
					slices: rangesPerekSlices(aux, canonicalPasukCount),
				});
			}
		}
		for (const unit of getAllMasoraUnits()) {
			index.push({
				division: "masora",
				unitId: unit.unitId,
				slices: rangesPerekSlices(unit.ranges, canonicalPasukCount),
			});
		}
		unitIndex = index;
	}
	return unitIndex;
}

/** Whether the covering span overlaps any unit slice at pasuk level. */
function spanIntersectsSlices(
	slices: PerekSlice[],
	span: { perekId: number; pasukFrom: number; pasukTo: number },
): boolean {
	return slices.some(
		(slice) =>
			slice.perekId === span.perekId &&
			span.pasukFrom <= slice.endPasuk &&
			span.pasukTo >= slice.startPasuk,
	);
}

/**
 * The reading-division unit surfaces an article change touches: covering
 * spans intersect unit slices at pasuk granularity and primary-perek ids
 * match at perek granularity — the union of both matching rules
 * `getArticleSummariesForRanges` queries with, so a verification flip is
 * covered either way.
 */
function* unitsForArticle(
	perekIds: number[],
	spans: ArticleCoveringSpan[],
): Generator<UnitRef> {
	const perekSet = new Set(perekIds);
	for (const unit of readingUnitIndex()) {
		const hitsPerek = unit.slices.some((s) => perekSet.has(s.perekId));
		const hitsSpan = spans.some((span) =>
			spanIntersectsSlices(unit.slices, span),
		);
		if (hitsPerek || hitsSpan) yield unit;
	}
}

/**
 * Merge overlapping/contiguous spans per perek — the shape the `article`
 * change contract carries — so a long covered section stays a handful of
 * ranges instead of hundreds of single-verse spans.
 */
function mergeSpans(spans: ArticleCoveringSpan[]): ArticleCoveringSpan[] {
	const sorted = [...spans].sort(
		(a, b) => a.perekId - b.perekId || a.pasukFrom - b.pasukFrom,
	);
	const merged: ArticleCoveringSpan[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (
			last &&
			last.perekId === span.perekId &&
			span.pasukFrom <= last.pasukTo + 1
		) {
			last.pasukTo = Math.max(last.pasukTo, span.pasukTo);
		} else {
			merged.push({ ...span });
		}
	}
	return merged;
}

function mergeCoveringRows(
	rows: { perekId: number; pasuk: number }[],
): ArticleCoveringSpan[] {
	return mergeSpans(
		rows.map((row) => ({
			perekId: row.perekId,
			pasukFrom: row.pasuk,
			pasukTo: row.pasuk,
		})),
	);
}

/**
 * The persisted covering rows of one article, merged into spans. Empty
 * when the covering-source schema is not deployed yet (the reader falls
 * back to primary-perek matching in the same window — see
 * getArticleSummariesForRanges); other failures propagate so a resolver
 * error fails the whole call rather than under-invalidating.
 */
async function coveringSpansForArticle(
	articleId: number,
): Promise<ArticleCoveringSpan[]> {
	try {
		const rows = await query<{ perek_id: number; pasuk: number }>(
			`SELECT perek_id, pasuk FROM tanah_article_covering_source
			 WHERE article_id = ?`,
			[articleId],
		);
		return mergeCoveringRows(
			rows.map((r) => ({ perekId: r.perek_id, pasuk: r.pasuk })),
		);
	} catch (error) {
		if (isMissingMysqlSchema(error)) return [];
		throw error;
	}
}

/**
 * The verified covering spans of every article by one author — needed on
 * author changes, where the author's name/details re-render inside range
 * units that carry the article only through verified covering rows. Empty
 * when the covering-source schema is not deployed yet (the reader falls
 * back to primary-perek matching in the same window — see
 * getArticleSummariesForRanges).
 */
async function coveringSpansForAuthor(
	authorId: number,
): Promise<ArticleCoveringSpan[]> {
	try {
		const rows = await query<{ perek_id: number; pasuk: number }>(
			`SELECT cs.perek_id, cs.pasuk FROM tanah_article_covering_source cs
			 JOIN tanah_article a ON a.id = cs.article_id
			 WHERE a.author_id = ? AND a.coverage_verified = TRUE`,
			[authorId],
		);
		return mergeCoveringRows(
			rows.map((r) => ({ perekId: r.perek_id, pasuk: r.pasuk })),
		);
	} catch (error) {
		if (isMissingMysqlSchema(error)) return [];
		throw error;
	}
}

function addUnitDeps(sink: Sink, unit: UnitRef) {
	if (unit.division === "parasha") {
		/* istanbul ignore next -- every parasha index entry sets scope explicitly */
		const scope = unit.scope ?? "torah";
		addTag(sink, parashaArticlesTag(unit.unitId, scope));
		// The route-dir path carries the canonical Hebrew slug — its
		// dynamic param is the slug, not the unitId (issue #2738).
		addPath(sink, `/parasha/${parashaCanonicalSlug(unit.unitId)}`);
	} else {
		addTag(sink, masoraArticlesTag(unit.unitId));
		addPath(sink, `/masora/${unit.unitId}`);
	}
}

// --- website-side inverse lookups (post-commit, best-effort) ---------------

function placeholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

/** Entry unique_names linked to the given entities (post-commit truth). */
async function entriesForEntities(entityIds: string[]): Promise<string[]> {
	/* istanbul ignore next -- callers always pass a non-empty entity id list */
	if (entityIds.length === 0) return [];
	const rows = await query<{ unique_name: string }>(
		`SELECT DISTINCT e.unique_name FROM tanahpedia_entry e
		 JOIN tanahpedia_entry_entity ee ON ee.entry_id = e.id
		 WHERE ee.entity_id IN (${placeholders(entityIds.length)})`,
		entityIds,
	);
	return rows.map((r) => r.unique_name);
}

/** Perakim whose curated entity references source the given entities. */
async function refPereksForEntities(entityIds: string[]): Promise<number[]> {
	/* istanbul ignore next -- callers always pass a non-empty entity id list */
	if (entityIds.length === 0) return [];
	const rows = await query<{ perek_id: number }>(
		`SELECT DISTINCT perek_id FROM tanahpedia_entity_tanah_source
		 WHERE entity_id IN (${placeholders(entityIds.length)})`,
		entityIds,
	);
	return rows.map((r) => r.perek_id);
}

/** Entity types linked to the given entities (for category-page deps). */
async function entityTypesForEntities(
	entityIds: string[],
): Promise<string[]> {
	/* istanbul ignore next -- callers always pass a non-empty entity id list */
	if (entityIds.length === 0) return [];
	const rows = await query<{ entity_type: string }>(
		`SELECT DISTINCT entity_type FROM tanahpedia_entity
		 WHERE id IN (${placeholders(entityIds.length)})`,
		entityIds,
	);
	return rows.map((r) => r.entity_type);
}

interface EntryRelations {
	entryId: string | null;
	entityTypes: string[];
	synonymNames: string[];
	refPerekIds: number[];
}

/**
 * The live relationships of one pedia entry — its id, linked entity
 * types, synonym names and the perakim whose curated references point at
 * it. Empty fields when the entry is gone (delete): the caller-supplied
 * old relationships in the change event carry the dependency set then.
 */
async function entryRelations(uniqueName: string): Promise<EntryRelations> {
	const entry = await query<{ id: string }>(
		`SELECT id FROM tanahpedia_entry WHERE unique_name = ?`,
		[uniqueName],
	);
	const entryId = entry[0]?.id ?? null;
	if (entryId === null) {
		return {
			entryId: null,
			entityTypes: [],
			synonymNames: [],
			refPerekIds: [],
		};
	}
	const [entityTypes, synonymNames, refPerekIds] = await Promise.all([
		query<{ entity_type: string }>(
			`SELECT DISTINCT e.entity_type FROM tanahpedia_entry_entity ee
			 JOIN tanahpedia_entity e ON e.id = ee.entity_id
			 WHERE ee.entry_id = ?`,
			[entryId],
		).then((rows) => rows.map((r) => r.entity_type)),
		// Direct aliases plus disambiguation pages listing this entry as a
		// target — losing either link kind expires the same /pedia/{name} page.
		query<{ name: string }>(
			`SELECT name FROM tanahpedia_entry_synonym WHERE entry_id = ?
			 UNION
			 SELECT s2.name FROM tanahpedia_entry_synonym_disambiguation d
			 JOIN tanahpedia_entry_synonym s2 ON s2.id = d.synonym_id
			 WHERE d.entry_id = ?`,
			[entryId, entryId],
		).then((rows) => rows.map((r) => r.name)),
		query<{ perek_id: number }>(
			`SELECT DISTINCT ets.perek_id FROM tanahpedia_entity_tanah_source ets
			 JOIN tanahpedia_entry_entity ee ON ee.entity_id = ets.entity_id
			 WHERE ee.entry_id = ?`,
			[entryId],
		).then((rows) => rows.map((r) => r.perek_id)),
	]);
	return { entryId, entityTypes, synonymNames, refPerekIds };
}

/**
 * The shared dependency set of one pedia entry name: its `/pedia/{name}`
 * route (alias or disambiguation pages live on the same route), the
 * categories its entities list it under, the index, the per-perek curated
 * reference caches and the broad mention-decoration cache (mention rows
 * resolve by name, so any entry lifecycle change can flip resolution on
 * any perek — no cheap scoping exists).
 */
function addPediaEntryDeps(
	sink: Sink,
	names: string[],
	entityTypes: string[],
	refPerekIds: number[],
) {
	for (const name of names) {
		addPath(sink, `/pedia/${name}`);
	}
	addPath(sink, "/pedia");
	for (const entityType of entityTypes) {
		const path = categoryPath(entityType);
		if (path) addPath(sink, path);
	}
	for (const perekId of refPerekIds) {
		addTag(sink, entityRefsTag(perekId));
	}
	addTag(sink, COLLECTION_TAGS.pediaMentionRefs);
}

// --- per-kind resolution ----------------------------------------------------

async function resolveArticle(
	sink: Sink,
	change: Extract<EntityChange, { kind: "article" }>,
) {
	addTag(sink, articleTag(change.id));
	for (const perekId of change.perekIds) {
		addTag(sink, perekArticlesTag(perekId));
		addPath(sink, `/929/${perekId}`);
		addPath(sink, `/929/${perekId}/${change.id}`);
	}
	for (const authorId of change.authorIds ?? []) {
		addTag(sink, authorArticlesTag(authorId));
		const author = await query<{ name: string }>(
			`SELECT name FROM tanah_author WHERE id = ?`,
			[authorId],
		);
		if (author[0]) {
			addTag(sink, authorTag(normalizeAuthorName(author[0].name)));
			addPath(
				sink,
				`/929/authors/${authorNameToSlug(author[0].name)}`,
			);
		}
	}
	// The supplied spans are the destroyed side; the live rows complete the
	// union so an update that only shrank coverage still expires both sides.
	const liveSpans = await coveringSpansForArticle(change.id);
	const spans = mergeSpans([...(change.coveringSpans ?? []), ...liveSpans]);
	if (change.perekIds.length === 0 && spans.length === 0) {
		// Defensive: an unlocatable article still expires the collection.
		addTag(sink, COLLECTION_TAGS.articles);
		return;
	}
	for (const unit of unitsForArticle(change.perekIds, spans)) {
		addUnitDeps(sink, unit);
	}
}

async function resolveAuthor(
	sink: Sink,
	change: Extract<EntityChange, { kind: "author" }>,
) {
	// The index lists every author.
	addTag(sink, COLLECTION_TAGS.authors);
	addPath(sink, "/929/authors");
	for (const name of [change.name, change.oldName]) {
		if (!name) continue;
		addTag(sink, authorTag(normalizeAuthorName(name)));
		addPath(sink, `/929/authors/${authorNameToSlug(name)}`);
	}
	// Legacy numeric-param author pages still resolve on demand.
	addTag(sink, authorTag(String(change.id)));
	addTag(sink, authorArticlesTag(change.id));

	// The author's name/details render inside every one of their article
	// surfaces — its pages, the hosting perek lists and covering units.
	const articles = await query<{ id: number; perek_id: number }>(
		`SELECT id, perek_id FROM tanah_article
		 WHERE author_id = ? AND perek_id BETWEEN 1 AND 929`,
		[change.id],
	);
	for (const article of articles) {
		addTag(sink, articleTag(article.id));
		addTag(sink, perekArticlesTag(article.perek_id));
		addPath(sink, `/929/${article.perek_id}`);
		addPath(sink, `/929/${article.perek_id}/${article.id}`);
	}
	const perekIds = articles.map((a) => a.perek_id);
	const spans = await coveringSpansForAuthor(change.id);
	for (const unit of unitsForArticle(perekIds, spans)) {
		addUnitDeps(sink, unit);
	}
}

async function resolvePediaEntry(
	sink: Sink,
	change: Extract<EntityChange, { kind: "pedia-entry" }>,
) {
	const names = new Set<string>([change.uniqueName]);
	if (change.oldUniqueName) names.add(change.oldUniqueName);

	// Live relationships for the surviving name; supplied fields carry the
	// destroyed side of renames/deletes.
	const relations = await entryRelations(change.uniqueName);
	const entityTypes = new Set([
		...(change.entityTypes ?? []),
		...relations.entityTypes,
	]);
	const synonymNames = new Set([
		...(change.synonymNames ?? []),
		...relations.synonymNames,
	]);
	const refPerekIds = new Set([
		...(change.refPerekIds ?? []),
		...relations.refPerekIds,
	]);
	for (const synonym of synonymNames) names.add(synonym);
	addPediaEntryDeps(sink, [...names], [...entityTypes], [...refPerekIds]);
}

async function resolvePediaEntity(
	sink: Sink,
	change: Extract<EntityChange, { kind: "pedia-entity" }>,
) {
	const [linkedEntries, refPerekIds, entityTypes] = await Promise.all([
		entriesForEntities([change.entityId]),
		refPereksForEntities([change.entityId]),
		entityTypesForEntities([change.entityId]),
	]);
	const names = new Set([
		...(change.entryUniqueNames ?? []),
		...linkedEntries,
	]);
	const types = new Set([
		...(change.entityType ? [change.entityType] : []),
		...entityTypes,
	]);
	const pereks = new Set([
		...(change.refPerekIds ?? []),
		...refPerekIds,
	]);
	// Synonyms of linked entries point at pages whose bodies render entity
	// data — resolve them while the links exist.
	if (names.size > 0) {
		const synonyms = await query<{ name: string }>(
			`SELECT DISTINCT s.name FROM tanahpedia_entry_synonym s
			 JOIN tanahpedia_entry e ON e.id = s.entry_id
			 WHERE e.unique_name IN (${placeholders(names.size)})`,
			[...names],
		);
		for (const row of synonyms) names.add(row.name);
	}
	addPediaEntryDeps(sink, [...names], [...types], [...pereks]);
}

function resolvePediaEntries(
	sink: Sink,
	change: Extract<EntityChange, { kind: "pedia-entries" }>,
) {
	addPediaEntryDeps(
		sink,
		change.uniqueNames,
		change.entityTypes ?? [],
		change.refPerekIds ?? [],
	);
}

/**
 * Resolves the union dependency set of a batch of committed entity
 * changes. Coalescing happens naturally: repeated events collapse into
 * the same tags/paths, and the union of old+new relationships across a
 * burst is preserved.
 */
export async function resolveEntityChanges(
	changes: EntityChange[],
): Promise<ResolvedInvalidation> {
	const sink = newSink();
	for (const change of changes) {
		switch (change.kind) {
			case "article":
				await resolveArticle(sink, change);
				break;
			case "author":
				await resolveAuthor(sink, change);
				break;
			case "pedia-entry":
				await resolvePediaEntry(sink, change);
				break;
			case "pedia-entity":
				await resolvePediaEntity(sink, change);
				break;
			case "pedia-entries":
				resolvePediaEntries(sink, change);
				break;
		}
	}
	if (sink.overflowed) {
		applyOverflowFallback(sink);
	}
	return {
		tags: [...sink.tags],
		paths: [...sink.paths],
		patterns: [...sink.patterns].map((path) => ({
			path,
			type: "page" as const,
		})),
		urls: [...sink.paths],
	};
}
