import { contributionRecordId } from "./contribution-identifiers";
import { record, rejectUnknown, textField } from "./contributions";

export const MAX_PLACE_OCCURRENCES = 1600;

export interface PlaceWordOccurrence {
	perekId: number;
	pasukNumber: number;
	segmentStart: number;
	segmentEnd: number;
	text: string;
}

export interface ScriptureOccurrencePage {
	spellings: string[];
	book?: string;
	cursor: number;
	total: number;
	items: PlaceWordOccurrence[];
}

export interface PlaceProfileChange {
	entry: { title: string; uniqueName: string; displayName: string } | null;
	occurrences: PlaceWordOccurrence[];
	identification: {
		modernName: string;
		latitude: number;
		longitude: number;
		basis: "consensus" | "commentary";
		citation: string;
		coordinateCitation: string;
	} | null;
}

export interface PlaceProfileBase {
	entryAddresses: string[];
	occurrences: PlaceWordOccurrence[];
	identification: { id: string; citations: string[] } | null;
}

export type PlaceProfileInput = {
	kind: "place_profile";
	targetId?: string;
	after: PlaceProfileChange;
};

export function placeOccurrenceKey(
	occurrence: Omit<PlaceWordOccurrence, "text">,
) {
	return [
		occurrence.perekId,
		occurrence.pasukNumber,
		occurrence.segmentStart,
		occurrence.segmentEnd,
	].join(":");
}

function boundedInteger(value: unknown, field: string, minimum: number) {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum
	)
		throw new Error(`Invalid place occurrence ${field}`);
	return value;
}

function readOccurrence(value: unknown): PlaceWordOccurrence {
	const raw = record(value, "place occurrence");
	rejectUnknown(raw, [
		"perekId",
		"pasukNumber",
		"segmentStart",
		"segmentEnd",
		"text",
	]);
	const segmentStart = boundedInteger(raw.segmentStart, "segmentStart", 0);
	return {
		perekId: boundedInteger(raw.perekId, "perekId", 1),
		pasukNumber: boundedInteger(raw.pasukNumber, "pasukNumber", 1),
		segmentStart,
		segmentEnd: boundedInteger(raw.segmentEnd, "segmentEnd", segmentStart),
		text: textField(raw.text, "occurrence text", 500),
	};
}

function readOccurrences(value: unknown) {
	if (!Array.isArray(value) || value.length > MAX_PLACE_OCCURRENCES)
		throw new Error(
			`A place proposal supports at most ${MAX_PLACE_OCCURRENCES} exact word occurrences`,
		);
	const occurrences = value.map(readOccurrence);
	if (new Set(occurrences.map(placeOccurrenceKey)).size !== occurrences.length)
		throw new Error(
			"Each word occurrence can only appear once per place proposal",
		);
	return occurrences;
}

export function placeIdentificationCitations(
	identification: NonNullable<PlaceProfileChange["identification"]>,
) {
	return [
		...new Set([identification.citation, identification.coordinateCitation]),
	];
}

export function validatePlaceProfileBase(value: unknown): PlaceProfileBase {
	const base = record(value, "place profile base");
	const { entryAddresses, identification } = base;
	if (
		!Array.isArray(entryAddresses) ||
		entryAddresses.some((address) => typeof address !== "string" || !address)
	)
		throw new Error("Invalid place entry addresses");
	const point = identification === null ? null : record(identification);
	if (point && (!Array.isArray(point.citations) || point.citations.length > 2))
		throw new Error("Invalid place identification citations");
	return {
		entryAddresses,
		occurrences: readOccurrences(base.occurrences),
		identification: point
			? {
					id: contributionRecordId(point.id, "identification ID"),
					citations: (point.citations as unknown[]).map((value) =>
						textField(value, "identification citation", 500),
					),
				}
			: null,
	};
}

export function placeProfileHasEffect(
	before: PlaceProfileBase | null,
	after: PlaceProfileChange,
) {
	return (
		!before ||
		before.occurrences.length < after.occurrences.length ||
		Boolean(
			after.identification &&
				placeIdentificationCitations(after.identification).some(
					(citation) => !before.identification?.citations.includes(citation),
				),
		)
	);
}

function readIdentification(
	value: unknown,
): PlaceProfileChange["identification"] {
	if (value == null) return null;
	const raw = record(value, "place identification");
	rejectUnknown(raw, [
		"modernName",
		"latitude",
		"longitude",
		"basis",
		"citation",
		"coordinateCitation",
	]);
	const { latitude, longitude, basis } = raw;
	if (
		typeof latitude !== "number" ||
		!Number.isFinite(latitude) ||
		Math.abs(latitude) > 90 ||
		typeof longitude !== "number" ||
		!Number.isFinite(longitude) ||
		Math.abs(longitude) > 180
	)
		throw new Error(
			"A place identification requires valid latitude and longitude",
		);
	if (basis !== "consensus" && basis !== "commentary")
		throw new Error(
			"A place identification requires an explicit evidence basis",
		);
	return {
		modernName: textField(raw.modernName, "modernName", 255),
		latitude: Number(latitude.toFixed(8)),
		longitude: Number(longitude.toFixed(8)),
		basis,
		citation: textField(raw.citation, "identification citation", 500),
		coordinateCitation: textField(
			raw.coordinateCitation,
			"coordinate citation",
			500,
		),
	};
}

export function validatePlaceProfile(
	input: Record<string, unknown>,
	allowEmpty = false,
): PlaceProfileInput {
	const targetId =
		input.targetId == null || input.targetId === ""
			? undefined
			: contributionRecordId(input.targetId, "targetId");
	const raw = record(input.after, "place profile");
	rejectUnknown(raw, ["entry", "occurrences", "identification"]);
	let entry: PlaceProfileChange["entry"] = null;
	if (raw.entry != null) {
		const fields = record(raw.entry, "place entry");
		rejectUnknown(fields, ["title", "uniqueName", "displayName"]);
		const uniqueName = textField(fields.uniqueName, "uniqueName").normalize(
			"NFC",
		);
		if (/[/%?#\\]/.test(uniqueName))
			throw new Error("uniqueName must be a plain path segment");
		entry = {
			title: textField(fields.title, "title"),
			uniqueName,
			displayName: textField(fields.displayName, "displayName"),
		};
	}
	if (!entry && !targetId)
		throw new Error("Choose an existing place or propose a new entry");
	const occurrences = readOccurrences(raw.occurrences);
	const identification = readIdentification(raw.identification);
	if (!allowEmpty && !occurrences.length && !identification)
		throw new Error(
			"A place profile requires an occurrence or an identification",
		);
	return {
		kind: "place_profile",
		targetId,
		after: { entry, occurrences, identification },
	};
}
