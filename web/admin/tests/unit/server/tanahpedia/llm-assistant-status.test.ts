import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadEntryMock, loadStructuralMock } = vi.hoisted(() => ({
	loadEntryMock: vi.fn(),
	loadStructuralMock: vi.fn(),
}));

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
	getTanahpediaSchemaSummaryForLlm: () => "SCHEMA SUMMARY",
}));
vi.mock("~/server/tanahpedia/entry-loader.server", () => ({
	loadTanahpediaEntryById: loadEntryMock,
}));
vi.mock("~/server/tanahpedia/structural-loader.server", () => ({
	loadEntryStructuralContext: loadStructuralMock,
}));

import {
	buildTanahpediaAssistantSystemPrompt,
	getLlmAssistantStatus,
	suggestTanahpediaEntryEdits,
} from "~/server/tanahpedia/llm-assistant";

const suggestionInput = {
	data: {
		entryId: "entry-1",
		userInstruction: "  תקן את הכותרת  ",
		draftContentHtml: "<p>טיוטה</p>",
		draftTitle: "כותרת טיוטה",
		draftUniqueName: "שם-טיוטה",
	},
};

function stubOpenAiResponse(content: string | undefined) {
	const fetchMock = vi.fn().mockResolvedValue({
		ok: true,
		json: vi.fn().mockResolvedValue({
			choices: content === undefined ? [] : [{ message: { content } }],
		}),
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("getLlmAssistantStatus", () => {
	const originalKey = process.env.OPENAI_API_KEY;
	const originalModel = process.env.OPENAI_MODEL;

	beforeEach(() => {
		process.env.OPENAI_API_KEY = "";
		delete process.env.OPENAI_MODEL;
		loadEntryMock.mockReset();
		loadStructuralMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = originalKey;
		if (originalModel === undefined) delete process.env.OPENAI_MODEL;
		else process.env.OPENAI_MODEL = originalModel;
	});

	describe("when no api key is configured", () => {
		it("reports the assistant as disabled", async () => {
			delete process.env.OPENAI_API_KEY;
			await expect(getLlmAssistantStatus()).resolves.toEqual({
				enabled: false,
			});
		});

		it("treats a blank key as disabled", async () => {
			process.env.OPENAI_API_KEY = "   ";
			await expect(getLlmAssistantStatus()).resolves.toEqual({
				enabled: false,
			});
		});
	});

	describe("when an api key is configured", () => {
		it("reports the assistant as enabled", async () => {
			process.env.OPENAI_API_KEY = "sk-test";
			await expect(getLlmAssistantStatus()).resolves.toEqual({ enabled: true });
		});
	});

	describe("assistant prompt", () => {
		it("documents the JSON-only contract and embeds the schema", () => {
			const prompt = buildTanahpediaAssistantSystemPrompt();

			expect(prompt).toContain("SCHEMA SUMMARY");
			expect(prompt).toContain("Never output SQL");
			expect(prompt).toContain('"linkedEntities"');
		});
	});

	describe("entry suggestions", () => {
		beforeEach(() => {
			process.env.OPENAI_API_KEY = "sk-test";
			loadEntryMock.mockResolvedValue({
				id: "entry-1",
				title: "כותרת שמורה",
				unique_name: "שם-שמור",
			});
			loadStructuralMock.mockResolvedValue({
				entryId: "entry-1",
				linkedEntities: [
					{
						linkId: "link-person",
						entityId: "entity-person",
						entityType: "PERSON",
						displayName: "משה",
						person: { mainName: "משה", sex: "MALE" },
						place: null,
					},
					{
						linkId: "link-place",
						entityId: "entity-place",
						entityType: "PLACE",
						displayName: "ירושלים",
						person: null,
						place: { identifications: [] },
					},
				],
			});
		});

		it("sends draft context and returns a validated proposal", async () => {
			process.env.OPENAI_MODEL = "gpt-test";
			const rawJson =
				'{"entry":{"title":"כותרת מוצעת"},"linkedEntities":[{"entityId":"entity-person","displayName":"משה רבנו"}]}';
			const fetchMock = stubOpenAiResponse(rawJson);

			await expect(suggestTanahpediaEntryEdits(suggestionInput)).resolves.toEqual({
				proposal: {
					entry: { title: "כותרת מוצעת" },
					linkedEntities: [
						{ entityId: "entity-person", displayName: "משה רבנו" },
					],
				},
				rawJson,
			});
			expect(loadEntryMock).toHaveBeenCalledWith("entry-1");
			expect(loadStructuralMock).toHaveBeenCalledWith("entry-1");
			const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
			const body = JSON.parse(String(request.body));
			expect(body.model).toBe("gpt-test");
			expect(body.messages[1].content).toContain("כותרת טיוטה");
			expect(body.messages[1].content).toContain("תקן את הכותרת");
		});

		it("requires a configured API key", async () => {
			delete process.env.OPENAI_API_KEY;
			await expect(suggestTanahpediaEntryEdits(suggestionInput)).rejects.toThrow(
				"OPENAI_API_KEY אינו מוגדר",
			);
		});

		it("reports an upstream HTTP error", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn().mockResolvedValue({
					ok: false,
					status: 429,
					text: vi.fn().mockResolvedValue("rate limited"),
				}),
			);

			await expect(suggestTanahpediaEntryEdits(suggestionInput)).rejects.toThrow(
				"OpenAI HTTP 429: rate limited",
			);
		});

		it("rejects empty and malformed model responses", async () => {
			stubOpenAiResponse(undefined);
			await expect(suggestTanahpediaEntryEdits(suggestionInput)).rejects.toThrow(
				"OpenAI: empty response",
			);

			stubOpenAiResponse("not json");
			await expect(suggestTanahpediaEntryEdits(suggestionInput)).rejects.toThrow(
				"המודל החזיר JSON לא תקין",
			);
		});

		it("rejects proposals for entities outside the entry", async () => {
			stubOpenAiResponse(
				'{"linkedEntities":[{"entityId":"entity-unlinked"}]}',
			);

			await expect(suggestTanahpediaEntryEdits(suggestionInput)).rejects.toThrow(
				"entityId שלא מקושר לערך: entity-unlinked",
			);
		});

		it("fails before calling the model when the entry is missing", async () => {
			loadEntryMock.mockResolvedValue(null);
			const fetchMock = stubOpenAiResponse("{}");

			await expect(suggestTanahpediaEntryEdits(suggestionInput)).rejects.toThrow(
				"Entry not found",
			);
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});
});
