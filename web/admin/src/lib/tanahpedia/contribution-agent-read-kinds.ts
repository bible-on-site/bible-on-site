import {
	CONTRIBUTION_RECORDS,
	type ContributionRecordKind,
} from "./contribution-records";

/** Pure capability vocabulary shared by declarations, validators and SQL dispatch. */
export const CONTRIBUTION_AGENT_ROOT_REFERENCE_KINDS = Object.freeze([
	"person",
	"place",
	"nation",
	"event",
	"war",
	"animal",
	"object",
	"temple_tool",
	"plant",
	"astronomical_object",
	"sefer",
	"saying",
	"prophecy",
] as const);
export const CONTRIBUTION_AGENT_REFERENCE_KINDS = Object.freeze([
	...CONTRIBUTION_AGENT_ROOT_REFERENCE_KINDS,
	"entity",
	"entry",
	"person_name",
	"king_role",
	"war_side",
	"god",
	"tanah_sefer",
	"perek",
	"perush",
	"article",
	"article_author",
	"dedication",
	"moed",
	"place_identification",
	"alternative",
] as const);
export const CONTRIBUTION_AGENT_TARGET_KINDS = Object.freeze([
	"parent_child",
	"union",
	"place",
	"metadata",
	"entry",
	"alias_mapping",
	"source_reference",
	"article_links",
	...(Object.keys(CONTRIBUTION_RECORDS) as ContributionRecordKind[]),
] as const);
export const CONTRIBUTION_AGENT_READ_KINDS = Object.freeze([
	...CONTRIBUTION_AGENT_REFERENCE_KINDS,
	...CONTRIBUTION_AGENT_TARGET_KINDS.map((kind) => `target:${kind}` as const),
]);
export function isContributionAgentReadKind(
	value: unknown,
): value is (typeof CONTRIBUTION_AGENT_READ_KINDS)[number] {
	return (
		typeof value === "string" &&
		CONTRIBUTION_AGENT_READ_KINDS.some((kind) => kind === value)
	);
}
