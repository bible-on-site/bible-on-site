/**
 * מיפוי תיעודי של סכמת תנכפדיה (MySQL) לעורך האדמין ול־LLM.
 * מקור אמת: `data/mysql/tanahpedia_structure.sql`, `tanahpedia_seed_data.sql`.
 */

import type { EntityType } from "./labels";

/** סוגי יישות שניתן ליצור כרגע מהאדמין (תואם enum ב־MySQL). */
export const ADMIN_CREATABLE_ENTITY_TYPES: Exclude<
	EntityType,
	"TANAH_SEFER"
>[] = [
	"PERSON",
	"PLACE",
	"EVENT",
	"WAR",
	"ANIMAL",
	"OBJECT",
	"TEMPLE_TOOL",
	"PLANT",
	"ASTRONOMICAL_OBJECT",
	"SAYING",
	"SEFER",
	"PROPHECY",
	"NATION",
];

export interface SchemaColumnDoc {
	column: string;
	sqlType: string;
	nullable: boolean;
	notes?: string;
}

export interface SchemaTableDoc {
	table: string;
	purpose: string;
	columns: SchemaColumnDoc[];
	fks?: string[];
}

/** טבלאות בסיס וקישור לערך */
export const TANAH_MEDIA_CORE_TABLES: SchemaTableDoc[] = [
	{
		table: "tanahpedia_entry",
		purpose: "ערך תנכפדיה (כותרת, שם ייחודי, תוכן HTML)",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{
				column: "unique_name",
				sqlType: "varchar(255) UNIQUE",
				nullable: false,
			},
			{ column: "title", sqlType: "varchar(255)", nullable: false },
			{ column: "content", sqlType: "mediumtext", nullable: true },
			{ column: "created_at", sqlType: "datetime", nullable: false },
			{ column: "updated_at", sqlType: "datetime", nullable: false },
		],
	},
	{
		table: "tanahpedia_entity",
		purpose: "יישות מסווגת; שם תצוגה ראשי משותף לכל הסוגים",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{
				column: "entity_type",
				sqlType:
					"enum(PERSON,PLACE,EVENT,WAR,ANIMAL,OBJECT,TEMPLE_TOOL,PLANT,ASTRONOMICAL_OBJECT,SAYING,SEFER,PROPHECY,NATION)",
				nullable: false,
			},
			{ column: "name", sqlType: "varchar(255)", nullable: false },
			{ column: "created_at", sqlType: "datetime", nullable: false },
			{ column: "updated_at", sqlType: "datetime", nullable: false },
		],
	},
	{
		table: "tanahpedia_entry_entity",
		purpose: "קישור many-to-many בין ערך ליישות",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{ column: "entry_id", sqlType: "char(36) FK → entry", nullable: false },
			{ column: "entity_id", sqlType: "char(36) FK → entity", nullable: false },
		],
	},
];

export const TANAH_MEDIA_PERSON_TABLES: SchemaTableDoc[] = [
	{
		table: "tanahpedia_person",
		purpose: "הרחבת PERSON; שורה אחת לכל entity_id",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{
				column: "entity_id",
				sqlType: "char(36) UNIQUE FK → tanahpedia_entity",
				nullable: false,
			},
		],
	},
	{
		table: "tanahpedia_person_name",
		purpose: "שמות (סוג מ־lookup; MAIN = שם ראשי ללא חלופות)",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{ column: "person_id", sqlType: "char(36) FK → person", nullable: false },
			{ column: "name", sqlType: "varchar(255)", nullable: false },
			{
				column: "name_type_id",
				sqlType: "char(36) FK → tanahpedia_lookup_name_type",
				nullable: false,
			},
			{
				column: "alt_group_id",
				sqlType: "char(36) NULL",
				nullable: true,
				notes: "קבוצת חלופות; NULL = ערך ראשי יחיד",
			},
		],
		fks: [
			"tanahpedia_lookup_name_type.name: MAIN | ADDITIONAL | NICKNAME (זרע קבוע)",
		],
	},
	{
		table: "tanahpedia_person_sex",
		purpose: "מין (יכול לכלול חלופות דרך alt_group_id)",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{ column: "person_id", sqlType: "char(36) FK", nullable: false },
			{
				column: "sex",
				sqlType: "enum('MALE','FEMALE','UNKNOWN')",
				nullable: false,
			},
			{ column: "alt_group_id", sqlType: "char(36) NULL", nullable: true },
		],
	},
];

export const TANAH_MEDIA_PLACE_TABLES: SchemaTableDoc[] = [
	{
		table: "tanahpedia_place",
		purpose: "הרחבת PLACE; שם התצוגה ב־tanahpedia_entity.name",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{
				column: "entity_id",
				sqlType: "char(36) UNIQUE FK → entity",
				nullable: false,
			},
		],
	},
	{
		table: "tanahpedia_place_identification",
		purpose: "זיהוי גאוגרפי (שם מודרני, קואורדינטות); ייתכנו מספר שורות",
		columns: [
			{ column: "id", sqlType: "char(36) PK", nullable: false },
			{ column: "place_id", sqlType: "char(36) FK → place", nullable: false },
			{ column: "modern_name", sqlType: "varchar(255) NULL", nullable: true },
			{ column: "latitude", sqlType: "decimal(10,8) NULL", nullable: true },
			{ column: "longitude", sqlType: "decimal(11,8) NULL", nullable: true },
			{ column: "alt_group_id", sqlType: "char(36) NULL", nullable: true },
		],
	},
];

function formatTableDoc(t: SchemaTableDoc): string {
	const cols = t.columns
		.map(
			(c) =>
				`    - ${c.column}: ${c.sqlType}${c.nullable ? "" : " NOT NULL"}${c.notes ? ` — ${c.notes}` : ""}`,
		)
		.join("\n");
	const fks = t.fks?.length
		? `\n  FKs / lookups:\n${t.fks.map((f) => `    - ${f}`).join("\n")}`
		: "";
	return `${t.table}: ${t.purpose}\n  Columns:\n${cols}${fks}`;
}

/** טקסט קומפקטי לשילוב בפרומפט LLM */
export function getTanahpediaSchemaSummaryForLlm(): string {
	return [
		"=== Tanahpedia MySQL schema (admin-editable subset) ===",
		"",
		...TANAH_MEDIA_CORE_TABLES.map(formatTableDoc),
		"",
		"PERSON extension:",
		...TANAH_MEDIA_PERSON_TABLES.map(formatTableDoc),
		"",
		"PLACE extension:",
		...TANAH_MEDIA_PLACE_TABLES.map(formatTableDoc),
		"",
		"Rules:",
		"- Every concrete entity has exactly one tanahpedia_entity row; type-specific row links via entity_id.",
		"- PLACE has no name column on tanahpedia_place — use tanahpedia_entity.name.",
		"- LLM must NOT assume direct DB writes; output JSON proposals only.",
	].join("\n");
}
