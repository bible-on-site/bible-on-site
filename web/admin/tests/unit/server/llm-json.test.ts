import { afterEach, describe, expect, it, vi } from "vitest";
import { callOpenAiJson, llmConfigured } from "~/server/llm-json";

const KEY = "OPENAI_API_KEY";
const MODEL = "OPENAI_MODEL";

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env[KEY];
	delete process.env[MODEL];
});

describe("llmConfigured", () => {
	it("is false without a key and true with one", () => {
		expect(llmConfigured()).toBe(false);
		process.env[KEY] = "sk-test";
		expect(llmConfigured()).toBe(true);
	});
});

describe("callOpenAiJson", () => {
	it("throws before any request when the key is missing", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		await expect(
			callOpenAiJson({ system: "s", user: "u" }),
		).rejects.toThrow(/OPENAI_API_KEY/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("posts a canonical JSON body and returns content plus usage", async () => {
		process.env[KEY] = " sk-test ";
		process.env[MODEL] = "mock-model";
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "{}" } }],
				usage: { prompt_tokens: 12, completion_tokens: 3 },
			}),
		});
		vi.stubGlobal("fetch", fetchMock);
		const out = await callOpenAiJson({
			system: "sys",
			user: "usr",
			temperature: 0.1,
		});
		expect(out).toEqual({
			content: "{}",
			model: "mock-model",
			promptTokens: 12,
			completionTokens: 3,
		});
		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			{ headers: Record<string, string>; body: string },
		];
		expect(url).toContain("chat/completions");
		expect(init.headers.Authorization).toBe("Bearer sk-test");
		expect(JSON.parse(init.body).model).toBe("mock-model");
		expect(init.body).toContain('"response_format"');
	});

	it("throws on a non-OK HTTP response", async () => {
		process.env[KEY] = "sk";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				text: async () => "boom",
			}),
		);
		await expect(
			callOpenAiJson({ system: "s", user: "u" }),
		).rejects.toThrow(/HTTP 500/);
	});

	it("throws on an empty choices payload", async () => {
		process.env[KEY] = "sk";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ choices: [] }),
			}),
		);
		await expect(
			callOpenAiJson({ system: "s", user: "u" }),
		).rejects.toThrow(/empty response/);
	});
});
