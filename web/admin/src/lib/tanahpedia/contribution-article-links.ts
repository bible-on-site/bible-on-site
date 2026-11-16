import type { PasukCoordinate } from "~/lib/article-linking/types";
import { canonicalJson } from "~/lib/canonical-json";

/** Article ids belong to the article catalogue, not the encyclopedia UUID space. */
export function contributionArticleId(value: unknown): string {
	if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value))
		throw new Error("article_links.targetId: canonical article ID required");
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number > 2147483647)
		throw new Error("article_links.targetId: invalid article ID");
	return value;
}

export interface ArticleDedicationAssignment {
	dedicationId: number;
	expiresAt: string | null;
}

export type ArticleLinkCommand =
	| {
			relationshipKey: "primaryPerek";
			action: "replace";
			target: { perekId: number };
	  }
	| {
			relationshipKey: "coveringSources";
			action: "add" | "remove" | "replace" | "clear";
			target: {
				pasukCoordinates: PasukCoordinate[];
				coverageVerified?: boolean;
			};
	  }
	| {
			relationshipKey: "dedicationAssignments";
			action: "add" | "remove" | "replace";
			target: ArticleDedicationAssignment;
	  }
	| {
			relationshipKey: "moadim";
			action: "add" | "remove" | "replace" | "clear";
			target: { moedIds: number[] };
	  };

/** Preserve add/remove intent when an unrelated link changes during review. */
export interface ArticleLinkChange {
	commands: ArticleLinkCommand[];
}

export interface ArticleLinkChangeInput {
	kind: "article_links";
	targetId: string;
	after: ArticleLinkChange;
}

/** No prose is executable. The hashes bind evidence and recover interrupted API calls. */
export interface ArticleLinkState {
	contentHash: string;
	sourceHash: string;
	perekId: number;
	authorId: number;
	coverageVerified: boolean;
	coveringSources: PasukCoordinate[];
	dedicationAssignments: ArticleDedicationAssignment[];
	moedIds: number[];
}

function object(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${field}: object required`);
	return value as Record<string, unknown>;
}

function fields(
	value: Record<string, unknown>,
	allowed: readonly string[],
): void {
	for (const key of Object.keys(value))
		if (!allowed.includes(key))
			throw new Error(`Unsupported article-link field: ${key}`);
}

function id(value: unknown, field: string): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > 2147483647
	)
		throw new Error(`${field}: positive catalogue ID required`);
	return value;
}

function list<T>(
	value: unknown,
	field: string,
	parse: (value: unknown) => T,
	max = 1000,
): T[] {
	if (!Array.isArray(value) || value.length > max)
		throw new Error(`${field}: maximum ${max} values`);
	const result = value.map(parse);
	if (new Set(result.map((item) => canonicalJson(item))).size !== result.length)
		throw new Error(`${field}: duplicate values`);
	return result;
}

function coordinates(value: unknown): PasukCoordinate[] {
	return list(value, "pasukCoordinates", (raw) => {
		const input = object(raw, "coordinate");
		fields(input, ["perekId", "pasuk"]);
		return {
			perekId: id(input.perekId, "perekId"),
			pasuk: id(input.pasuk, "pasuk"),
		};
	}).sort((a, b) => a.perekId - b.perekId || a.pasuk - b.pasuk);
}

function catalogueIds(value: unknown): number[] {
	return list(value, "moedIds", (raw) => id(raw, "moedId")).sort(
		(a, b) => a - b,
	);
}

function expiry(value: unknown): string | null {
	if (value == null) return null;
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
	)
		throw new Error("expiresAt: canonical UTC datetime required");
	const instant = new Date(`${value.replace(" ", "T")}Z`);
	if (
		!Number.isFinite(instant.getTime()) ||
		instant.toISOString().slice(0, 19).replace("T", " ") !== value
	)
		throw new Error("expiresAt: invalid UTC datetime");
	return value;
}

function assignment(value: unknown): ArticleDedicationAssignment {
	const input = object(value, "dedication assignment");
	fields(input, ["dedicationId", "expiresAt"]);
	return {
		dedicationId: id(input.dedicationId, "dedicationId"),
		expiresAt: expiry(input.expiresAt),
	};
}

export function validateArticleLinkChange(
	value: unknown,
): ArticleLinkChangeInput {
	const input = object(value, "article link change");
	fields(input, ["kind", "targetId", "after"]);
	if (input.kind !== "article_links")
		throw new Error("Invalid article-link change kind");
	const targetId = contributionArticleId(input.targetId);
	const after = object(input.after, "article link change.after");
	fields(after, ["commands"]);
	const commands = list(
		after.commands,
		"article link commands",
		(raw): ArticleLinkCommand => {
			const command = object(raw, "article link command");
			fields(command, ["relationshipKey", "action", "target"]);
			const target = object(command.target, "article link target");
			if (command.relationshipKey === "primaryPerek") {
				fields(target, ["perekId"]);
				if (command.action !== "replace")
					throw new Error("primaryPerek supports replace only");
				return {
					relationshipKey: "primaryPerek",
					action: "replace",
					target: { perekId: id(target.perekId, "perekId") },
				};
			}
			if (command.relationshipKey === "dedicationAssignments") {
				if (!["add", "remove", "replace"].includes(String(command.action)))
					throw new Error("Unsupported dedication assignment action");
				return {
					relationshipKey: "dedicationAssignments",
					action: command.action as "add" | "remove" | "replace",
					target: assignment(target),
				};
			}
			if (
				!["add", "remove", "replace", "clear"].includes(String(command.action))
			)
				throw new Error("Unsupported article-link action");
			const action = command.action as "add" | "remove" | "replace" | "clear";
			if (command.relationshipKey === "coveringSources") {
				fields(target, ["pasukCoordinates", "coverageVerified"]);
				const pasukCoordinates = coordinates(target.pasukCoordinates);
				if (
					target.coverageVerified !== undefined &&
					typeof target.coverageVerified !== "boolean"
				)
					throw new Error("coverageVerified: boolean required");
				if (
					(action === "add" || action === "remove") &&
					!pasukCoordinates.length
				)
					throw new Error("An add/remove command requires coordinates");
				if (
					action === "clear" &&
					(pasukCoordinates.length || target.coverageVerified === true)
				)
					throw new Error(
						"A clear command cannot carry coverage or verification",
					);
				return {
					relationshipKey: "coveringSources",
					action,
					target: {
						pasukCoordinates,
						...(target.coverageVerified === undefined
							? {}
							: { coverageVerified: target.coverageVerified as boolean }),
					},
				};
			}
			if (command.relationshipKey === "moadim") {
				fields(target, ["moedIds"]);
				const moedIds = catalogueIds(target.moedIds);
				if ((action === "add" || action === "remove") && !moedIds.length)
					throw new Error("An add/remove command requires moed IDs");
				if (action === "clear" && moedIds.length)
					throw new Error("A clear command cannot carry moed IDs");
				return { relationshipKey: "moadim", action, target: { moedIds } };
			}
			throw new Error(
				"Unsupported article relationship; author attribution and pipeline-owned links cannot be changed",
			);
		},
		40,
	);
	if (!commands.length)
		throw new Error("An article-link PR requires at least one command");
	const single = new Set<string>();
	for (const command of commands) {
		const key =
			command.relationshipKey === "dedicationAssignments"
				? `dedication:${command.target.dedicationId}`
				: command.relationshipKey === "primaryPerek"
					? "primaryPerek"
					: null;
		if (key && single.has(key))
			throw new Error("A single-valued article link can only be changed once");
		if (key) single.add(key);
	}
	return { kind: "article_links", targetId, after: { commands } };
}

export function validateArticleLinkState(value: unknown): ArticleLinkState {
	const input = object(value, "article link base");
	fields(input, [
		"contentHash",
		"sourceHash",
		"perekId",
		"authorId",
		"coverageVerified",
		"coveringSources",
		"dedicationAssignments",
		"moedIds",
	]);
	if (
		typeof input.contentHash !== "string" ||
		!/^[0-9a-f]{32}$/.test(input.contentHash) ||
		typeof input.sourceHash !== "string" ||
		!/^[0-9a-f]{64}$/.test(input.sourceHash)
	)
		throw new Error(
			"Article-link base requires exact content and source hashes",
		);
	if (typeof input.coverageVerified !== "boolean")
		throw new Error("coverageVerified: boolean required");
	const coveringSources = coordinates(input.coveringSources);
	if (input.coverageVerified && !coveringSources.length)
		throw new Error("Verified coverage requires at least one coordinate");
	const dedicationAssignments = list(
		input.dedicationAssignments,
		"dedication assignments",
		assignment,
	).sort((a, b) => a.dedicationId - b.dedicationId);
	if (
		new Set(dedicationAssignments.map((a) => a.dedicationId)).size !==
		dedicationAssignments.length
	)
		throw new Error("Duplicate dedication assignment");
	return {
		contentHash: input.contentHash,
		sourceHash: input.sourceHash,
		perekId: id(input.perekId, "perekId"),
		authorId: id(input.authorId, "authorId"),
		coverageVerified: input.coverageVerified,
		coveringSources,
		dedicationAssignments,
		moedIds: catalogueIds(input.moedIds),
	};
}

/** Only link state is projected. Hashes and authoritative uploaded authorship are untouched. */
export function projectArticleLinks(
	base: ArticleLinkState,
	change: ArticleLinkChange,
): ArticleLinkState {
	const next = structuredClone(base);
	for (const command of change.commands) {
		if (command.relationshipKey === "primaryPerek")
			next.perekId = command.target.perekId;
		else if (command.relationshipKey === "coveringSources") {
			const key = (c: PasukCoordinate) => `${c.perekId}:${c.pasuk}`;
			const wanted = new Map(
				command.target.pasukCoordinates.map((c) => [key(c), c]),
			);
			const current = new Map(next.coveringSources.map((c) => [key(c), c]));
			if (command.action === "add")
				for (const [id, coordinate] of wanted) current.set(id, coordinate);
			else if (command.action === "remove")
				for (const id of wanted.keys()) current.delete(id);
			else {
				current.clear();
				if (command.action === "replace")
					for (const [id, coordinate] of wanted) current.set(id, coordinate);
			}
			next.coveringSources = [...current.values()].sort(
				(a, b) => a.perekId - b.perekId || a.pasuk - b.pasuk,
			);
			next.coverageVerified = next.coveringSources.length
				? (command.target.coverageVerified ?? next.coverageVerified)
				: false;
		} else if (command.relationshipKey === "dedicationAssignments") {
			const index = next.dedicationAssignments.findIndex(
				(a) => a.dedicationId === command.target.dedicationId,
			);
			if (command.action === "remove")
				next.dedicationAssignments = next.dedicationAssignments.filter(
					(a) => a.dedicationId !== command.target.dedicationId,
				);
			else if (command.action === "add" && index < 0)
				next.dedicationAssignments.push({ ...command.target });
			else if (command.action === "replace") {
				if (index < 0)
					throw new Error(
						"Cannot replace a dedication assignment that does not exist",
					);
				next.dedicationAssignments[index] = { ...command.target };
			}
			next.dedicationAssignments.sort(
				(a, b) => a.dedicationId - b.dedicationId,
			);
		} else {
			const ids = new Set(next.moedIds);
			if (command.action === "add")
				for (const id of command.target.moedIds) ids.add(id);
			else if (command.action === "remove")
				for (const id of command.target.moedIds) ids.delete(id);
			else {
				ids.clear();
				if (command.action === "replace")
					for (const id of command.target.moedIds) ids.add(id);
			}
			next.moedIds = [...ids].sort((a, b) => a - b);
		}
	}
	return next;
}

export function articleLinksHaveEffect(
	base: ArticleLinkState,
	change: ArticleLinkChange,
): boolean {
	return (
		canonicalJson(base) !== canonicalJson(projectArticleLinks(base, change))
	);
}
