import type {
	AuxiliaryReading,
	ReadingDivision,
	ReadingUnit,
	ScriptureCoordinate,
	ScriptureRange,
} from "@/lib/reading/contract";
import { READING_CONTRACT_VERSION } from "@/lib/reading/contract";
import { formatCoordinateSpan } from "@/lib/reading/format";
import {
	compareCoordinates,
	rangeContainsCoordinate,
} from "@/lib/reading/ranges";
import { sefarim } from "../db/sefarim";
import { getPerekByPerekId } from "../perek-dto";
import divisionData from "./parasha-division.json";
import { buildParashaSlugIndex } from "./parasha-slugs";

/**
 * פרשה על הפרק — the synagogue Torah parasha reading division.
 *
 * Units are the weekly parashiot of the five Torah sefarim, in order.
 * Each unit keeps its own identity (name, sefer, order, inclusive
 * canonical range) — joined readings (ויקהל-פקודי and friends) are
 * represented by the same individual units read together, never by
 * merged identities. Every parasha carries ordered auxiliary Haftarah
 * readings per custom (ספרדים/אשכנזים/תימנים): multi-range lists that
 * preserve chapter/book jumps and intentional repeated verses exactly
 * as the source table distinguishes them.
 *
 * The source table (parasha-division.json) follows לוח יעקב מתלון —
 * ארץ ישראל practice — and is shared verbatim with the SQLite export
 * pipeline so website and native-app data stay in parity. All
 * references resolve to canonical perekId/pasuk coordinates and are
 * validated against the pesukim corpus at module load; impossible
 * endpoints fail the build instead of silently importing bad data.
 * Special-Shabbat/festival readings live in the `occasions` list —
 * they are never applied to a static parasha page by date; the table
 * is reference data, not a calendar algorithm.
 */

export const PARASHA_DIVISION: ReadingDivision = {
	id: "parasha",
	version: READING_CONTRACT_VERSION,
	rootPath: divisionData.rootPath,
	menuLabel: divisionData.menuLabel,
};

/** Custom identifiers used by the source table. */
export type ParashaCustom = "sefaradi" | "ashkenazi" | "temani";

interface SourceVerse {
	perek: number;
	pasuk: number;
}

interface SourceRange {
	sefer: string;
	additional?: string;
	start: SourceVerse;
	end: SourceVerse;
}

interface SourceHaftara {
	customs: ParashaCustom[];
	ranges: SourceRange[];
	note?: string;
}

interface SourceParasha {
	name: string;
	/** Canonical public slug — plain unpointed Hebrew, ASCII hyphens (issue #2738). */
	slug: string;
	/** Researched lexical variants (nameAudit documents provenance). */
	aliases?: string[];
	sefer: string;
	start: SourceVerse;
	end: SourceVerse;
	haftarot: SourceHaftara[];
	notes?: string[];
}

interface SourceOccasion {
	name: string;
	haftarot: SourceHaftara[];
	notes?: string[];
}

interface SourceDivision {
	id: string;
	version: number;
	rootPath: string;
	menuLabel: string;
	description: string;
	source: string;
	sources: string[];
	customs: Record<ParashaCustom, string>;
	customDefaultNote: string;
	joinedReadings: { pairs: [string, string][]; note: string };
	generalNotes: string[];
	units: SourceParasha[];
	occasions: SourceOccasion[];
}

const source = divisionData as unknown as SourceDivision;

/** A Haftarah resolved to canonical coordinates, with its source note. */
export interface ParashaHaftara extends AuxiliaryReading {
	customs: ParashaCustom[];
	/** Source-table note about this variant (e.g. וי"א alternatives). */
	note?: string;
}

/** A parasha source entry resolved alongside its unit. */
export interface ParashaEntry {
	name: string;
	haftarot: ParashaHaftara[];
	notes: string[];
}

/** A special-Shabbat/festival reading set from the source table. */
export interface ParashaOccasion {
	name: string;
	haftarot: ParashaHaftara[];
	notes: string[];
}

export const PARASHA_CUSTOM_LABELS: Record<ParashaCustom, string> =
	source.customs;
export const PARASHA_SOURCE_ATTRIBUTION: string = source.source;
export const PARASHA_SOURCE_LIST: string[] = source.sources;
export const PARASHA_JOINED_PAIRS: [string, string][] =
	source.joinedReadings.pairs;
export const PARASHA_JOINED_NOTE: string = source.joinedReadings.note;
export const PARASHA_GENERAL_NOTES: string[] = source.generalNotes;
export const PARASHA_CUSTOM_DEFAULT_NOTE: string = source.customDefaultNote;

function seferPartPerekFrom(
	seferName: string,
	additional: string | undefined,
): { perekFrom: number; perekTo: number } {
	const sefer = sefarim.find((s) => s.name === seferName);
	if (!sefer) {
		throw new Error(`parasha data: unknown sefer "${seferName}"`);
	}
	if (additional === undefined) {
		if ("additionals" in sefer) {
			throw new Error(
				`parasha data: "${seferName}" is split into additionals; "additional" is required`,
			);
		}
		return { perekFrom: sefer.perekFrom, perekTo: sefer.perekTo };
	}
	if (!("additionals" in sefer)) {
		throw new Error(
			`parasha data: "${seferName}" has no additional "${additional}"`,
		);
	}
	const part = sefer.additionals.find((a) => a.letter === additional);
	if (!part) {
		throw new Error(
			`parasha data: "${seferName}" has no additional "${additional}"`,
		);
	}
	return { perekFrom: part.perekFrom, perekTo: part.perekTo };
}

function resolveVerse(
	ref: SourceVerse,
	range: SourceRange,
): ScriptureCoordinate {
	const { perekFrom, perekTo } = seferPartPerekFrom(
		range.sefer,
		range.additional,
	);
	const perekId = perekFrom + ref.perek - 1;
	const display = `${range.sefer}${range.additional ? ` ${range.additional}` : ""} ${ref.perek}`;
	if (perekId > perekTo) {
		throw new Error(
			`parasha data: ${display} exceeds ${range.sefer}'s perek count`,
		);
	}
	const pasukCount = getPerekByPerekId(perekId).pesukim.length;
	if (ref.pasuk < 1 || ref.pasuk > pasukCount) {
		throw new Error(
			`parasha data: ${display}:${ref.pasuk} is outside the canonical ${pasukCount} pesukim`,
		);
	}
	return { perekId, pasuk: ref.pasuk };
}

function resolveRange(range: SourceRange): ScriptureRange {
	const resolved: ScriptureRange = {
		start: resolveVerse(range.start, range),
		end: resolveVerse(range.end, range),
	};
	if (compareCoordinates(resolved.start, resolved.end, "end") > 0) {
		throw new Error(
			`parasha data: backwards range in ${range.sefer} ${range.start.perek}:${range.start.pasuk} - ${range.end.perek}:${range.end.pasuk}`,
		);
	}
	return resolved;
}

function haftaraId(customs: ParashaCustom[]): string {
	return `haftara-${customs.join("-")}`;
}

function haftaraLabel(customs: ParashaCustom[]): string {
	const labels = customs.map((custom) => PARASHA_CUSTOM_LABELS[custom]);
	if (labels.length <= 1) return labels[0] ?? "";
	if (labels.length === 2) return `${labels[0]} ו${labels[1]}`;
	return `${labels.slice(0, -1).join(", ")} ו${labels[labels.length - 1]}`;
}

function resolveHaftara(haftara: SourceHaftara): ParashaHaftara {
	return {
		id: haftaraId(haftara.customs),
		label: haftaraLabel(haftara.customs),
		customs: [...haftara.customs],
		ranges: haftara.ranges.map(resolveRange),
		...(haftara.note ? { note: haftara.note } : {}),
	};
}

interface ResolvedDivision {
	units: ReadingUnit[];
	entries: ParashaEntry[];
	occasions: ParashaOccasion[];
}

function deriveUnits(): ResolvedDivision {
	const units: ReadingUnit[] = [];
	const entries: ParashaEntry[] = [];
	const orderBySefer = new Map<string, number>();
	// Rebuild the slug index here too — validates every unit's canonical
	// slug/aliases against its name and fails the import on collisions,
	// so a bad shared-table edit can never reach the readers.
	buildParashaSlugIndex(source.units);
	source.units.forEach((parasha, index) => {
		const order = (orderBySefer.get(parasha.sefer) ?? 0) + 1;
		orderBySefer.set(parasha.sefer, order);
		const haftarot = parasha.haftarot.map(resolveHaftara);
		const range = resolveRange({
			sefer: parasha.sefer,
			start: parasha.start,
			end: parasha.end,
		});
		units.push({
			division: PARASHA_DIVISION.id,
			unitId: index + 1,
			// The canonical Hebrew-name slug the shared table carries;
			// parasha-slugs.ts validates it against the unit name at load.
			slug: parasha.slug,
			seferName: parasha.sefer,
			order,
			heading: parasha.name,
			ranges: [range],
			auxiliaryReadings: haftarot.map(
				({ customs: _customs, note: _note, ...aux }) => aux,
			),
		});
		entries.push({
			name: parasha.name,
			haftarot,
			notes: parasha.notes ?? [],
		});
	});
	return {
		units,
		entries,
		occasions: source.occasions.map((occasion) => ({
			name: occasion.name,
			haftarot: occasion.haftarot.map(resolveHaftara),
			notes: occasion.notes ?? [],
		})),
	};
}

let resolved: ResolvedDivision | null = null;

function resolvedDivision(): ResolvedDivision {
	if (!resolved) resolved = deriveUnits();
	return resolved;
}

/** All parasha units in canonical order (memoized). */
export function getAllParashaUnits(): ReadingUnit[] {
	return resolvedDivision().units;
}

export function getParashaUnitCount(): number {
	return getAllParashaUnits().length;
}

/** Looks a unit up by its stable unitId; throws for out-of-range ids. */
export function getParashaUnitById(unitId: number): ReadingUnit {
	const unit = getAllParashaUnits()[unitId - 1];
	if (!unit || unit.unitId !== unitId) {
		throw new Error(`Invalid parasha unitId: ${unitId}`);
	}
	return unit;
}

/**
 * The source entry for a unit id — Haftarah customs with notes and the
 * parasha-level notes, beyond the contract-pure ReadingUnit shape.
 */
export function getParashaEntry(unitId: number): ParashaEntry {
	getParashaUnitById(unitId);
	return resolvedDivision().entries[unitId - 1];
}

/** Special-Shabbat/festival Haftarah readings from the source table. */
export function getParashaOccasions(): ParashaOccasion[] {
	return resolvedDivision().occasions;
}

/** Units of one sefer, in order. */
export function getParashaUnitsForSefer(seferName: string): ReadingUnit[] {
	return getAllParashaUnits().filter((unit) => unit.seferName === seferName);
}

/** First unit of each sefer — used by the root landing and sefer browsing. */
export function getParashaFirstUnitBySefer(): ReadingUnit[] {
	const first: ReadingUnit[] = [];
	for (const unit of getAllParashaUnits()) {
		if (unit.order === 1) first.push(unit);
	}
	return first;
}

/**
 * Resolves a canonical position to the parasha containing it — the
 * contract's canonical-position -> containing-unit direction.
 */
export function getParashaUnitContaining(
	coordinate: ScriptureCoordinate,
): ReadingUnit | null {
	for (const unit of getAllParashaUnits()) {
		if (
			unit.ranges.some((range) => rangeContainsCoordinate(range, coordinate))
		) {
			return unit;
		}
	}
	return null;
}

/** Previous/next units in canonical order (null at the Torah edges). */
export function getAdjacentParashaUnits(unitId: number): {
	prev: ReadingUnit | null;
	next: ReadingUnit | null;
} {
	const units = getAllParashaUnits();
	return {
		prev: unitId > 1 ? units[unitId - 2] : null,
		next: unitId < units.length ? units[unitId] : null,
	};
}

/** Scripture reference span for a parasha's primary range ("בראשית א א - ו ח"). */
export function parashaRefSpan(unit: ReadingUnit): string {
	return formatCoordinateSpan(unit.ranges[0].start, unit.ranges[0].end);
}

/** Scripture reference spans for an ordered range list (Haftarah display). */
export function rangesRefSpans(ranges: ScriptureRange[]): string[] {
	return ranges.map((range) => formatCoordinateSpan(range.start, range.end));
}

/** Every auxiliary-range union of a unit — Haftarah perushim/articles scope. */
export function parashaAuxiliaryRanges(unit: ReadingUnit): ScriptureRange[] {
	return (unit.auxiliaryReadings ?? []).flatMap((aux) => aux.ranges);
}
