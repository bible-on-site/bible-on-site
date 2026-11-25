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

export const FAMILY_NAME_TYPES = ["ADDITIONAL", "NICKNAME"] as const;

export type FamilyParentChildRelationshipType =
	(typeof FAMILY_PARENT_CHILD_RELATIONSHIP_TYPES)[number];

export type FamilyParentRole = (typeof FAMILY_PARENT_ROLES)[number];

export type FamilyUnionType = (typeof FAMILY_UNION_TYPES)[number];

export type FamilyUnionEndReason = (typeof FAMILY_UNION_END_REASONS)[number];

export type FamilyNameType = (typeof FAMILY_NAME_TYPES)[number];

/**
 * A person place fact is either a linked place entity (placeId) or a
 * free-text alternative (placeText) — exactly one of the two, never both.
 * `id` keeps the existing row identity so retained rows are updated in
 * place rather than re-created under new ids.
 */
export interface FamilyPersonPlace {
	id?: string | null;
	placeId?: string | null;
	placeText?: string | null;
	/** The values the editor loaded for this row — a CAS token so a
	 * contribution merge editing the row in place is detected rather than
	 * overwritten. Sent only for persisted rows (id set). */
	originalPlaceId?: string | null;
	originalPlaceText?: string | null;
}

export interface CreateFamilyPersonInput {
	displayName: string;
	sex?: "MALE" | "FEMALE" | "UNKNOWN" | null;
	linkToEntryId?: string | null;
	birthDate?: number | null;
	deathDate?: number | null;
	deathCause?: string | null;
	birthPlaceId?: string | null;
	birthPlaceText?: string | null;
	deathPlaceId?: string | null;
	deathPlaceText?: string | null;
	activityPlaces?: FamilyPersonPlace[] | null;
	isProphet?: boolean;
	isKing?: boolean;
}

export interface UpdateFamilyPersonInput {
	entityId: string;
	displayName?: string;
	sex?: "MALE" | "FEMALE" | "UNKNOWN" | null;
	birthDate?: number | null;
	deathDate?: number | null;
	deathCause?: string | null;
	birthPlaceId?: string | null;
	birthPlaceText?: string | null;
	/** The canonical birth-place row the editor loaded (null = none loaded).
	 * The save fails when the locked row no longer matches it, so a
	 * contribution merge cannot be overwritten silently. */
	birthPlaceOriginal?: FamilyPersonPlace | null;
	deathPlaceId?: string | null;
	deathPlaceText?: string | null;
	deathPlaceOriginal?: FamilyPersonPlace | null;
	activityPlaces?: FamilyPersonPlace[] | null;
	/** Canonical activity-place row ids the editor explicitly removed — only
	 * these may be deleted; a locked row outside kept + removed ids means the
	 * list changed under the editor and the save is rejected. */
	removedActivityPlaceIds?: string[];
	isProphet?: boolean;
	isKing?: boolean;
}

export interface DeleteFamilyPersonInput {
	entityId: string;
}

export interface CreatePersonNameInput {
	personId: string;
	name: string;
	nameType: FamilyNameType;
	altGroupId?: string | null;
	giverPersonId?: string | null;
	isGodGiven?: boolean;
}

export interface UpdatePersonNameInput {
	id: string;
	name?: string;
	nameType?: FamilyNameType;
	altGroupId?: string | null;
	giverPersonId?: string | null;
	isGodGiven?: boolean;
}

export interface DeletePersonNameInput {
	id: string;
}

export interface CreateParentChildLinkInput {
	parentPersonId: string;
	childPersonId: string;
	relationshipType: FamilyParentChildRelationshipType;
	parentRole: FamilyParentRole;
	altGroupId?: string | null;
	sourceCitation?: string | null;
}

export interface UpdateParentChildLinkInput {
	id: string;
	relationshipType?: FamilyParentChildRelationshipType;
	parentRole?: FamilyParentRole;
	altGroupId?: string | null;
	sourceCitation?: string | null;
}

export interface DeleteParentChildLinkInput {
	id: string;
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

export interface UpdateUnionLinkInput {
	id: string;
	unionType?: FamilyUnionType;
	unionOrder?: number | null;
	startDate?: number | null;
	endDate?: number | null;
	endReason?: FamilyUnionEndReason | null;
	altGroupId?: string | null;
	sourceCitation?: string | null;
}

export interface DeleteUnionLinkInput {
	id: string;
}

/**
 * API contract for Tanahpedia family graph mutations.
 * This file is the source of truth for request shapes used by admin RPC endpoints.
 */
export const FAMILY_API_SPEC = {
	version: 2,
	operations: {
		createFamilyPersonNode: {
			input: "CreateFamilyPersonInput",
			output: "{ entityId, personId, linkId? }",
		},
		updateFamilyPersonNode: {
			input: "UpdateFamilyPersonInput",
			output: "{ entityId }",
		},
		deleteFamilyPersonNode: {
			input: "DeleteFamilyPersonInput",
			output: "{ entityId }",
		},
		createParentChildLink: {
			input: "CreateParentChildLinkInput",
			output: "{ id }",
		},
		updateParentChildLink: {
			input: "UpdateParentChildLinkInput",
			output: "{ id }",
		},
		deleteParentChildLink: {
			input: "DeleteParentChildLinkInput",
			output: "{ id }",
		},
		createUnionLink: {
			input: "CreateUnionLinkInput",
			output: "{ id }",
		},
		updateUnionLink: {
			input: "UpdateUnionLinkInput",
			output: "{ id }",
		},
		deleteUnionLink: {
			input: "DeleteUnionLinkInput",
			output: "{ id }",
		},
		createPersonName: {
			input: "CreatePersonNameInput",
			output: "{ id }",
		},
		updatePersonName: {
			input: "UpdatePersonNameInput",
			output: "{ id }",
		},
		deletePersonName: {
			input: "DeletePersonNameInput",
			output: "{ id }",
		},
	},
} as const;
