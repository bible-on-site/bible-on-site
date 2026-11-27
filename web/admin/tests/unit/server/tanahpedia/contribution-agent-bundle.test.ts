import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
import { CONTRIBUTION_AGENT_READ_KINDS } from "~/lib/tanahpedia/contribution-agent-read-kinds";
import { CONTRIBUTION_API_VERSION } from "~/lib/tanahpedia/contribution-api";
import { buildContributionAgentBundle } from "~/server/tanahpedia/contribution-agent-bundle.server";
import {
	contributionAgentActionSchema,
	contributionAgentSystem,
} from "~/server/tanahpedia/contribution-agent-protocol";

describe("versioned contribution agent declarations", () => {
	it("has a stable content address independent of dynamic contribution data", () => {
		const { hash, ...bundle } = buildContributionAgentBundle();
		expect(hash).toBe(
			createHash("sha256").update(canonicalJson(bundle)).digest("hex"),
		);
		expect(buildContributionAgentBundle()).toEqual({ ...bundle, hash });
		expect(bundle.apiVersion).toBe(CONTRIBUTION_API_VERSION);
		expect(bundle.protocolVersion).toBe(2);
		expect(bundle.version).toBe("tanahpedia-agents-v15");
	});
	it("closes search and record vocabulary without discarding the other parameter constraints", () => {
		const original = buildContributionAgentBundle();
		for (const name of ["search", "record"]) {
			const tool = original.tools.find((tool) => tool.name === name);
			expect(tool?.inputSchema).toMatchObject({
				type: "object",
				additionalProperties: false,
				properties: {
					kind: { type: "string", enum: [...CONTRIBUTION_AGENT_READ_KINDS] },
				},
			});
		}
		const search = original.tools.find(
			(tool) => tool.name === "search",
		)?.inputSchema;
		expect(search).toMatchObject({
			required: ["kind", "query"],
			properties: { limit: { maximum: 50 }, query: { maxLength: 255 } },
		});
		if (!search) throw new Error("Missing search declaration");
		const kind = (search.properties as { kind: { enum: string[] } }).kind;
		kind.enum.push("source");
		expect(buildContributionAgentBundle().hash).toBe(original.hash);
		expect(buildContributionAgentBundle().system).toContain(
			"already-completed reads",
		);
		expect(buildContributionAgentBundle().operationGuide.join("\n")).toContain(
			"search kind perek",
		);
	});
	it("declares complete read tools separately from typed output and authority", () => {
		const bundle = buildContributionAgentBundle();
		expect(bundle.tools.map((tool) => tool.name)).toEqual([
			"related",
			"discussion",
			"history",
			"search",
			"record",
			"article_text",
			"scripture_occurrences",
			"scripture_chapter",
			"place_profile_words",
		]);
		expect(
			bundle.operationGuide.some((guide) => guide.startsWith("entry_title ")),
		).toBe(true);
		const system = contributionAgentSystem(bundle);
		expect(system).toContain("SAME PR");
		expect(system).toContain("no SQL");
		expect(system).toContain("Human review is mandatory");
		expect(system).toContain("not a truncated discussion");
		expect(system).toContain("single article_links change and a separate PR");
		expect(system).toContain(
			"When a human explicitly requests quoted text verbatim in a supported editable field, copy that text exactly byte-for-byte",
		);
		expect(system).toContain(
			"Do not translate, paraphrase, correct or normalize it. Preserve all unrequested fields.",
		);
		expect(system).toContain(
			"Repeated identical trusted reads do not add evidence.",
		);
		expect(system).toContain(
			"return clarification naming what is missing rather than inventing facts.",
		);
		expect(
			bundle.tools.find((tool) => tool.name === "article_text")?.inputSchema,
		).toMatchObject({
			properties: {
				citationCursor: { type: "integer", minimum: 0 },
				citationLimit: { type: "integer", minimum: 1, maximum: 50 },
			},
		});
		expect(bundle.system).toContain("returned integer perekId/pasuk/pasukTo");
	});
	it("guides occurrence searches to the exact Sefer or Additional returned by the Perek reader", () => {
		const { tools } = buildContributionAgentBundle();
		const tool = tools.find((tool) => tool.name === "scripture_occurrences");
		expect(tool?.description).toContain(
			"copy the book field from a scripture_chapter result",
		);
		expect(tool?.inputSchema).toMatchObject({
			properties: {
				book: {
					description: expect.stringContaining(
						"שמואל, מלכים, and דברי הימים each search both Additionals. Search עזרא and נחמיה separately",
					),
				},
			},
		});
		expect(
			tools.find((tool) => tool.name === "scripture_chapter")?.description,
		).toContain("Pesukim in a Perek");
	});
	it("permits only declared tool action shapes and the supplied final decoder schema", () => {
		const bundle = buildContributionAgentBundle(),
			resultSchema = { type: "object", title: "current context" };
		const schema = contributionAgentActionSchema(bundle, resultSchema);
		expect(schema.oneOf).toHaveLength(bundle.tools.length + 1);
		expect(schema.oneOf[1].properties).toMatchObject({
			action: { const: "tool" },
			name: { const: "discussion" },
		});
		expect(schema.oneOf.at(-1)?.properties).toEqual({
			action: { const: "complete" },
			result: resultSchema,
		});
		expect(
			schema.oneOf.every((variant) => variant.additionalProperties === false),
		).toBe(true);
	});
});
