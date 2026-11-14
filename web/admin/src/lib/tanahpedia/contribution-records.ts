import { contributionRecordId } from "./contribution-identifiers";
/** Explicit structured operations for the existing Tanahpedia schema. Table
 * and column names are server-owned constants; submitted data supplies values. */
export type RecordValue = string | number | boolean | null;
export interface ContributionField {
	column: string;
	label: string;
	type: "text" | "integer" | "boolean" | "date" | "reference" | "enum" | "blob";
	nullable?: boolean;
	reference?: string;
	numericReference?: boolean;
	options?: readonly string[];
	lookup?: string;
	min?: number;
	max?: number;
	maxLength?: number;
	allowFuture?: boolean;
}
export interface ContributionRecordSpec {
	category: string;
	label: string;
	table: string;
	fields: Record<string, ContributionField>;
	updateOnly?: boolean;
	immutable?: readonly string[];
	where?: string;
}
const ref = (
	column: string,
	label: string,
	reference: string,
	nullable = false,
	numericReference = false,
): ContributionField => ({
	column,
	label,
	reference,
	nullable,
	numericReference,
	type: "reference",
});
const text = (
	column: string,
	label: string,
	maxLength = 255,
	nullable = false,
): ContributionField => ({ column, label, maxLength, nullable, type: "text" });
const date = (
	column: string,
	label: string,
	nullable = false,
	allowFuture = false,
): ContributionField => ({
	column,
	label,
	nullable,
	allowFuture,
	type: "date",
});
const enumeration = (
	column: string,
	label: string,
	options: readonly string[],
	lookup?: string,
): ContributionField => ({ column, label, options, lookup, type: "enum" });
const alt = () =>
	ref("alt_group_id", "קבוצת דעות חלופיות", "alternative", true);
const spec = (
	category: string,
	label: string,
	table: string,
	fields: Record<string, ContributionField>,
	extra: Partial<ContributionRecordSpec> = {},
): ContributionRecordSpec => ({ category, label, table, fields, ...extra });
const person = () => ref("person_id", "איש", "person");
const place = () => ref("place_id", "מקום", "place");
const nation = () => ref("nation_id", "עם", "nation");
const saying = () => ref("saying_id", "אמרה", "saying");
const prophecy = () => ref("prophecy_id", "נבואה", "prophecy");
const name = () => ref("person_name_id", "שם האיש", "person_name");

export const CONTRIBUTION_RECORDS = {
	person_name: spec(
		"אישים",
		"שם נוסף או כינוי",
		"tanahpedia_person_name",
		{
			personId: person(),
			name: text("name", "שם"),
			nameType: enumeration(
				"name_type_id",
				"סוג שם",
				["ADDITIONAL", "NICKNAME"],
				"tanahpedia_lookup_name_type",
			),
			altGroupId: alt(),
		},
		{
			where:
				"name_type_id IN (SELECT id FROM tanahpedia_lookup_name_type WHERE name IN ('ADDITIONAL','NICKNAME'))",
		},
	),
	name_giver_person: spec(
		"אישים",
		"נותן שם - איש",
		"tanahpedia_person_name_giver_person",
		{
			personNameId: name(),
			giverPersonId: ref("giver_person_id", "נותן השם", "person"),
			altGroupId: alt(),
		},
	),
	name_giver_god: spec(
		"אישים",
		"שם שניתן מאת האל",
		"tanahpedia_person_name_giver_god",
		{
			personNameId: name(),
			godId: ref("god_id", "האל", "god"),
			altGroupId: alt(),
		},
	),
	person_sex: spec("אישים", "מין", "tanahpedia_person_sex", {
		personId: person(),
		sex: enumeration("sex", "מין", ["MALE", "FEMALE", "UNKNOWN"]),
		altGroupId: alt(),
	}),
	person_birth_date: spec(
		"אישים",
		"תאריך לידה",
		"tanahpedia_person_birth_date",
		{
			personId: person(),
			birthDate: date("birth_date", "תאריך לידה"),
			altGroupId: alt(),
		},
	),
	person_death_date: spec(
		"אישים",
		"תאריך פטירה",
		"tanahpedia_person_death_date",
		{
			personId: person(),
			deathDate: date("death_date", "תאריך פטירה", false, true),
			altGroupId: alt(),
		},
	),
	person_death_cause: spec(
		"אישים",
		"סיבת פטירה",
		"tanahpedia_person_death_cause",
		{
			personId: person(),
			deathCause: text("death_cause", "סיבת פטירה"),
			altGroupId: alt(),
		},
	),
	person_birth_place: spec(
		"אישים",
		"מקום לידה",
		"tanahpedia_person_birth_place",
		{ personId: person(), placeId: place(), altGroupId: alt() },
	),
	prophet_role: spec(
		"תפקידים ומלוכה",
		"תפקיד נביא",
		"tanahpedia_person_role_prophet",
		{ personId: person() },
		{ immutable: ["personId"] },
	),
	king_role: spec(
		"תפקידים ומלוכה",
		"תפקיד מלך",
		"tanahpedia_person_role_king",
		{ personId: person() },
		{ immutable: ["personId"] },
	),
	king_reign: spec("תפקידים ומלוכה", "תקופת מלוכה", "tanahpedia_king_reign", {
		kingRoleId: ref("king_role_id", "מלך", "king_role"),
		nationId: nation(),
		startDate: date("start_date", "תחילת מלוכה", true),
		endDate: date("end_date", "סיום מלוכה", true),
		altGroupId: alt(),
	}),
	event_place: spec("אירועים", "מיקום אירוע", "tanahpedia_event_place", {
		eventId: ref("event_id", "אירוע", "event"),
		placeId: place(),
		altGroupId: alt(),
	}),
	event_dates: spec("אירועים", "תאריכי אירוע", "tanahpedia_event_date_range", {
		eventId: ref("event_id", "אירוע", "event"),
		startDate: date("start_date", "תחילת האירוע", true),
		endDate: date("end_date", "סיום האירוע", true),
		altGroupId: alt(),
	}),
	war_side: spec(
		"מלחמות",
		"צד במלחמה",
		"tanahpedia_war_side",
		{
			warId: ref("war_id", "מלחמה", "war"),
			sideNumber: {
				column: "side_number",
				label: "מספר צד",
				type: "integer",
				min: 1,
				max: 2147483647,
			},
		},
		{ immutable: ["warId"] },
	),
	war_person: spec(
		"מלחמות",
		"איש המשתתף במלחמה",
		"tanahpedia_war_side_participant_person",
		{
			warSideId: ref("war_side_id", "צד במלחמה", "war_side"),
			personId: person(),
			altGroupId: alt(),
		},
	),
	war_nation: spec(
		"מלחמות",
		"עם המשתתף במלחמה",
		"tanahpedia_war_side_participant_nation",
		{
			warSideId: ref("war_side_id", "צד במלחמה", "war_side"),
			nationId: nation(),
			altGroupId: alt(),
		},
	),
	nation_origin: spec("עמים", "עם מקור", "tanahpedia_nation_source_nation", {
		nationId: nation(),
		sourceNationId: ref("source_nation_id", "עם מקור", "nation"),
		altGroupId: alt(),
	}),
	nation_territory: spec("עמים", "תחום שליטה", "tanahpedia_nation_territory", {
		nationId: nation(),
		placeId: place(),
		startDate: date("start_date", "תחילת שליטה", true),
		endDate: date("end_date", "סיום שליטה", true),
		altGroupId: alt(),
	}),
	saying_date: spec(
		"אמרות",
		"תאריך אמרה",
		"tanahpedia_saying",
		{ sayingDate: date("saying_date", "תאריך האמרה", true) },
		{ updateOnly: true },
	),
	saying_place: spec("אמרות", "מיקום אמרה", "tanahpedia_saying_location", {
		sayingId: saying(),
		placeId: place(),
		altGroupId: alt(),
	}),
	saying_speaker_person: spec(
		"אמרות",
		"דובר - איש",
		"tanahpedia_saying_speaker_person",
		{ sayingId: saying(), personId: person(), altGroupId: alt() },
	),
	saying_speaker_nation: spec(
		"אמרות",
		"דובר - עם",
		"tanahpedia_saying_speaker_nation",
		{ sayingId: saying(), nationId: nation(), altGroupId: alt() },
	),
	saying_speaker_god: spec(
		"אמרות",
		"דובר - האל",
		"tanahpedia_saying_speaker_god",
		{
			sayingId: saying(),
			godId: ref("god_id", "האל", "god"),
			altGroupId: alt(),
		},
	),
	saying_audience_person: spec(
		"אמרות",
		"נמען אמרה - איש",
		"tanahpedia_saying_audience_person",
		{ sayingId: saying(), personId: person(), altGroupId: alt() },
	),
	saying_audience_nation: spec(
		"אמרות",
		"נמען אמרה - עם",
		"tanahpedia_saying_audience_nation",
		{ sayingId: saying(), nationId: nation(), altGroupId: alt() },
	),
	prophecy_quality: spec(
		"נבואות",
		"סיווג נבואה",
		"tanahpedia_prophecy_is_good",
		{
			prophecyId: prophecy(),
			isGood: { column: "is_good", label: "נבואת טובה", type: "boolean" },
			altGroupId: alt(),
		},
	),
	prophecy_prophet: spec(
		"נבואות",
		"נביא הנבואה",
		"tanahpedia_prophecy_prophet",
		{ prophecyId: prophecy(), personId: person(), altGroupId: alt() },
	),
	prophecy_person: spec(
		"נבואות",
		"נמען נבואה - איש",
		"tanahpedia_prophecy_recipient_person",
		{ prophecyId: prophecy(), personId: person(), altGroupId: alt() },
	),
	prophecy_nation: spec(
		"נבואות",
		"נמען נבואה - עם",
		"tanahpedia_prophecy_recipient_nation",
		{ prophecyId: prophecy(), nationId: nation(), altGroupId: alt() },
	),
	animal_kind: spec("בעלי חיים", "סוג בעל חיים", "tanahpedia_animal_kind", {
		animalId: ref("animal_id", "בעל חיים", "animal"),
		kind: enumeration("kind", "סוג בעל חיים", [
			"BEHEMA",
			"CHAYA",
			"OF",
			"SHERETZ",
		]),
		altGroupId: alt(),
	}),
	animal_purity: spec(
		"בעלי חיים",
		"טוהרת בעל חיים",
		"tanahpedia_animal_purity",
		{
			animalId: ref("animal_id", "בעל חיים", "animal"),
			purity: enumeration("purity", "טוהרה", ["TAHOR", "TAMEH"]),
			altGroupId: alt(),
		},
	),
	plant_creation: spec(
		"צמחים",
		"יום בריאת צמח",
		"tanahpedia_plant_creation_day",
		{
			plantId: ref("plant_id", "צמח", "plant"),
			creationDay: {
				column: "creation_day",
				label: "יום הבריאה",
				type: "integer",
				min: 1,
				max: 6,
			},
			altGroupId: alt(),
		},
	),
	astronomical_creation: spec(
		"גרמי שמיים",
		"יום בריאת גרם שמיים",
		"tanahpedia_astronomical_object_creation_day",
		{
			astronomicalObjectId: ref(
				"astronomical_object_id",
				"גרם שמיים",
				"astronomical_object",
			),
			creationDay: {
				column: "creation_day",
				label: "יום הבריאה",
				type: "integer",
				min: 1,
				max: 6,
			},
			altGroupId: alt(),
		},
	),
	book_identification: spec(
		"ספרים",
		"זיהוי ספר מקראי",
		"tanahpedia_sefer_tanah_match",
		{
			seferId: ref("sefer_id", "ספר", "sefer"),
			tanahSeferId: ref(
				"tanah_sefer_id",
				"ספר מקראי",
				"tanah_sefer",
				false,
				true,
			),
			altGroupId: alt(),
		},
	),
	entry_entity: spec(
		"זהות הערך",
		"קישור ערך ליישות",
		"tanahpedia_entry_entity",
		{
			entryId: ref("entry_id", "ערך", "entry"),
			entityId: ref("entity_id", "יישות", "entity"),
		},
	),
	entity_source: spec(
		"מקורות",
		"הפניה לפסוק",
		"tanahpedia_entity_tanah_source",
		{
			entityId: ref("entity_id", "יישות", "entity"),
			perekId: ref("perek_id", "פרק", "perek", false, true),
			pasukNumber: {
				column: "pasuk_number",
				label: "פסוק",
				type: "integer",
				min: 1,
				max: 176,
			},
			segmentStart: {
				column: "segment_start",
				label: "קטע ראשון",
				type: "integer",
				nullable: true,
				min: 0,
				max: 2147483647,
			},
			segmentEnd: {
				column: "segment_end",
				label: "קטע אחרון",
				type: "integer",
				nullable: true,
				min: 0,
				max: 2147483647,
			},
		},
	),
	model_3d: spec("מודלים", "מודל תלת-ממד", "tanahpedia_3d_model", {
		entityId: ref("entity_id", "יישות", "entity"),
		blobKey: {
			column: "blob_key",
			label: "מפתח קובץ המודל",
			type: "blob",
			maxLength: 500,
		},
		format: text("format", "פורמט המודל", 50),
		label: text("label", "תווית", 255, true),
		altGroupId: alt(),
	}),
} as const;
export type ContributionRecordKind = keyof typeof CONTRIBUTION_RECORDS;
export type ContributionRecordInput = {
	kind: ContributionRecordKind;
	targetId?: string;
	after: Record<string, RecordValue> | null;
};
export function isContributionRecordKind(
	value: unknown,
): value is ContributionRecordKind {
	return (
		typeof value === "string" && Object.hasOwn(CONTRIBUTION_RECORDS, value)
	);
}
export function isContributionRecordInput(value: {
	kind: string;
}): value is ContributionRecordInput {
	return isContributionRecordKind(value.kind);
}

export function validateContributionField(
	value: unknown,
	field: ContributionField,
): RecordValue {
	if (value === null || value === undefined || value === "") {
		if (field.nullable) return null;
		throw new Error(`${field.label}: required`);
	}
	if (field.type === "reference") {
		if (!field.numericReference)
			return contributionRecordId(value, field.label);
		if (
			typeof value !== "number" ||
			!Number.isSafeInteger(value) ||
			value < 1 ||
			value > 2147483647
		)
			throw new Error(`${field.label}: invalid identifier`);
		return value;
	}
	if (field.type === "boolean") {
		if (typeof value !== "boolean")
			throw new Error(`${field.label}: boolean required`);
		return value;
	}
	if (field.type === "integer" || field.type === "date") {
		if (
			typeof value !== "number" ||
			!Number.isSafeInteger(value) ||
			value < (field.min ?? -2147483648) ||
			value > (field.max ?? 2147483647)
		)
			throw new Error(`${field.label}: invalid integer`);
		if (field.type === "date") {
			if (value === 0 || (field.allowFuture && value === -1)) return value;
			const year = Math.floor(value / 10000),
				month = Math.floor(value / 100) % 100,
				day = value % 100;
			if (
				year < 0 ||
				year > 9999 ||
				month < 0 ||
				month > 14 ||
				day < 0 ||
				day > 30 ||
				(month === 0 && day !== 0)
			)
				throw new Error(`${field.label}: invalid Hebrew date`);
		}
		return value;
	}
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.trim().length > (field.maxLength ?? 255)
	)
		throw new Error(`${field.label}: invalid text`);
	const text = value.trim();
	if (field.type === "enum" && !field.options?.includes(text))
		throw new Error(`${field.label}: invalid option`);
	if (field.type === "blob") {
		let decoded: string;
		try {
			decoded = decodeURIComponent(text);
		} catch {
			throw new Error("Invalid model key");
		}
		if (
			decoded.startsWith("/") ||
			decoded.includes("\\") ||
			decoded.includes(":") ||
			decoded.split("/").some((part) => part === "." || part === "..") ||
			[...decoded].some(
				(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
			)
		)
			throw new Error("Invalid model key");
	}
	return text;
}
export function validateContributionRecord(
	raw: Record<string, unknown>,
): ContributionRecordInput {
	if (!isContributionRecordKind(raw.kind))
		throw new Error("Unsupported structured change");
	const definition: ContributionRecordSpec = CONTRIBUTION_RECORDS[raw.kind];
	const targetId =
		raw.targetId == null || raw.targetId === ""
			? undefined
			: contributionRecordId(raw.targetId, "targetId");
	if (definition.updateOnly && !targetId)
		throw new Error("Choose an existing record");
	if (raw.after === null) {
		if (!targetId || definition.updateOnly)
			throw new Error("Unsupported deletion");
		return { kind: raw.kind, targetId, after: null };
	}
	if (!raw.after || typeof raw.after !== "object" || Array.isArray(raw.after))
		throw new Error("Structured fields are required");
	const input = raw.after as Record<string, unknown>;
	for (const key of Object.keys(input))
		if (!Object.hasOwn(definition.fields, key))
			throw new Error(`Unsupported field: ${key}`);
	const after = Object.fromEntries(
		Object.entries(definition.fields).map(([key, field]) => [
			key,
			validateContributionField(input[key], field),
		]),
	);
	if (raw.kind === "nation_origin" && after.nationId === after.sourceNationId)
		throw new Error("A nation cannot originate from itself");
	if (
		raw.kind === "entity_source" &&
		((after.segmentStart === null) !== (after.segmentEnd === null) ||
			(typeof after.segmentStart === "number" &&
				typeof after.segmentEnd === "number" &&
				after.segmentEnd < after.segmentStart))
	)
		throw new Error("Invalid passage segment range");
	return { kind: raw.kind, targetId, after };
}
