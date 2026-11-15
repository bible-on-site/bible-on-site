import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "~/lib/canonical-json";
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
	});
	it("declares complete read tools separately from typed output and authority", () => {
		const bundle = buildContributionAgentBundle();
		expect(bundle.tools.map((tool) => tool.name)).toEqual([
			"related",
			"discussion",
			"history",
			"search",
			"record",
		]);
		expect(
			bundle.operationGuide.some((guide) => guide.startsWith("entry_title ")),
		).toBe(true);
		const system = contributionAgentSystem(bundle);
		expect(system).toContain("SAME PR");
		expect(system).toContain("no SQL");
		expect(system).toContain("Human review is mandatory");
		expect(system).toContain("not a truncated discussion");
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
