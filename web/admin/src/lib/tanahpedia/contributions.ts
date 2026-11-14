import { canonicalJson } from "~/lib/canonical-json";
import {
	type ContributionApiMigration,
	migrationBlocked,
} from "./contribution-api";
import type { EntityType } from "./labels";
import { ADMIN_CREATABLE_ENTITY_TYPES } from "./schema-registry";

export type Assignee =
	| { kind: "unassigned" }
	| { kind: "human"; id: string; name: string }
	| { kind: "aws_llm" }
	| { kind: "local_llm" };

export interface Contributor {
	id: string;
	name: string;
	kind: "human" | "aws_llm" | "local_llm";
	isDoradsoft: boolean;
}

export interface Evidence {
	citation: string;
	quote: string;
	url: string | null;
	note: string;
}

export interface ParentChildChange {
	parentId: string;
	childId: string;
	relationshipType: "BIOLOGICAL" | "ADOPTIVE" | "STEP" | "FOSTER";
	parentRole: "FATHER" | "MOTHER";
	sourceCitation: string | null;
	altGroupId: string | null;
	birthOrder: number | null;
}

export interface UnionChange {
	person1Id: string;
	person2Id: string;
	unionType:
		| "MARRIAGE"
		| "PILEGESH"
		| "FORBIDDEN_WITH_GENTILE"
		| "BANNED_INCEST"
		| "BETROTHAL";
	unionOrder: number | null;
	startDate: number | null;
	endDate: number | null;
	endReason: "DEATH" | "DIVORCE" | null;
	sourceCitation: string | null;
	personSourceCitation: string | null;
	altGroupId: string | null;
}

export interface PlaceChange {
	placeId: string;
	modernName: string | null;
	latitude: number | null;
	longitude: number | null;
	altGroupId: string | null;
}

export interface EntryShellChange {
	title: string;
	uniqueName: string;
	entityType: Exclude<EntityType, "TANAH_SEFER">;
	displayName: string;
}

export type ChangeInput =
	| { kind: "parent_child"; targetId?: string; after: ParentChildChange | null }
	| { kind: "union"; targetId?: string; after: UnionChange | null }
	| { kind: "place"; targetId?: string; after: PlaceChange | null }
	| { kind: "metadata"; targetId: string; after: { displayName: string } }
	| { kind: "entry"; targetId?: string; after: EntryShellChange };

export type ChangeState = Record<string, string | number | null>;

export interface ReviewedChange {
	kind: ChangeInput["kind"];
	targetId: string;
	before: ChangeState | null;
	after: ChangeState | null;
	labels: Record<string, string>;
}

export interface ContributionEvent {
	id: string;
	kind:
		| "created"
		| "edited"
		| "comment"
		| "assigned"
		| "approved"
		| "changes_requested"
		| "closed"
		| "reopened"
		| "merged"
		| "generated";
	actor: Contributor;
	body: string;
	at: string;
	revision: number;
}

export interface Contribution {
	id: string;
	number: number;
	kind: "issue" | "pr";
	state: "open" | "closed" | "merged";
	title: string;
	description: string;
	author: Contributor;
	revisionAuthor?: Contributor;
	assignee: Assignee;
	evidence: Evidence[];
	changes: ReviewedChange[];
	issueId: string | null;
	revision: number;
	version: number;
	events: ContributionEvent[];
	createdAt: string;
	updatedAt: string;
	closeIssue: boolean;
	provenance: { model: string; provider: string; promptVersion: string } | null;
	apiVersion?: number;
	apiMigration?: ContributionApiMigration;
	apiMigrationHistory?: ContributionApiMigration[];
}

export const CHANGE_LABELS: Record<ChangeInput["kind"], string> = {
	parent_child: "קשר הורה וילד",
	union: "זוגיות",
	place: "זיהוי מקום",
	metadata: "מטא-נתונים",
	entry: "ערך חדש",
};

export const FIELD_LABELS: Record<string, string> = {
	parentId: "הורה",
	childId: "ילד",
	relationshipType: "סוג קשר",
	parentRole: "תפקיד ההורה",
	person1Id: "איש ראשון",
	person2Id: "איש שני",
	unionType: "סוג זוגיות",
	unionOrder: "סדר זוגיות",
	startDate: "תאריך התחלה",
	endDate: "תאריך סיום",
	endReason: "סיבת סיום",
	sourceCitation: "מקור",
	personSourceCitation: "מקור לאיש",
	altGroupId: "דעה חלופית",
	birthOrder: "סדר לידה",
	placeId: "מקום",
	modernName: "שם מודרני",
	latitude: "קו רוחב",
	longitude: "קו אורך",
	displayName: "שם תצוגה",
	title: "כותרת",
	uniqueName: "שם ייחודי",
	entityType: "סוג יישות",
};

export function assigneeLabel(assignee: Assignee): string {
	if (assignee.kind === "human") return assignee.name;
	return { unassigned: "ללא שיוך", aws_llm: "AWS LLM", local_llm: "Local LLM" }[
		assignee.kind
	];
}

export function record(
	value: unknown,
	field = "input",
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${field}: object required`);
	return value as Record<string, unknown>;
}

export function textField(value: unknown, field: string, max = 255): string {
	if (typeof value !== "string" || !value.trim() || value.trim().length > max)
		throw new Error(`${field}: required, maximum ${max} characters`);
	return value.trim();
}

function optionalText(value: unknown, field: string, max = 400): string | null {
	return value == null || value === "" ? null : textField(value, field, max);
}

export function uuidField(value: unknown, field: string): string {
	const id = textField(value, field, 36);
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
	)
		throw new Error(`${field}: UUID required`);
	return id.toLowerCase();
}

function oneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	field: string,
): T {
	if (typeof value !== "string" || !allowed.includes(value as T))
		throw new Error(`${field}: invalid value`);
	return value as T;
}

function integer(
	value: unknown,
	field: string,
	min = -2147483648,
): number | null {
	if (value == null || value === "") return null;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < min ||
		value > 2147483647
	)
		throw new Error(`${field}: invalid integer`);
	return value;
}

function coordinate(
	value: unknown,
	field: string,
	limit: number,
): number | null {
	if (value == null || value === "") return null;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		Math.abs(value) > limit
	)
		throw new Error(`${field}: invalid coordinate`);
	return Math.round(value * 1e8) / 1e8;
}

function rejectUnknown(input: Record<string, unknown>, fields: string[]): void {
	for (const key of Object.keys(input))
		if (!fields.includes(key)) throw new Error(`Unsupported field: ${key}`);
}

export function validateAssignee(value: unknown): Assignee {
	const input = record(value, "assignee");
	const kind = oneOf(
		input.kind,
		["unassigned", "human", "aws_llm", "local_llm"] as const,
		"assignee.kind",
	);
	if (kind === "human")
		return {
			kind,
			id: textField(input.id, "assignee.id", 200),
			name: textField(input.name, "assignee.name", 120),
		};
	return { kind };
}

export function validateEvidence(value: unknown): Evidence[] {
	if (!Array.isArray(value) || value.length > 30)
		throw new Error("evidence: maximum 30 sources");
	return value.map((raw) => {
		const input = record(raw, "evidence");
		const citation = textField(input.citation, "citation", 500);
		const url = optionalText(input.url, "url", 2000);
		if (url && !["http:", "https:"].includes(new URL(url).protocol))
			throw new Error("Evidence URLs must use http or https");
		return {
			citation,
			quote: optionalText(input.quote, "quote", 8000) ?? "",
			url,
			note: optionalText(input.note, "note", 4000) ?? "",
		};
	});
}

export function validateChange(value: unknown): ChangeInput {
	const input = record(value, "change");
	rejectUnknown(input, ["kind", "targetId", "after"]);
	const kind = oneOf(
		input.kind,
		["parent_child", "union", "place", "metadata", "entry"] as const,
		"change.kind",
	);
	const targetId =
		input.targetId == null || input.targetId === ""
			? undefined
			: uuidField(input.targetId, "targetId");
	if (input.after === null) {
		if (!targetId || kind === "entry" || kind === "metadata")
			throw new Error("This change cannot delete its target");
		return { kind, targetId, after: null };
	}
	const after = record(input.after, "after");
	const citation = () => optionalText(after.sourceCitation, "sourceCitation");
	const alt = () =>
		after.altGroupId == null || after.altGroupId === ""
			? null
			: uuidField(after.altGroupId, "altGroupId");
	if (kind === "parent_child") {
		rejectUnknown(after, [
			"parentId",
			"childId",
			"relationshipType",
			"parentRole",
			"sourceCitation",
			"altGroupId",
			"birthOrder",
		]);
		const parentId = uuidField(after.parentId, "parentId"),
			childId = uuidField(after.childId, "childId");
		if (parentId === childId)
			throw new Error("A person cannot be their own parent");
		return {
			kind,
			targetId,
			after: {
				parentId,
				childId,
				relationshipType: oneOf(
					after.relationshipType,
					["BIOLOGICAL", "ADOPTIVE", "STEP", "FOSTER"],
					"relationshipType",
				),
				parentRole: oneOf(after.parentRole, ["FATHER", "MOTHER"], "parentRole"),
				sourceCitation: citation(),
				altGroupId: alt(),
				birthOrder: integer(after.birthOrder, "birthOrder", 1),
			},
		};
	}
	if (kind === "union") {
		rejectUnknown(after, [
			"person1Id",
			"person2Id",
			"unionType",
			"unionOrder",
			"startDate",
			"endDate",
			"endReason",
			"sourceCitation",
			"personSourceCitation",
			"altGroupId",
		]);
		const person1Id = uuidField(after.person1Id, "person1Id"),
			person2Id = uuidField(after.person2Id, "person2Id");
		if (person1Id === person2Id)
			throw new Error("A union requires two different people");
		return {
			kind,
			targetId,
			after: {
				person1Id,
				person2Id,
				unionType: oneOf(
					after.unionType,
					[
						"MARRIAGE",
						"PILEGESH",
						"FORBIDDEN_WITH_GENTILE",
						"BANNED_INCEST",
						"BETROTHAL",
					],
					"unionType",
				),
				unionOrder: integer(after.unionOrder, "unionOrder", 1),
				startDate: integer(after.startDate, "startDate"),
				endDate: integer(after.endDate, "endDate"),
				endReason:
					after.endReason == null || after.endReason === ""
						? null
						: oneOf(
								after.endReason,
								["DEATH", "DIVORCE"] as const,
								"endReason",
							),
				sourceCitation: citation(),
				personSourceCitation: optionalText(
					after.personSourceCitation,
					"personSourceCitation",
				),
				altGroupId: alt(),
			},
		};
	}
	if (kind === "place") {
		rejectUnknown(after, [
			"placeId",
			"modernName",
			"latitude",
			"longitude",
			"altGroupId",
		]);
		const latitude = coordinate(after.latitude, "latitude", 90),
			longitude = coordinate(after.longitude, "longitude", 180);
		if ((latitude === null) !== (longitude === null))
			throw new Error("Latitude and longitude must be supplied together");
		return {
			kind,
			targetId,
			after: {
				placeId: uuidField(after.placeId, "placeId"),
				modernName: optionalText(after.modernName, "modernName", 255),
				latitude,
				longitude,
				altGroupId: alt(),
			},
		};
	}
	if (kind === "metadata") {
		rejectUnknown(after, ["displayName"]);
		if (!targetId) throw new Error("metadata requires an existing entity");
		return {
			kind,
			targetId,
			after: { displayName: textField(after.displayName, "displayName") },
		};
	}
	rejectUnknown(after, ["title", "uniqueName", "entityType", "displayName"]);
	const uniqueName = textField(after.uniqueName, "uniqueName").normalize("NFC");
	if (/[/%?#\\]/.test(uniqueName))
		throw new Error("uniqueName must be a plain path segment");
	return {
		kind,
		targetId,
		after: {
			title: textField(after.title, "title"),
			uniqueName,
			entityType: oneOf(
				after.entityType,
				ADMIN_CREATABLE_ENTITY_TYPES,
				"entityType",
			),
			displayName: textField(after.displayName, "displayName"),
		},
	};
}

export function validateChanges(value: unknown): ChangeInput[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 40)
		throw new Error("A PR requires 1-40 typed changes");
	const changes = value.map(validateChange);
	const targets = changes
		.filter((c) => c.targetId)
		.map((c) => `${c.kind}:${c.targetId}`);
	if (new Set(targets).size !== targets.length)
		throw new Error("A target can only appear once per PR");
	return changes;
}

export function reviewStatus(
	pr: Contribution,
): "exempt" | "approved" | "changes_requested" | "required" {
	const revisionAuthor = pr.revisionAuthor ?? pr.author;
	if (revisionAuthor.kind === "human" && revisionAuthor.isDoradsoft)
		return "exempt";
	const review = [...pr.events]
		.reverse()
		.find(
			(event) =>
				event.revision === pr.revision &&
				event.actor.kind === "human" &&
				event.actor.isDoradsoft &&
				["approved", "changes_requested"].includes(event.kind),
		);
	return review?.kind === "approved"
		? "approved"
		: review?.kind === "changes_requested"
			? "changes_requested"
			: "required";
}

export function assertMergeAllowed(pr: Contribution): void {
	if (pr.kind !== "pr" || pr.state !== "open")
		throw new Error("Only an open PR can be merged");
	if (migrationBlocked(pr))
		throw new Error(
			"Couldn't migrate to latest API. Recover the plain sequence before merging.",
		);
	if (
		(pr.changes.length === 0 && pr.apiMigration?.status !== "succeeded") ||
		pr.evidence.length === 0
	)
		throw new Error("A PR requires changes and evidence");
	if (!["exempt", "approved"].includes(reviewStatus(pr)))
		throw new Error("Approval from doradsoft is required for this revision");
}

export function sameState(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}

export function changedFields(change: ReviewedChange): string[] {
	return [
		...new Set([
			...Object.keys(change.before ?? {}),
			...Object.keys(change.after ?? {}),
		]),
	].filter(
		(key) =>
			!sameState(change.before?.[key] ?? null, change.after?.[key] ?? null),
	);
}
