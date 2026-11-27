import {
	MAX_PLACE_OCCURRENCES,
	type PlaceProfileInput,
	type PlaceWordOccurrence,
	placeOccurrenceKey,
	type ScriptureOccurrencePage,
	validatePlaceProfile,
} from "~/lib/tanahpedia/contribution-place-profile";
import {
	type ChangeInput,
	type Contribution,
	type IssueScope,
	type ReviewedChange,
	record,
	rejectUnknown,
} from "~/lib/tanahpedia/contributions";
import type { ModelCatalogue } from "./contribution-llm.server";

const object = (
	properties: Record<string, unknown>,
	required = Object.keys(properties),
) => ({
	type: "object",
	additionalProperties: false,
	properties,
	required,
});

const text = (maxLength = 255) => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum: number) => ({ type: "integer", minimum });
const occurrence = object({
	perekId: integer(1),
	pasukNumber: integer(1),
	segmentStart: integer(0),
	segmentEnd: integer(0),
	text: text(500),
});
const nullValue = { type: "null" };
const entry = object({
	title: text(),
	uniqueName: text(),
	displayName: text(),
});
const identification = {
	anyOf: [
		nullValue,
		object({
			modernName: text(),
			latitude: { type: "number", minimum: -90, maximum: 90 },
			longitude: { type: "number", minimum: -180, maximum: 180 },
			basis: { enum: ["consensus", "commentary"] },
			citation: text(500),
			coordinateCitation: text(500),
		}),
	],
};

export function agentPlaceProfileVariants(
	catalogue: ModelCatalogue,
	scope: IssueScope | undefined,
	preservedChanges: readonly ReviewedChange[],
): Record<string, unknown>[] | null {
	const current = preservedChanges.find(
		(change) => change.kind === "place_profile",
	);
	if (!current && scope?.kind !== "place_profile") return null;
	const explicit = {
		type: "array",
		maxItems: MAX_PLACE_OCCURRENCES,
		items: occurrence,
	};
	const occurrences = catalogue.scriptureOccurrencePages?.length
		? {
				anyOf: [
					explicit,
					object(
						{
							spellings: {
								type: "array",
								minItems: 1,
								maxItems: 16,
								items: text(160),
							},
							selected: {
								type: "array",
								minItems: 1,
								maxItems: MAX_PLACE_OCCURRENCES,
								items: object({ from: integer(0), to: integer(0) }),
							},
							book: text(),
							...(current ? { includeExisting: { type: "boolean" } } : {}),
						},
						["spellings", "selected"],
					),
				],
			}
		: explicit;
	const profile = (entryType: object, targetIds?: string[]) =>
		object({
			kind: { const: "place_profile" },
			...(targetIds ? { targetId: { enum: targetIds } } : {}),
			after: object({ entry: entryType, occurrences, identification }),
		});
	if (current) {
		return [
			profile(current.after?.entry ? entry : nullValue, [current.targetId]),
		];
	}
	const ids = catalogue.places.map(({ id }) => id);
	return [profile(entry), ...(ids.length ? [profile(nullValue, ids)] : [])];
}

function expandSelection(
	selection: Record<string, unknown>,
	pages: readonly ScriptureOccurrencePage[],
): PlaceWordOccurrence[] {
	const { spellings, selected, book } = selection;
	if (
		!Array.isArray(spellings) ||
		(book !== undefined && typeof book !== "string") ||
		!Array.isArray(selected) ||
		selected.length === 0 ||
		selected.length > MAX_PLACE_OCCURRENCES
	)
		throw new Error("Select only Scripture occurrence ranges that were read");
	const query = JSON.stringify(spellings);
	const indexed = new Map<number, PlaceWordOccurrence>();
	let total: number | undefined;
	for (const page of pages) {
		if (page.book !== book || JSON.stringify(page.spellings) !== query)
			continue;
		total ??= page.total;
		if (total !== page.total || page.cursor + page.items.length > total)
			throw new Error("Scripture occurrence pages disagree on the result size");
		for (const [offset, item] of page.items.entries()) {
			const { perekId, pasukNumber, segmentStart, segmentEnd, text } = item;
			const ordinal = page.cursor + offset;
			const previous = indexed.get(ordinal);
			if (
				previous &&
				(placeOccurrenceKey(previous) !== placeOccurrenceKey(item) ||
					previous.text !== text)
			)
				throw new Error(
					"Scripture occurrence pages disagree on the same candidate",
				);
			indexed.set(ordinal, {
				perekId,
				pasukNumber,
				segmentStart,
				segmentEnd,
				text,
			});
		}
	}
	const result: PlaceWordOccurrence[] = [];
	const seen = new Set<number>();
	for (const value of selected) {
		const range = record(value, "Scripture candidate range");
		rejectUnknown(range, ["from", "to"]);
		const { from, to } = range;
		if (
			typeof from !== "number" ||
			!Number.isSafeInteger(from) ||
			from < 0 ||
			typeof to !== "number" ||
			!Number.isSafeInteger(to) ||
			to < from ||
			result.length + to - from + 1 > MAX_PLACE_OCCURRENCES
		)
			throw new Error("Invalid Scripture candidate range");
		for (let ordinal = from; ordinal <= to; ordinal++) {
			const item = indexed.get(ordinal);
			if (!item || seen.has(ordinal))
				throw new Error(
					"Select each previously read Scripture occurrence only once",
				);
			seen.add(ordinal);
			result.push(item);
		}
	}
	return result;
}

function appendPlaceOccurrences(
	existing: readonly PlaceWordOccurrence[],
	selected: readonly PlaceWordOccurrence[],
): PlaceWordOccurrence[] {
	const combined = new Map(
		existing.map((word) => [placeOccurrenceKey(word), word]),
	);
	for (const word of selected) {
		const key = placeOccurrenceKey(word);
		const previous = combined.get(key);
		if (previous && previous.text !== word.text)
			throw new Error(
				"A selected occurrence disagrees with the existing word span",
			);
		if (!previous) combined.set(key, word);
	}
	if (combined.size > MAX_PLACE_OCCURRENCES)
		throw new Error(
			`A place proposal supports at most ${MAX_PLACE_OCCURRENCES} exact word occurrences`,
		);
	return [...combined.values()];
}

export function materializeAgentPlaceChanges(
	raw: unknown,
	item: Contribution,
	catalogue: ModelCatalogue,
) {
	if (!Array.isArray(raw)) return raw;
	const containsPlace = raw.some(
		(value) => record(value).kind === "place_profile",
	);
	const current =
		item.kind === "pr"
			? item.changes.find((change) => change.kind === "place_profile")
			: null;
	const placeContext =
		current || (item.kind === "issue" && item.scope?.kind === "place_profile");
	if (!containsPlace && !placeContext) return raw;
	if (!containsPlace || !placeContext || raw.length !== 1)
		throw new Error(
			"An agent place proposal requires a place issue and one place per PR",
		);
	const change = record(raw[0]);
	const after = record(change.after, "agent place profile");
	if (!current && change.targetId && after.entry)
		throw new Error("An existing place profile cannot create an entry");
	if (
		current &&
		(change.targetId !== current.targetId ||
			Boolean(after.entry) !== Boolean(current.after?.entry))
	)
		throw new Error(
			"A revised place proposal must preserve its place identity",
		);
	if (Array.isArray(after.occurrences)) return raw;
	const selection = record(after.occurrences, "place occurrence selection");
	rejectUnknown(selection, [
		"spellings",
		"selected",
		"book",
		"includeExisting",
	]);
	const { includeExisting } = selection;
	if (includeExisting !== undefined && typeof includeExisting !== "boolean")
		throw new Error("includeExisting must be a boolean");
	if (includeExisting && !current?.after)
		throw new Error(
			"Only a revision of the same place PR may include existing occurrences",
		);
	const selected = expandSelection(
		selection,
		catalogue.scriptureOccurrencePages ?? [],
	);
	let occurrences = selected;
	if (includeExisting && current?.after) {
		const previous = validatePlaceProfile({ ...current }, true).after;
		if (
			previous.entry &&
			record(after.entry, "place entry").uniqueName !==
				previous.entry.uniqueName
		)
			throw new Error(
				"An occurrence append must preserve the place entry identity",
			);
		occurrences = appendPlaceOccurrences(previous.occurrences, selected);
	}
	return [
		{
			...change,
			after: {
				...after,
				occurrences,
			},
		},
	];
}

export function assertAgentPlaceReferences(
	change: PlaceProfileInput,
	catalogue: ModelCatalogue,
	preservedChanges: readonly ReviewedChange[],
) {
	const current = preservedChanges.find(
		(item) =>
			item.kind === "place_profile" && item.targetId === change.targetId,
	);
	if (
		change.targetId &&
		!current &&
		!catalogue.places.some(({ id }) => id === change.targetId)
	)
		throw new Error("The model referenced a place it did not read");
	const anchors = new Map<string, string>();
	const add = (occurrence: PlaceWordOccurrence) =>
		anchors.set(placeOccurrenceKey(occurrence), occurrence.text);
	for (const page of catalogue.scriptureOccurrencePages ?? [])
		for (const occurrence of page.items) add(occurrence);
	if (current?.after)
		for (const occurrence of validatePlaceProfile({ ...current }, true).after
			.occurrences)
			add(occurrence);
	for (const occurrence of change.after.occurrences)
		if (anchors.get(placeOccurrenceKey(occurrence)) !== occurrence.text)
			throw new Error(
				"The model referenced a Scripture occurrence it did not read",
			);
}

export function assertAgentPlaceEvidence(
	changes: readonly (ChangeInput | ReviewedChange)[],
	evidence: Contribution["evidence"],
) {
	const citations = new Set(evidence.map((source) => source.citation));
	for (const change of changes) {
		if (change.kind !== "place_profile" || !change.after?.identification)
			continue;
		const { citation, coordinateCitation } = record(
			change.after.identification,
		);
		if (
			typeof citation !== "string" ||
			!citations.has(citation) ||
			typeof coordinateCitation !== "string" ||
			!citations.has(coordinateCitation)
		)
			throw new Error(
				"Select the evidence for both the place identification and its coordinates",
			);
	}
}
