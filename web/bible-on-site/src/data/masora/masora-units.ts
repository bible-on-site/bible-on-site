import { toLetters } from "gematry";
import type {
	ReadingDivision,
	ReadingUnit,
	ScriptureCoordinate,
} from "@/lib/reading/contract";
import { READING_CONTRACT_VERSION } from "@/lib/reading/contract";
import { rangeContainsCoordinate } from "@/lib/reading/ranges";
import { sefarim } from "../db/sefarim";
import type { Perek, Sefarim, SefarimItem } from "../db/tanah-view-types";
import { getPerekByPerekId } from "../perek-dto";

/**
 * מסורה על הפרק — the Masoretic (פתוחה/סתומה) reading division.
 *
 * Units are derived deterministically from the canonical pesukim
 * corpus: every `ptuha`/`stuma` segment is a boundary marker placed at
 * the break that closes the preceding parasha. The text before a marker
 * belongs to one unit; the text after it begins the next. Markers may
 * sit mid-pasuk, so unit bounds keep a `segmentIndex` for intra-pasuk
 * precision. A sefer's last unit is closed by the sefer end and has no
 * closing break. Derivation never copies or renumbers scripture — it
 * only maps canonical coordinates onto the shared reading-unit
 * contract (READING_CONTRACT_VERSION 1).
 */
export const MASORA_DIVISION: ReadingDivision = {
	id: "masora",
	version: READING_CONTRACT_VERSION,
	rootPath: "/מסורה",
	menuLabel: "מסורה על הפרק",
};

interface PerakimPart {
	perekFrom: number;
	perekTo: number;
	perakim: Perek[];
}

function seferPerakimParts(sefer: SefarimItem): PerakimPart[] {
	return "perakim" in sefer
		? [
				{
					perekFrom: sefer.perekFrom,
					perekTo: sefer.perekTo,
					perakim: sefer.perakim,
				},
			]
		: sefer.additionals.map((additional) => ({
				perekFrom: additional.perekFrom,
				perekTo: additional.perekTo,
				perakim: additional.perakim,
			}));
}

/** Pasuk count of a canonical perek — the resolver's bounds source. */
export function masoraPasukCount(perekId: number): number {
	return getPerekByPerekId(perekId).pesukim.length;
}

function coordinateAfterMarker(
	perekId: number,
	pasukIndex: number,
	markerIndex: number,
	perek: Perek,
	nextPerekId: number | null,
): ScriptureCoordinate {
	const pasuk = perek.pesukim[pasukIndex];
	if (markerIndex + 1 < pasuk.segments.length) {
		return { perekId, pasuk: pasukIndex + 1, segmentIndex: markerIndex + 1 };
	}
	if (pasukIndex + 1 < perek.pesukim.length) {
		return { perekId, pasuk: pasukIndex + 2 };
	}
	// A break at the very end of a perek: the next unit opens the next
	// perek (perakim ids are contiguous across a sefer's additionals).
	if (nextPerekId === null) {
		/* istanbul ignore next -- defensive: corpus data never places a break after a sefer's final pasuk */
		throw new Error(
			`Masora break after final pasuk of sefer (perekId ${perekId})`,
		);
	}
	return { perekId: nextPerekId, pasuk: 1 };
}

function perekRefOf(coordinate: ScriptureCoordinate): string {
	const perek = getPerekByPerekId(coordinate.perekId);
	return `${perek.source} ${toLetters(coordinate.pasuk)}`;
}

/**
 * Display heading for a unit: the scripture reference span.
 * Same-perek units collapse to "שמואל א יב ה-ז"; cross-perek units keep
 * both endpoints ("בראשית לה כב - מ א"). The sefer name prefixes the
 * start ref; the end ref repeats only the perek context.
 */
export function formatMasoraUnitHeading(
	start: ScriptureCoordinate,
	end: ScriptureCoordinate,
): string {
	const startRef = perekRefOf(start);
	const endPerek = getPerekByPerekId(end.perekId);
	if (start.perekId === end.perekId) {
		return start.pasuk === end.pasuk
			? startRef
			: `${startRef}-${toLetters(end.pasuk)}`;
	}
	const endPerekContext = endPerek.additional
		? `${endPerek.additional} ${endPerek.perekHeb}`
		: endPerek.perekHeb;
	return `${startRef} - ${endPerekContext} ${toLetters(end.pasuk)}`;
}

function deriveUnitsFromSefarim(corpus: Sefarim): ReadingUnit[] {
	const units: ReadingUnit[] = [];
	let nextUnitId = 1;
	for (const sefer of corpus) {
		const parts = seferPerakimParts(sefer);
		const seferStart: ScriptureCoordinate = {
			perekId: parts[0].perekFrom,
			pasuk: 1,
		};
		let pendingStart: ScriptureCoordinate | null = null;
		let order = 0;
		const emit = (
			end: ScriptureCoordinate,
			closingBreak: "ptuha" | "stuma" | null,
		) => {
			const start = pendingStart ?? seferStart;
			order += 1;
			units.push({
				division: MASORA_DIVISION.id,
				unitId: nextUnitId,
				slug: String(nextUnitId),
				seferName: sefer.name,
				order,
				heading: formatMasoraUnitHeading(start, end),
				ranges: [{ start, end }],
				closingBreak,
			});
			nextUnitId += 1;
		};
		for (let partIdx = 0; partIdx < parts.length; partIdx++) {
			const part = parts[partIdx];
			for (let pi = 0; pi < part.perakim.length; pi++) {
				const perekId = part.perekFrom + pi;
				const perek = part.perakim[pi];
				// The perek after this one, within the same sefer (contiguous).
				const isLastPerekOfPart = pi === part.perakim.length - 1;
				const isLastPart = partIdx === parts.length - 1;
				const nextPerekId = isLastPerekOfPart
					? isLastPart
						? null
						: parts[partIdx + 1].perekFrom
					: perekId + 1;
				for (let vi = 0; vi < perek.pesukim.length; vi++) {
					const segments = perek.pesukim[vi].segments;
					for (let si = 0; si < segments.length; si++) {
						const type = segments[si].type;
						if (type !== "ptuha" && type !== "stuma") continue;
						emit({ perekId, pasuk: vi + 1, segmentIndex: si }, type);
						pendingStart = coordinateAfterMarker(
							perekId,
							vi,
							si,
							perek,
							nextPerekId,
						);
					}
				}
			}
		}
		const lastPart = parts[parts.length - 1];
		const lastPerek = lastPart.perakim[lastPart.perakim.length - 1];
		emit({ perekId: lastPart.perekTo, pasuk: lastPerek.pesukim.length }, null);
	}
	return units;
}

let allUnits: ReadingUnit[] | null = null;

/** All Masoretic units in canonical order (memoized over the corpus). */
export function getAllMasoraUnits(): ReadingUnit[] {
	if (!allUnits) allUnits = deriveUnitsFromSefarim(sefarim);
	return allUnits;
}

export function getMasoraUnitCount(): number {
	return getAllMasoraUnits().length;
}

/** Looks a unit up by its stable unitId; throws for out-of-range ids. */
export function getMasoraUnitById(unitId: number): ReadingUnit {
	const units = getAllMasoraUnits();
	const unit = units[unitId - 1];
	if (!unit || unit.unitId !== unitId) {
		throw new Error(`Invalid masora unitId: ${unitId}`);
	}
	return unit;
}

/** Units of one sefer, in order. */
export function getMasoraUnitsForSefer(seferName: string): ReadingUnit[] {
	return getAllMasoraUnits().filter((unit) => unit.seferName === seferName);
}

/** First unit of each sefer — used by the root landing and sefer browsing. */
export function getMasoraFirstUnitBySefer(): ReadingUnit[] {
	const first: ReadingUnit[] = [];
	for (const unit of getAllMasoraUnits()) {
		if (unit.order === 1) first.push(unit);
	}
	return first;
}

/**
 * Resolves a canonical position to the Masoretic unit containing it —
 * the contract's canonical-position -> containing-unit direction.
 * Segment-aware: a position exactly on a break marker belongs to the
 * unit that marker closes; a bare pasuk position resolves to the unit
 * where the pasuk begins (see rangeContainsCoordinate).
 */
export function getMasoraUnitContaining(
	coordinate: ScriptureCoordinate,
): ReadingUnit | null {
	for (const unit of getAllMasoraUnits()) {
		if (
			unit.ranges.some((range) => rangeContainsCoordinate(range, coordinate))
		) {
			return unit;
		}
	}
	return null;
}

/** Previous/next units in canonical order (null at the corpus edges). */
export function getAdjacentMasoraUnits(unitId: number): {
	prev: ReadingUnit | null;
	next: ReadingUnit | null;
} {
	const units = getAllMasoraUnits();
	return {
		prev: unitId > 1 ? units[unitId - 2] : null,
		next: unitId < units.length ? units[unitId] : null,
	};
}
