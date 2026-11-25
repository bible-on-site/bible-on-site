import { expect, it, vi } from "vitest";

vi.mock("~/server/db", () => {
	throw new Error("Pure bundle imported database");
});
vi.mock("~/server/tanahpedia/contribution-agent-runtime.server", () => {
	throw new Error("Pure bundle started runtime");
});
vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	throw new Error("Pure bundle imported model execution");
});

import {
	CONTRIBUTION_AGENT_READ_KINDS,
	CONTRIBUTION_AGENT_REFERENCE_KINDS,
	CONTRIBUTION_AGENT_TARGET_KINDS,
	isContributionAgentReadKind,
} from "~/lib/tanahpedia/contribution-agent-read-kinds";
import { buildContributionAgentBundle } from "~/server/tanahpedia/contribution-agent-bundle.server";

it("builds immutable declarations without a database, model client or runtime", () => {
	expect(buildContributionAgentBundle().version).toBe("tanahpedia-agents-v14");
	expect(CONTRIBUTION_AGENT_REFERENCE_KINDS).toHaveLength(28);
	expect(CONTRIBUTION_AGENT_TARGET_KINDS).toHaveLength(48);
	expect(CONTRIBUTION_AGENT_READ_KINDS).toHaveLength(76);
	expect(new Set(CONTRIBUTION_AGENT_READ_KINDS).size).toBe(76);
	expect(Object.isFrozen(CONTRIBUTION_AGENT_READ_KINDS)).toBe(true);
	for (const kind of CONTRIBUTION_AGENT_READ_KINDS)
		expect(isContributionAgentReadKind(kind)).toBe(true);
	for (const kind of [
		undefined,
		null,
		{},
		1,
		"source",
		"target:source",
		"target:person",
		"perek;DROP TABLE x",
	])
		expect(isContributionAgentReadKind(kind)).toBe(false);
});
