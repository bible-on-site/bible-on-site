export const FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES = [
	"BIOLOGICAL",
	"ADOPTIVE",
	"STEP",
	"FOSTER",
] as const;

export const FAMILY_PARENT_ROLES = ["FATHER", "MOTHER"] as const;

export const FAMILY_UNION_TYPES = [
	"MARRIAGE",
	"PILEGESH",
	"FORBIDDEN_WITH_GENTILE",
	"BANNED_INCEST",
	"BETROTHAL",
] as const;

export const FAMILY_UNION_END_REASONS = ["DEATH", "DIVORCE"] as const;

export type FamilyParentChildRelationshipType =
	(typeof FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES)[number];

export type FamilyParentRole = (typeof FAMILY_PARENT_ROLES)[number];

export type FamilyUnionType = (typeof FAMILY_UNION_TYPES)[number];

export type FamilyUnionEndReason = (typeof FAMILY_UNION_END_REASONS)[number];

export interface CreateFamilyPersonInput {
	displayName: string;
	sex?: "MALE" | "FEMALE" | "UNKNOWN" | null;
	linkToEntryId?: string | null;
}

export interface CreateParentChildLinkInput {
	parentPersonId: string;
	childPersonId: string;
	relationshipType: FamilyParentChildRelationshipType;
	parentRole: FamilyParentRole;
	altGroupId?: string | null;
	sourceCitation?: string | null;
}

export interface CreateUnionLinkInput {
	person1Id: string;
	person2Id: string;
	unionType: FamilyUnionType;
	unionOrder?: number | null;
	startDate?: number | null;
	endDate?: number | null;
	endReason?: FamilyUnionEndReason | null;
	altGroupId?: string | null;
	sourceCitation?: string | null;
}

/**
 * API contract for Tanahpedia family graph mutations.
 * This file is the source of truth for request shapes used by admin RPC endpoints.
 */
export const FAMILY_API_SPEC = {
	version: 1,
	operations: {
		createFamilyPersonNode: {
			input: "CreateFamilyPersonInput",
			output: "{ entityId, personId, linkId? }",
		},
		createParentChildLink: {
			input: "CreateParentChildLinkInput",
			output: "{ id }",
		},
		createUnionLink: {
			input: "CreateUnionLinkInput",
			output: "{ id }",
		},
	},
} as const;
