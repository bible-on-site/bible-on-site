import { isContributionAgentReadKind } from "./contribution-agent-read-kinds";
import { ContributionAgentToolInputError } from "./contribution-agent-tool-errors";
import { contributionArticleId } from "./contribution-article-links";
import { contributionRecordId } from "./contribution-identifiers";

const FIELDS: Record<string, readonly string[]> = {
	discussion: ["source", "filter", "cursor", "limit"],
	history: ["cursor", "limit"],
	search: ["kind", "query", "cursor", "limit"],
	record: ["kind", "id"],
	related: ["cursor", "limit", "id", "section"],
	article_text: ["id", "cursor", "limit", "citationCursor", "citationLimit"],
};
const ARTICLE_REFERENCES = new Set([
	"article",
	"article_author",
	"dedication",
	"moed",
]);

function page(cursor: unknown, limit: unknown, max: number) {
	if (
		typeof cursor !== "number" ||
		!Number.isSafeInteger(cursor) ||
		cursor < 0 ||
		typeof limit !== "number" ||
		!Number.isInteger(limit) ||
		limit < 1 ||
		limit > max
	)
		throw new Error("Invalid read page");
}

function articleId(id: unknown) {
	try {
		contributionArticleId(id);
	} catch {
		throw new ContributionAgentToolInputError("invalid_article_id");
	}
}

/** Pure current-call validation; never pass stored records or replay exceptions through this boundary. */
export function validateContributionAgentToolArguments(
	name: string,
	raw: unknown,
): Record<string, unknown> {
	if (!Object.hasOwn(FIELDS, name))
		throw new Error("Unsupported contribution agent tool");
	try {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			throw new Error("Invalid read arguments");
		const args = raw as Record<string, unknown>;
		if (Object.keys(args).some((key) => !FIELDS[name].includes(key)))
			throw new Error("Unsupported read argument");
		if (name === "article_text") {
			articleId(args.id);
			page(args.cursor ?? 0, args.limit ?? 4000, 16000);
			page(args.citationCursor ?? 0, args.citationLimit ?? 25, 50);
		} else if (name === "related") {
			page(args.cursor ?? 0, args.limit ?? 25, 50);
			const section = args.section ?? "items";
			if (
				section !== "items" &&
				section !== "discussion" &&
				section !== "history"
			)
				throw new Error("Invalid related section");
			if (section === "items") {
				if (args.id !== undefined)
					throw new Error("Unexpected related identifier");
			} else contributionRecordId(args.id, "id");
		} else if (name === "discussion" || name === "history") {
			page(args.cursor ?? 0, args.limit ?? 25, 50);
			if (name === "discussion") {
				if (args.source !== "item" && args.source !== "issue")
					throw new Error("Invalid discussion source");
				if (
					args.filter !== undefined &&
					args.filter !== "all" &&
					args.filter !== "pending_feedback"
				)
					throw new Error("Invalid discussion filter");
			}
		} else {
			if (!isContributionAgentReadKind(args.kind))
				throw new Error("Unsupported read kind");
			if (name === "record") {
				const id = args.id;
				if (
					!(typeof id === "number" && Number.isSafeInteger(id) && id > 0) &&
					!(typeof id === "string" && id.length > 0 && id.length <= 255)
				)
					throw new Error("Invalid read identifier");
				if (
					args.kind === "target:article_links" ||
					ARTICLE_REFERENCES.has(args.kind)
				)
					articleId(typeof id === "number" ? String(id) : id);
				else if (args.kind.startsWith("target:"))
					contributionRecordId(id, "id");
			} else {
				page(args.cursor ?? 0, args.limit ?? 25, 50);
				if (typeof args.query !== "string" || args.query.length > 255)
					throw new Error("Invalid catalogue search");
			}
		}
		return args;
	} catch (error) {
		if (error instanceof ContributionAgentToolInputError) throw error;
		throw new ContributionAgentToolInputError("invalid_arguments");
	}
}
