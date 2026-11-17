import { toHebrewLetters } from "~/utils/hebrew";
import {
	type CataloguePerek,
	cataloguePerekLabel,
	normalizeHebrewName,
	pasukWithinBounds,
	resolvePerekRef,
	SEFER_ALIASES,
} from "./catalogue";
import { parseHebrewNumber } from "./hebrew-numerals";

const normalized = (value: string) =>
	normalizeHebrewName(
		value
			.normalize("NFD")
			.replace(/\p{M}/gu, "")
			.replace(/[,:.]/g, " ")
			.replace(/[־–]/g, "-"),
	).toLowerCase();

function numeral(value: string): number | null {
	if (/^[1-9][0-9]*$/.test(value)) {
		const number = Number(value);
		return Number.isSafeInteger(number) && number <= 1500 ? number : null;
	}
	const number = parseHebrewNumber(value);
	return number !== null &&
		(toHebrewLetters(number) === value || value === "יה" || value === "יו")
		? number
		: null;
}

/** Exact references use the shared catalogue resolver, never a numeric prefix match. */
export function searchCataloguePerakim(
	perakim: CataloguePerek[],
	query: string,
): CataloguePerek[] {
	const text = normalized(query);
	const names = [
		...new Set(
			[...perakim.map((p) => p.seferName), ...Object.keys(SEFER_ALIASES)].map(
				normalized,
			),
		),
	].sort((a, b) => b.length - a.length);
	const book = names.find(
		(name) => text === name || text.startsWith(`${name} `),
	);
	let matches: CataloguePerek[];
	if (book) {
		const alias = SEFER_ALIASES[book];
		const canonical = alias?.sefer ?? book;
		const inBook = perakim.filter(
			(p) => normalized(p.seferName) === normalized(canonical),
		);
		const tokens = text.slice(book.length).trim().split(" ").filter(Boolean);
		const letters = new Set(
			inBook.map((p) => p.additionalLetter).filter(Boolean),
		);
		const additional = letters.has(tokens[0])
			? (tokens.shift() ?? null)
			: (alias?.additional ?? null);
		const chapterKeyword = tokens[0] === "פרק";
		if (chapterKeyword) tokens.shift();
		if (tokens.length === 0)
			matches = chapterKeyword
				? []
				: inBook.filter(
						(p) => additional === null || p.additionalLetter === additional,
					);
		else {
			const chapter = numeral(tokens.shift() ?? "");
			const verseKeyword = tokens[0] === "פסוק" || tokens[0] === "פסוקים";
			if (verseKeyword) tokens.shift();
			const verse = tokens.length === 1 ? tokens[0].split("-") : [];
			const from = verse.length > 0 ? numeral(verse[0]) : null;
			const to = verse.length === 2 ? numeral(verse[1]) : from;
			const validVerse =
				(tokens.length === 0 && !verseKeyword) ||
				(tokens.length === 1 &&
					verse.length <= 2 &&
					from !== null &&
					to !== null &&
					to >= from);
			if (chapter === null || !validVerse) matches = [];
			else {
				const result = resolvePerekRef(
					{ perakim, authors: [], dedications: [] },
					{ sefer: book, additional, perek: chapter, pasuk: from },
				);
				matches = (
					result.kind === "resolved"
						? [result.perek]
						: result.kind === "ambiguous"
							? result.candidates
							: []
				).filter(
					(p) =>
						p.perekInContext === chapter &&
						(from === null ||
							(to !== null &&
								pasukWithinBounds(p, from) &&
								pasukWithinBounds(p, to))),
				);
			}
		}
	} else {
		// Free-text, numeric IDs and old Arabic labels retain the catalogue's paged substring search.
		matches = perakim.filter((p) => {
			const aliases = Object.entries(SEFER_ALIASES)
				.filter(
					([, alias]) =>
						normalized(alias.sefer) === normalized(p.seferName) &&
						(alias.additional === null ||
							alias.additional === p.additionalLetter),
				)
				.flatMap(([name]) => [
					`${name} ${p.perekInContext}`,
					`${name} ${toHebrewLetters(p.perekInContext)}`,
				]);
			return [
				String(p.id),
				cataloguePerekLabel(p),
				`${p.seferName} ${p.perekInContext}`,
				...aliases,
			].some((value) => normalized(value).includes(text));
		});
	}
	return [...matches].sort(
		(a, b) =>
			`${a.seferName} ${a.perekInContext}`.localeCompare(
				`${b.seferName} ${b.perekInContext}`,
				"he",
			) || a.id - b.id,
	);
}
