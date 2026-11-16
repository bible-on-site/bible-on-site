import {
	MAX_CITATION_RANGE,
	type ResolvedCitation,
} from "~/lib/article-linking/citations";
import type { PasukCoordinate } from "~/lib/article-linking/types";
import type { ArticleLinkChangeInput } from "./contribution-article-links";
import type { ChangeInput, ReviewedChange } from "./contributions";

/** Captured by trusted article reads, never supplied by model output. */
export interface ArticleLiteralGrounding {
	articleId: string;
	sourceHash: string;
	coordinates: PasukCoordinate[];
	chapters: { id: number; fingerprint: string }[];
}

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function positiveId(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= 2147483647
	);
}

function appendCoordinates(
	result: Map<string, PasukCoordinate>,
	value: unknown,
): void {
	if (!Array.isArray(value)) return;
	for (const raw of value) {
		const point = object(raw);
		if (!point || !positiveId(point.perekId) || !positiveId(point.pasuk))
			continue;
		result.set(`${point.perekId}:${point.pasuk}`, {
			perekId: point.perekId,
			pasuk: point.pasuk,
		});
	}
}

function sorted(result: Map<string, PasukCoordinate>): PasukCoordinate[] {
	return [...result.values()].sort(
		(a, b) => a.perekId - b.perekId || a.pasuk - b.pasuk,
	);
}

/** Expand only resolved, bounded literal ranges, preserving coordinate pairs. */
export function expandLiteralCitationCoordinates(
	citations: readonly Pick<ResolvedCitation, "perekId" | "pasuk" | "pasukTo">[],
): PasukCoordinate[] {
	const result = new Map<string, PasukCoordinate>();
	for (const citation of citations) {
		if (
			!positiveId(citation.perekId) ||
			!positiveId(citation.pasuk) ||
			!positiveId(citation.pasukTo) ||
			citation.pasukTo < citation.pasuk ||
			citation.pasukTo - citation.pasuk >= MAX_CITATION_RANGE
		)
			throw new Error("Invalid literal citation range");
		for (let pasuk = citation.pasuk; pasuk <= citation.pasukTo; pasuk++)
			result.set(`${citation.perekId}:${pasuk}`, {
				perekId: citation.perekId,
				pasuk,
			});
	}
	return sorted(result);
}

/** Existing canonical links and this PR's previous proposals remain editable. */
export function allowedLiteralArticleCoordinates(
	articleId: string,
	current: unknown,
	groundings: readonly ArticleLiteralGrounding[],
	preservedChanges: readonly (ChangeInput | ReviewedChange)[] = [],
): PasukCoordinate[] {
	const result = new Map<string, PasukCoordinate>();
	const state = object(current);
	appendCoordinates(result, state?.coveringSources);
	if (typeof state?.sourceHash === "string") {
		for (const grounding of groundings)
			if (
				grounding.articleId === articleId &&
				grounding.sourceHash === state.sourceHash
			)
				appendCoordinates(result, grounding.coordinates);
	}
	for (const change of preservedChanges) {
		if (change.kind !== "article_links" || change.targetId !== articleId)
			continue;
		const after = object(change.after);
		if (!Array.isArray(after?.commands)) continue;
		for (const raw of after.commands) {
			const command = object(raw);
			if (
				command?.relationshipKey === "coveringSources" &&
				(command.action === "add" || command.action === "replace")
			)
				appendCoordinates(result, object(command.target)?.pasukCoordinates);
		}
	}
	return sorted(result);
}

/** LLM additions need literal support; removals and other link intents do not. */
export function assertLiteralArticleCoverage(
	change: ArticleLinkChangeInput,
	current: unknown,
	groundings: readonly ArticleLiteralGrounding[],
	preservedChanges: readonly (ChangeInput | ReviewedChange)[] = [],
): void {
	const allowed = new Set(
		allowedLiteralArticleCoordinates(
			change.targetId,
			current,
			groundings,
			preservedChanges,
		).map(({ perekId, pasuk }) => `${perekId}:${pasuk}`),
	);
	for (const command of change.after.commands) {
		if (
			command.relationshipKey !== "coveringSources" ||
			(command.action !== "add" && command.action !== "replace")
		)
			continue;
		for (const { perekId, pasuk } of command.target.pasukCoordinates)
			if (!allowed.has(`${perekId}:${pasuk}`))
				throw new Error(
					"Article coverage additions require explicit literal citations",
				);
	}
}
