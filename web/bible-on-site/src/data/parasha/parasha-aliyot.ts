import type {
	ScriptureCoordinate,
	ScriptureRange,
} from "@/lib/reading/contract";
import { canonicalPasukCount } from "@/lib/reading/queries";
import {
	compareCoordinates,
	rangeContainsCoordinate,
} from "@/lib/reading/ranges";
import aliyotData from "./parasha-aliyot.json";
import { getAllParashaUnits, getParashaUnitById } from "./parasha-units";

/**
 * Aliyah boundaries for the פרשה division (issue #2519).
 *
 * Aliyot are a *boundary layer* over the parasha division, not a reading
 * division of their own: a reading context (one standalone parasha, or a
 * named joined pair read together) selects a boundary set, and a named
 * scheme (שבת — seven aliyot plus מפטיר, or weekday קריאת הציבור) selects
 * the split inside it. Joined readings keep their constituent parasha
 * identities (`unitIds`) — a join never merges units.
 *
 * The source table (parasha-aliyot.json) is curated data imported by
 * `devops/import-parasha-aliyot.mjs` from hebcal-leyning's verified
 * boundary list (BSD-2-Clause; provenance + cross-source audit in
 * docs/data/aliyah-sources.md). Like the parasha division itself,
 * references resolve to canonical perekId/pasuk coordinates and are
 * validated against the corpus at module load — impossible endpoints
 * fail the build.
 */

export type AliyahRole = "aliyah" | "maftir";

/** A single aliyah boundary resolved to canonical coordinates. */
export interface AliyahBoundary {
	/** 1..7 for regular aliyot, 8 for maftir. */
	ordinal: number;
	role: AliyahRole;
	/** Hebrew label — ראשון…שביעי, מפטיר. */
	label: string;
	range: ScriptureRange;
	/** Documented alternative split for this aliyah, when the source notes one. */
	note?: string;
}

/** A named boundary scheme/custom (e.g. Shabbat vs weekday splits). */
export interface AliyahScheme {
	id: string;
	label: string;
	description: string;
}

/**
 * A reading context: the stable identity a boundary set belongs to.
 * Standalone contexts hold exactly one parasha unit; joined contexts
 * hold their two constituents in reading order.
 */
export interface ParashaAliyahReading {
	id: string;
	kind: "standalone" | "joined";
	/** Constituent parasha unit ids in reading order (1 standalone, 2 joined). */
	unitIds: number[];
	/** Constituent parasha names in reading order. */
	unitNames: string[];
	seferName: string;
	/** Where this context applies — e.g. חוקת-בלק joins only in חוץ
	 * לארץ. Undefined means the context applies everywhere. */
	applicability?: string;
	/** scheme id → ordered boundaries (validated at load). */
	schemes: Record<string, AliyahBoundary[]>;
}

interface SourceVerse {
	perek: number;
	pasuk: number;
}

interface SourceAliyah {
	ordinal: number;
	role: AliyahRole;
	label: string;
	start: SourceVerse;
	end: SourceVerse;
	note?: string;
}

interface SourceReading {
	id: string;
	units: string[];
	sefer: string;
	applicability?: string;
	schemes: Record<string, SourceAliyah[]>;
}

interface SourceAliyot {
	version: number;
	provenance: {
		name: string;
		repository: string;
		license: string;
		commit: string;
		retrieved: string;
		notes: string[];
	};
	schemes: AliyahScheme[];
	readings: SourceReading[];
}

const source = aliyotData as unknown as SourceAliyot;

export const ALIYAH_SCHEMES: AliyahScheme[] = source.schemes;
export const ALIYAH_PROVENANCE = source.provenance;

/** Default scheme for the flat parasha page — the Shabbat seven. */
export const DEFAULT_ALIYAH_SCHEME = "shabbat";

function resolveReadingAliyah(
	reading: SourceReading,
	schemeId: string,
	aliyah: SourceAliyah,
): AliyahBoundary {
	// Every aliyah lives inside the reading's own sefer (joined pairs are
	// always same-sefer); resolve (perek, pasuk) through the shared
	// perekFrom mapping used by the parasha units themselves.
	const range = resolveRange(
		{ start: aliyah.start, end: aliyah.end },
		reading,
		schemeId,
	);
	return {
		ordinal: aliyah.ordinal,
		role: aliyah.role,
		label: aliyah.label,
		range,
		...(aliyah.note ? { note: aliyah.note } : {}),
	};
}

function resolveRange(
	range: { start: SourceVerse; end: SourceVerse },
	reading: SourceReading,
	schemeId: string,
): ScriptureRange {
	const start = resolveVerse(reading.sefer, range.start, reading.id, schemeId);
	const end = resolveVerse(reading.sefer, range.end, reading.id, schemeId);
	/* istanbul ignore next -- load-time validation: only fires on corrupt vendored data (drift-checked) */
	if (compareCoordinates(start, end, "end") > 0) {
		throw new Error(
			`aliyah data: backwards range in ${reading.id}/${schemeId} ` +
				`${range.start.perek}:${range.start.pasuk}-${range.end.perek}:${range.end.pasuk}`,
		);
	}
	return { start, end };
}

/** Canonical coordinate for a (sefer-relative) perek/pasuk reference. */
function resolveVerse(
	seferName: string,
	ref: SourceVerse,
	readingId: string,
	schemeId: string,
): ScriptureCoordinate {
	const sefer = seferPerekSpan(seferName);
	const perekId = sefer.perekFrom + ref.perek - 1;
	const display = `${seferName} ${ref.perek}:${ref.pasuk} (${readingId}/${schemeId})`;
	/* istanbul ignore next -- load-time validation: only fires on corrupt vendored data (drift-checked) */
	if (perekId > sefer.perekTo || perekId < sefer.perekFrom) {
		throw new Error(`aliyah data: ${display} exceeds ${seferName}'s perakim`);
	}
	const pasukCount = canonicalPasukCountFor(perekId);
	/* istanbul ignore next -- load-time validation: only fires on corrupt vendored data (drift-checked) */
	if (ref.pasuk < 1 || ref.pasuk > pasukCount) {
		throw new Error(
			`aliyah data: ${display} is outside the canonical ${pasukCount} pesukim`,
		);
	}
	return { perekId, pasuk: ref.pasuk };
}

let seferSpanCache: Map<string, { perekFrom: number; perekTo: number }> | null =
	null;

/**
 * Sefer → canonical perek span, derived from the resolved parasha units
 * (the units of a sefer already carry contiguous canonical ranges whose
 * union is the Torah portion of that sefer). This deliberately reuses
 * the same resolution the parasha ranges pass through, instead of
 * duplicating the sefer→perekFrom table.
 */
function seferPerekSpan(seferName: string): {
	perekFrom: number;
	perekTo: number;
} {
	if (!seferSpanCache) {
		seferSpanCache = new Map();
		// Units per sefer are ordered and contiguous; first unit's start
		// and last unit's end bound the sefer's Torah span.
		for (const unit of getAllParashaUnits()) {
			const span = seferSpanCache.get(unit.seferName);
			const start = unit.ranges[0].start.perekId;
			const end = unit.ranges[0].end.perekId;
			if (!span) {
				seferSpanCache.set(unit.seferName, { perekFrom: start, perekTo: end });
			} else {
				span.perekFrom = Math.min(span.perekFrom, start);
				span.perekTo = Math.max(span.perekTo, end);
			}
		}
	}
	const span = seferSpanCache.get(seferName);
	/* istanbul ignore next -- defensive: callers pass only sefer names present in the vendored data */
	if (!span) throw new Error(`aliyah data: unknown sefer "${seferName}"`);
	return span;
}

function canonicalPasukCountFor(perekId: number): number {
	return canonicalPasukCount(perekId);
}

let unitIdByName: Map<string, number> | null = null;

function unitIdForName(name: string, readingId: string): number {
	if (!unitIdByName) {
		unitIdByName = new Map(
			getAllParashaUnits().map((unit) => [unit.heading, unit.unitId]),
		);
	}
	const unitId = unitIdByName.get(name);
	/* istanbul ignore next -- load-time validation: only fires on corrupt vendored data (drift-checked) */
	if (!unitId) {
		throw new Error(
			`aliyah data: ${readingId} references unknown parasha "${name}"`,
		);
	}
	return unitId;
}

function validateScheme(
	reading: SourceReading,
	schemeId: string,
	boundaries: AliyahBoundary[],
): void {
	const first = boundaries[0];
	const last = boundaries[boundaries.length - 1];
	/* istanbul ignore next -- load-time validation: only fires on corrupt vendored data (drift-checked) */
	if (!first || !last) {
		throw new Error(`aliyah data: ${reading.id}/${schemeId} is empty`);
	}
	const regular = boundaries.filter((b) => b.role === "aliyah");
	for (let i = 1; i < regular.length; i++) {
		const prev = regular[i - 1];
		const curr = regular[i];
		/* istanbul ignore next -- load-time validation: only fires on corrupt vendored data (drift-checked) */
		if (curr.ordinal !== prev.ordinal + 1) {
			throw new Error(
				`aliyah data: ${reading.id}/${schemeId} ordinals gap at ${prev.ordinal}→${curr.ordinal}`,
			);
		}
		// Ordered coverage: each regular aliyah starts exactly where the
		// previous ended — next pasuk, or pasuk 1 of the next perek when
		// the previous ended on that perek's last pasuk. Anything else is
		// a hole or an overlap. Maftir intentionally repeats the tail, so
		// it is excluded here.
		const prevEnd = prev.range.end;
		const currStart = curr.range.start;
		const contiguous =
			(currStart.perekId === prevEnd.perekId &&
				currStart.pasuk === prevEnd.pasuk + 1) ||
			(currStart.perekId === prevEnd.perekId + 1 &&
				currStart.pasuk === 1 &&
				prevEnd.pasuk === canonicalPasukCountFor(prevEnd.perekId));
		/* istanbul ignore next -- load-time validation: only fires on corrupt vendored data (drift-checked) */
		if (!contiguous) {
			throw new Error(
				`aliyah data: ${reading.id}/${schemeId} gap or overlap between aliyot ${prev.ordinal} and ${curr.ordinal}`,
			);
		}
	}
}

interface ResolvedAliyot {
	readings: ParashaAliyahReading[];
	byId: Map<string, ParashaAliyahReading>;
	byUnitId: Map<
		number,
		{ standalone?: ParashaAliyahReading; joined: ParashaAliyahReading[] }
	>;
}

let resolvedAliyot: ResolvedAliyot | null = null;

function resolved(): ResolvedAliyot {
	if (resolvedAliyot) return resolvedAliyot;
	const readings: ParashaAliyahReading[] = [];
	const byId = new Map<string, ParashaAliyahReading>();
	const byUnitId = new Map<
		number,
		{ standalone?: ParashaAliyahReading; joined: ParashaAliyahReading[] }
	>();

	for (const reading of source.readings) {
		const unitIds = reading.units.map((name) =>
			unitIdForName(name, reading.id),
		);
		const schemes: Record<string, AliyahBoundary[]> = {};
		for (const [schemeId, aliyot] of Object.entries(reading.schemes)) {
			const boundaries = aliyot.map((a) =>
				resolveReadingAliyah(reading, schemeId, a),
			);
			validateScheme(reading, schemeId, boundaries);
			schemes[schemeId] = boundaries;
		}
		const resolvedReading: ParashaAliyahReading = {
			id: reading.id,
			kind: unitIds.length > 1 ? "joined" : "standalone",
			unitIds,
			unitNames: reading.units,
			seferName: reading.sefer,
			...(reading.applicability
				? { applicability: reading.applicability }
				: {}),
			schemes,
		};
		readings.push(resolvedReading);
		byId.set(resolvedReading.id, resolvedReading);
		for (const unitId of unitIds) {
			const bucket: {
				standalone?: ParashaAliyahReading;
				joined: ParashaAliyahReading[];
			} = byUnitId.get(unitId) ?? { joined: [] };
			if (unitIds.length === 1) bucket.standalone = resolvedReading;
			else bucket.joined.push(resolvedReading);
			byUnitId.set(unitId, bucket);
		}
	}
	resolvedAliyot = { readings, byId, byUnitId };
	return resolvedAliyot;
}

/** The standalone reading context for a parasha unit. */
export function getStandaloneReading(unitId: number): ParashaAliyahReading {
	const found = resolved().byUnitId.get(unitId);
	if (!found?.standalone) {
		throw new Error(`aliyah data: no standalone reading for unit ${unitId}`);
	}
	return found.standalone;
}

/**
 * Joined readings a parasha unit participates in (empty for most). A
 * unit can only be in one join position, so the list has ≤1 entry today;
 * the shape stays a list because the contract allows future variants.
 */
export function getJoinedReadingsForUnit(
	unitId: number,
): ParashaAliyahReading[] {
	return resolved().byUnitId.get(unitId)?.joined ?? [];
}

/** A reading context by id (e.g. "Bereshit", "Vayakhel-Pekudei"). */
export function getParashaReadingById(id: string): ParashaAliyahReading | null {
	return resolved().byId.get(id) ?? null;
}

/**
 * Aliyah boundaries for a reading context + scheme, or null when the
 * reading does not carry that scheme (joined readings have no weekday
 * split — weekdays always read the standalone parasha).
 */
export function getAliyot(
	reading: ParashaAliyahReading,
	schemeId: string = DEFAULT_ALIYAH_SCHEME,
): AliyahBoundary[] | null {
	return reading.schemes[schemeId] ?? null;
}

/**
 * Start-coordinate → boundary labels lookup for marker rendering. Each
 * key is `"{perekId}:{pasuk}"`; multiple labels can share a start
 * (e.g. an aliyah starting where a perek begins is emitted alongside
 * the perek marker by the caller, not merged).
 */
export function aliyahStartMarkers(
	boundaries: AliyahBoundary[],
): Map<string, AliyahBoundary> {
	const map = new Map<string, AliyahBoundary>();
	for (const boundary of boundaries) {
		map.set(
			`${boundary.range.start.perekId}:${boundary.range.start.pasuk}`,
			boundary,
		);
	}
	return map;
}

/** Whether a coordinate falls inside any boundary (containment check). */
export function aliyahContaining(
	boundaries: AliyahBoundary[],
	coordinate: ScriptureCoordinate,
): AliyahBoundary | null {
	return (
		boundaries.find((b) => rangeContainsCoordinate(b.range, coordinate)) ?? null
	);
}

/* ---- Marker layer for the reading renderer ---- */

/**
 * A boundary marker to render at a pasuk's start. `key` identifies the
 * owning `"{readingId}:{schemeId}"` combination so several schemes or
 * contexts can share one text and the control layer swaps visibility
 * without remounting scripture.
 */
export interface AliyahMarker {
	key: string;
	label: string;
	role: AliyahRole;
}

/** One selectable scheme inside a context (שבת / חול). */
export interface UnitAliyahSchemeOption {
	schemeId: string;
	label: string;
}

/** One selectable reading context for a unit page. */
export interface UnitAliyahContextOption {
	contextId: string;
	/** Display label — the standalone "פרשת ויקהל" or joined "ויקהל-פקודי". */
	label: string;
	kind: "standalone" | "joined";
	/** Restricted applicability (e.g. a חוץ לארץ-only join), when any. */
	applicability?: string;
	schemes: UnitAliyahSchemeOption[];
}

/**
 * Everything a unit page needs to render and switch boundary markers:
 * the coord-keyed marker map (all contexts/schemes merged — callers
 * show one `key` at a time), the context/scheme options for the
 * selector, and the default selection key.
 */
export interface UnitAliyahMarkers {
	/** `"{perekId}:{pasuk}"` → marker specs at that boundary start. */
	markers: Record<string, AliyahMarker[]>;
	contexts: UnitAliyahContextOption[];
	defaultKey: string;
}

function contextLabel(reading: ParashaAliyahReading): string {
	return reading.kind === "standalone"
		? `פרשת ${reading.unitNames[0]}`
		: reading.unitNames.join("-");
}

/**
 * Marker layer for a parasha unit page: the standalone context always
 * exists; each joined reading containing the unit adds a joined
 * context. Joined markers are clipped to boundaries starting inside
 * the unit's own ranges — a join's later aliyot begin in the second
 * parasha and can only render on that unit's page. Their labels keep
 * the joined numbering, so nothing is renumbered or mixed.
 */
export function getUnitAliyahMarkers(unitId: number): UnitAliyahMarkers {
	const unitRanges = getParashaUnitById(unitId).ranges;
	const markers: Record<string, AliyahMarker[]> = {};
	const contexts: UnitAliyahContextOption[] = [];

	const addContext = (reading: ParashaAliyahReading, clipToUnit: boolean) => {
		const schemes: UnitAliyahSchemeOption[] = [];
		for (const scheme of ALIYAH_SCHEMES) {
			const boundaries = reading.schemes[scheme.id];
			if (!boundaries) continue;
			schemes.push({ schemeId: scheme.id, label: scheme.label });
			for (const boundary of boundaries) {
				if (
					clipToUnit &&
					!unitRanges.some((range) =>
						rangeContainsCoordinate(range, boundary.range.start),
					)
				) {
					continue;
				}
				const coordKey = `${boundary.range.start.perekId}:${boundary.range.start.pasuk}`;
				const list = markers[coordKey] ?? [];
				markers[coordKey] = list;
				list.push({
					key: `${reading.id}:${scheme.id}`,
					label: boundary.label,
					role: boundary.role,
				});
			}
		}
		contexts.push({
			contextId: reading.id,
			label: reading.applicability
				? `${contextLabel(reading)} (${reading.applicability})`
				: contextLabel(reading),
			kind: reading.kind,
			...(reading.applicability
				? { applicability: reading.applicability }
				: {}),
			schemes,
		});
	};

	const standalone = getStandaloneReading(unitId);
	addContext(standalone, false);
	for (const joined of getJoinedReadingsForUnit(unitId)) {
		addContext(joined, true);
	}
	return { markers, contexts, defaultKey: `${standalone.id}:shabbat` };
}

/**
 * The book view's fixed marker layer — each parasha spread renders its
 * own standalone Shabbat scheme (the book has no context selector), so
 * only that single key's markers serialize.
 */
export function getUnitShabbatAliyahMarkers(
	unitId: number,
): Record<string, AliyahMarker[]> {
	const standalone = getStandaloneReading(unitId);
	/* istanbul ignore next -- defensive: every vendored reading ships the shabbat scheme */
	const boundaries = standalone.schemes[DEFAULT_ALIYAH_SCHEME] ?? [];
	const markers: Record<string, AliyahMarker[]> = {};
	for (const boundary of boundaries) {
		const coordKey = `${boundary.range.start.perekId}:${boundary.range.start.pasuk}`;
		markers[coordKey] = [
			{
				key: `${standalone.id}:${DEFAULT_ALIYAH_SCHEME}`,
				label: boundary.label,
				role: boundary.role,
			},
		];
	}
	return markers;
}
