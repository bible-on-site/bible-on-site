import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
	createServerFn: () => ({
		validator: (validate: (data: unknown) => unknown) => ({
			handler:
				(fn: (args: { data: unknown }) => unknown) =>
				(args: { data: unknown }) =>
					fn({ data: validate(args.data) }),
		}),
		handler: (fn: () => unknown) => () => fn(),
	}),
}));

vi.mock("~/lib/tanahpedia/schema-registry", () => ({
	getTanahpediaSchemaSummaryForLlm: () => "",
}));
vi.mock("~/server/tanahpedia/entry-loader.server", () => ({
	loadTanahpediaEntryById: vi.fn(),
}));
vi.mock("~/server/tanahpedia/structural-loader.server", () => ({
	loadEntryStructuralContext: vi.fn(),
}));

import { getLlmAssistantStatus } from "~/server/tanahpedia/llm-assistant";

describe("getLlmAssistantStatus", () => {
	const originalKey = process.env.OPENAI_API_KEY;

	beforeEach(() => {
		process.env.OPENAI_API_KEY = "";
	});

	afterEach(() => {
		if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = originalKey;
	});

	describe("when no api key is configured", () => {
		it("reports the assistant as disabled", async () => {
			delete process.env.OPENAI_API_KEY;
			await expect(getLlmAssistantStatus()).resolves.toEqual({ enabled: false });
		});

		it("treats a blank key as disabled", async () => {
			process.env.OPENAI_API_KEY = "   ";
			await expect(getLlmAssistantStatus()).resolves.toEqual({ enabled: false });
		});
	});

	describe("when an api key is configured", () => {
		it("reports the assistant as enabled", async () => {
			process.env.OPENAI_API_KEY = "sk-test";
			await expect(getLlmAssistantStatus()).resolves.toEqual({ enabled: true });
		});
	});
});
