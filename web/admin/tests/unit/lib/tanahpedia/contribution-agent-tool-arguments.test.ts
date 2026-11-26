import { describe, expect, it } from "vitest";
import { CONTRIBUTION_AGENT_READ_KINDS } from "~/lib/tanahpedia/contribution-agent-read-kinds";
import { validateContributionAgentToolArguments } from "~/lib/tanahpedia/contribution-agent-tool-arguments";
import {
	CONTRIBUTION_AGENT_TOOL_ERRORS,
	ContributionAgentToolInputError,
	contributionAgentToolErrorResult,
} from "~/lib/tanahpedia/contribution-agent-tool-errors";

const id = "00000000-0000-4000-8000-000000000001";
describe("finite current-call read argument rejection", () => {
	it.each([
		["related", {}],
		["related", { section: "history", id, cursor: 3, limit: 50 }],
		["related", { section: "discussion", id }],
		["discussion", { source: "issue", filter: "pending_feedback", limit: 50 }],
		["discussion", { source: "item", filter: "all" }],
		["history", { cursor: 2 }],
		["article_text", { id: "19", limit: 16000, citationLimit: 50 }],
		[
			"scripture_occurrences",
			{ spellings: ["ים סוף", "ים־סוף"], book: "שמות", limit: 100 },
		],
		["scripture_chapter", { perekId: 51, cursor: 2, limit: 25 }],
		["place_profile_words", { id, cursor: 3, limit: 50 }],
		["record", { kind: "target:article_links", id: 19 }],
		["record", { kind: "article", id: "19" }],
		["record", { kind: "entity", id }],
		["record", { kind: "perek", id: 1 }],
	])("accepts declared %s arguments without retargeting", (name, args) => {
		expect(validateContributionAgentToolArguments(name as string, args)).toBe(
			args,
		);
	});
	it("keeps every declared search kind and existing reference identifier vocabulary", () => {
		for (const kind of CONTRIBUTION_AGENT_READ_KINDS) {
			expect(
				validateContributionAgentToolArguments("search", { kind, query: "" }),
			).toEqual({ kind, query: "" });
			const recordId =
				kind === "target:article_links" ||
				["article", "article_author", "dedication", "moed"].includes(kind)
					? "19"
					: kind.startsWith("target:")
						? id
						: 1;
			expect(
				validateContributionAgentToolArguments("record", {
					kind,
					id: recordId,
				}),
			).toEqual({ kind, id: recordId });
		}
	});
	it.each([
		["record", null],
		["record", []],
		["history", { sql: "private SQL" }],
		["record", { kind: "source", id }],
		["record", { id }],
		["record", { kind: "entity", id: 0 }],
		["record", { kind: "entity", id: "" }],
		["record", { kind: "entity", id: "x".repeat(256) }],
		["record", { kind: "target:metadata", id: 1 }],
		["search", { kind: "perek", query: 1 }],
		["search", { kind: "perek", query: "x".repeat(256) }],
		["search", { kind: "perek", query: "", cursor: -1 }],
		["search", { kind: "perek", query: "", cursor: 0.5 }],
		["history", { limit: 51 }],
		["history", { limit: 0 }],
		["history", { limit: "1" }],
		["discussion", { source: "other" }],
		["discussion", { source: "item", filter: "sql" }],
		["related", { section: "private" }],
		["related", { section: "items", id }],
		["related", { section: "history", id: "19" }],
		["article_text", { id: "19", limit: 16001 }],
		["article_text", { id: "19", citationCursor: -1 }],
		["article_text", { id: "19", citationLimit: 51 }],
		["scripture_occurrences", { spellings: [] }],
		["scripture_occurrences", { spellings: Array(13).fill("מצרים") }],
		["scripture_occurrences", { spellings: ["  "] }],
		["scripture_occurrences", { spellings: [7] }],
		["scripture_occurrences", { spellings: ["מצרים"], book: null }],
		["scripture_occurrences", { spellings: ["מצרים"], limit: 101 }],
		["scripture_occurrences", { spellings: ["מצרים"], useAll: true }],
		["scripture_chapter", { perekId: "51" }],
		["scripture_chapter", { perekId: 0 }],
		["scripture_chapter", { perekId: 51, limit: 26 }],
		["place_profile_words", { limit: 51 }],
		["place_profile_words", { cursor: null }],
		["place_profile_words", { id: "not a proposal identifier" }],
	])("rejects invalid %s input using fixed bounded feedback", (name, args) => {
		expect(() =>
			validateContributionAgentToolArguments(name as string, args),
		).toThrow(CONTRIBUTION_AGENT_TOOL_ERRORS.invalid_arguments);
	});
	it.each([
		["record", { kind: "target:article_links", id }],
		["record", { kind: "article", id }],
		["record", { kind: "moed", id: "01" }],
		["record", { kind: "article_author", id: "2147483648" }],
		["article_text", { id }],
		["article_text", { id: 19 }],
	])("distinguishes wrong article identifiers for %s", (name, args) => {
		expect(() =>
			validateContributionAgentToolArguments(name as string, args),
		).toThrow(CONTRIBUTION_AGENT_TOOL_ERRORS.invalid_article_id);
	});
	it("leaves undeclared capabilities fatal and never emits raw input or error messages", () => {
		try {
			validateContributionAgentToolArguments("sql", {});
		} catch (error) {
			expect(error).not.toBeInstanceOf(ContributionAgentToolInputError);
		}
		for (const reason of Object.keys(
			CONTRIBUTION_AGENT_TOOL_ERRORS,
		) as (keyof typeof CONTRIBUTION_AGENT_TOOL_ERRORS)[]) {
			const error = new ContributionAgentToolInputError(reason);
			error.message = "private SQL and source data";
			expect(error).not.toHaveProperty("code");
			expect(contributionAgentToolErrorResult(error)).toEqual({
				error: {
					type: "invalid_tool_arguments",
					code: reason,
					message: CONTRIBUTION_AGENT_TOOL_ERRORS[reason],
				},
			});
			expect(Object.keys(contributionAgentToolErrorResult(error))).toEqual([
				"error",
			]);
		}
	});
});
