import { contributionRecordId } from "./contribution-identifiers";
import { CONTRIBUTION_RECORDS } from "./contribution-records";
import { record, textField } from "./contributions";
import { ENTITY_TYPE_LABELS, type EntityType } from "./labels";
import {
	normalizePediaName,
	reservedCategoryLabelFor,
	validateAliasSpec,
} from "./pedia-names";

export interface AliasMapping {
	name: string;
	targets: { entryId: string; label: string }[];
}
export type SpecialChangeInput =
	| { kind: "alias_mapping"; targetId?: string; after: AliasMapping | null }
	| {
			kind: "source_reference";
			targetId?: string;
			after: SourceReference | null;
	  };
export interface SourceReference {
	targetKind: string;
	targetId: string;
	sourceType: "tanah" | "other";
	perekId: number | null;
	pasukNumber: number | null;
	perushId: number | null;
	sourceText: string | null;
}
const ROOT_SOURCE_TARGETS: Record<string, string> = {
	entity: "tanahpedia_entity",
	entry: "tanahpedia_entry",
	person: "tanahpedia_person",
	place: "tanahpedia_place",
	nation: "tanahpedia_nation",
	event: "tanahpedia_event",
	war: "tanahpedia_war",
	animal: "tanahpedia_animal",
	object: "tanahpedia_object",
	temple_tool: "tanahpedia_temple_tool",
	plant: "tanahpedia_plant",
	astronomical_object: "tanahpedia_astronomical_object",
	sefer: "tanahpedia_sefer",
	saying: "tanahpedia_saying",
	prophecy: "tanahpedia_prophecy",
	parent_child: "tanahpedia_person_parent_child",
	union: "tanahpedia_person_union",
	place_identification: "tanahpedia_place_identification",
};
export const SOURCE_TARGETS: Record<string, string> = {
	...ROOT_SOURCE_TARGETS,
	...Object.fromEntries(
		Object.entries(CONTRIBUTION_RECORDS)
			.filter(
				([, spec]) => !Object.values(ROOT_SOURCE_TARGETS).includes(spec.table),
			)
			.map(([kind, spec]) => [kind, spec.table]),
	),
};
export const SOURCE_TARGET_LABELS: Record<string, string> = {
	...Object.fromEntries(
		Object.keys(ROOT_SOURCE_TARGETS).map((kind) => [
			kind,
			ENTITY_TYPE_LABELS[kind.toUpperCase() as EntityType] ?? kind,
		]),
	),
	entry: "ערך",
	entity: "יישות",
	parent_child: "קשר הורה וילד",
	union: "זוגיות",
	place_identification: "זיהוי מקום",
	...Object.fromEntries(
		Object.entries(CONTRIBUTION_RECORDS)
			.filter(([kind]) => Object.hasOwn(SOURCE_TARGETS, kind))
			.map(([kind, spec]) => [kind, spec.label]),
	),
};
function exact(value: Record<string, unknown>, keys: string[]) {
	for (const key of Object.keys(value))
		if (!keys.includes(key)) throw new Error(`Unsupported field: ${key}`);
}
function positive(value: unknown, max = 2147483647): number | null {
	if (value == null) return null;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > max
	)
		throw new Error("Invalid source identifier or verse");
	return value;
}
export function validateSpecialChange(
	input: Record<string, unknown>,
): SpecialChangeInput {
	const targetId =
		input.targetId == null || input.targetId === ""
			? undefined
			: contributionRecordId(input.targetId, "targetId");
	const kind = input.kind;
	if (kind !== "alias_mapping" && kind !== "source_reference")
		throw new Error("Unsupported special change");
	if (input.after === null) {
		if (!targetId) throw new Error("Deletion requires a target");
		return { kind, targetId, after: null };
	}
	const a = record(input.after, "after");
	if (kind === "alias_mapping") {
		exact(a, ["name", "targets"]);
		const name = normalizePediaName(textField(a.name, "name"));
		if (reservedCategoryLabelFor(name))
			throw new Error("Alias is reserved for a category");
		if (!Array.isArray(a.targets) || a.targets.length > 40)
			throw new Error("Alias requires 1-40 targets");
		const targets = a.targets
			.map((raw) => {
				const target = record(raw);
				exact(target, ["entryId", "label"]);
				return {
					entryId: contributionRecordId(target.entryId, "entryId"),
					label:
						target.label == null || target.label === ""
							? ""
							: textField(target.label, "label"),
				};
			})
			.sort((a, b) => a.entryId.localeCompare(b.entryId));
		if (new Set(targets.map((t) => t.entryId)).size !== targets.length)
			throw new Error("Duplicate alias target");
		const result = validateAliasSpec(name, targets);
		if (!result.ok) throw new Error(result.error);
		return { kind, targetId, after: { name, targets } };
	}
	exact(a, [
		"targetKind",
		"targetId",
		"sourceType",
		"perekId",
		"pasukNumber",
		"perushId",
		"sourceText",
	]);
	if (
		typeof a.targetKind !== "string" ||
		!Object.hasOwn(SOURCE_TARGETS, a.targetKind)
	)
		throw new Error("Invalid source attachment target");
	if (a.sourceType !== "tanah" && a.sourceType !== "other")
		throw new Error("Invalid source type");
	const after: SourceReference = {
		targetKind: a.targetKind,
		targetId: contributionRecordId(a.targetId, "source target"),
		sourceType: a.sourceType,
		perekId: positive(a.perekId),
		pasukNumber: positive(a.pasukNumber, 176),
		perushId: positive(a.perushId, 32767),
		sourceText:
			a.sourceText == null || a.sourceText === ""
				? null
				: textField(a.sourceText, "sourceText", 500),
	};
	if (
		after.sourceType === "tanah"
			? !after.perekId || after.sourceText !== null
			: after.sourceText === null ||
				after.perekId !== null ||
				after.pasukNumber !== null ||
				after.perushId !== null
	)
		throw new Error(
			"Supply either a scripture reference or a bibliographic source",
		);
	return { kind, targetId, after };
}
