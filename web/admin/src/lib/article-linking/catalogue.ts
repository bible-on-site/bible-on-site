/**
 * The constrained target catalogue (#3103): the bounded, searchable set of
 * valid relationship targets the pipeline grounds proposals in — perakim
 * (with their canonical labels and pasuk bounds), authors and dedications.
 * Built once per generation run from the authorized DB reads; the model
 * never receives raw tables or unbounded database access.
 */
import { toHebrewLetters } from "~/utils/hebrew";

export interface CataloguePerek {
	id: number;
	/** Canonical sefer name (e.g. "בראשית", "שמואל"). */
	seferName: string;
	/** Additional letter for split sefarim (שמואל א/ב, עזרא ע/נ), else null. */
	additionalLetter: string | null;
	/** 1-based perek number inside its sefer/additional context. */
	perekInContext: number;
	/** Canonical pasuk bound; null = corpus counts never loaded. */
	pasukCount: number | null;
}

export interface CatalogueAuthor {
	id: number;
	name: string;
}

export interface CatalogueDedication {
	id: number;
	subject: string;
}

export interface TargetCatalogue {
	perakim: CataloguePerek[];
	authors: CatalogueAuthor[];
	dedications: CatalogueDedication[];
}

/**
 * A scripture reference as the model/heuristic names it — the sefer name and
 * Hebrew numbers, resolved to canonical ids server-side. `additional` is the
 * sefer's letter (שמואל א/ב, עזרא ע/נ); `perek`/`pasuk` are parsed numbers.
 */
export interface PerekRef {
	sefer: string;
	additional: string | null;
	perek: number;
	pasuk: number | null;
}

export type PerekResolution =
	| { kind: "resolved"; perek: CataloguePerek }
	| { kind: "not-found" }
	| { kind: "ambiguous"; candidates: CataloguePerek[] };

/** Normalizes name matching the same way the API target search does. */
export function normalizeHebrewName(value: string): string {
	return value
		.replace(/["'׳״]/g, "")
		.split(/\s+/)
		.filter(Boolean)
		.join(" ")
		.trim();
}

/**
 * Well-known citation aliases: names articles use that are not the canonical
 * sefer name. Each maps to {sefer, additional}; when `additional` is null the
 * citation must still carry its own letter or resolve unambiguously.
 */
export const SEFER_ALIASES: Record<
	string,
	{ sefer: string; additional: string | null }
> = {
	תהלים: { sefer: "תהילים", additional: null },
	מזמור: { sefer: "תהילים", additional: null },
	נחמיה: { sefer: "עזרא", additional: "נ" },
	עזרא: { sefer: "עזרא", additional: "ע" },
	"שה״ש": { sefer: "שיר השירים", additional: null },
	שהש: { sefer: "שיר השירים", additional: null },
	"דה״ה": { sefer: "דברי הימים", additional: null },
	דהה: { sefer: "דברי הימים", additional: null },
};

/** Resolves a cited sefer+additional+perek to a canonical perek row. */
export function resolvePerekRef(
	catalogue: TargetCatalogue,
	ref: PerekRef,
): PerekResolution {
	const alias = SEFER_ALIASES[normalizeHebrewName(ref.sefer)];
	const seferName = normalizeHebrewName(alias?.sefer ?? ref.sefer);
	// An explicit letter in the citation wins; else the alias's implied one.
	const additional =
		ref.additional ?? (alias?.sefer === seferName ? alias.additional : null);

	const inSefer = catalogue.perakim.filter(
		(p) => normalizeHebrewName(p.seferName) === seferName,
	);
	if (inSefer.length === 0) return { kind: "not-found" };

	const hasAdditionals = inSefer.some((p) => p.additionalLetter !== null);
	let candidates = inSefer;
	if (additional !== null) {
		candidates = inSefer.filter((p) => p.additionalLetter === additional);
	} else if (hasAdditionals) {
		// "שמואל ה" without א/ב never resolves — two equally-valid targets.
		return { kind: "ambiguous", candidates: inSefer };
	}

	candidates = candidates.filter((p) => p.perekInContext === ref.perek);
	if (candidates.length === 0) return { kind: "not-found" };
	if (candidates.length > 1) return { kind: "ambiguous", candidates };
	return { kind: "resolved", perek: candidates[0] };
}

/** The catalogue picker label, e.g. "בראשית א" or "שמואל ב ה". */
export function cataloguePerekLabel(perek: CataloguePerek): string {
	const inner = toHebrewLetters(perek.perekInContext);
	const label = perek.additionalLetter
		? `${perek.additionalLetter} ${inner}`
		: inner;
	return `${perek.seferName} ${label}`;
}

/** The review-facing pasuk label, e.g. "בראשית א ג". */
export function cataloguePasukLabel(
	perek: CataloguePerek,
	pasuk: number,
): string {
	return `${cataloguePerekLabel(perek)} ${toHebrewLetters(pasuk)}`;
}

/** Validates a pasuk against the canonical bound when it is known. */
export function pasukWithinBounds(
	perek: CataloguePerek,
	pasuk: number,
): boolean {
	return (
		Number.isInteger(pasuk) &&
		pasuk >= 1 &&
		(perek.pasukCount === null || pasuk <= perek.pasukCount)
	);
}
