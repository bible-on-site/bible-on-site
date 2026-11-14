/**
 * The one server-side OpenAI JSON caller — shared by the Tanahpedia
 * assistant and the article-linking draft pipeline (#3103). Credentials
 * stay server-only (`OPENAI_API_KEY`/`OPENAI_MODEL`); callers get the raw
 * JSON string plus provider-reported usage for provenance.
 */
import { canonicalJson } from "~/lib/canonical-json";
export interface OpenAiJsonResult {
	content: string;
	/** The model the call actually ran on — recorded as proposal provenance. */
	model: string;
	promptTokens: number | null;
	completionTokens: number | null;
}

export function llmConfigured(): boolean {
	return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function callOpenAiJson(params: {
	system: string;
	user: string;
	temperature?: number;
}): Promise<OpenAiJsonResult> {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		throw new Error(
			"OPENAI_API_KEY אינו מוגדר - הגדר במשתני סביבה (שרת אדמין בלבד)",
		);
	}
	const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		// canonicalJson: the request body is byte-stable across key orderings.
		body: canonicalJson({
			model,
			temperature: params.temperature ?? 0.3,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: params.system },
				{ role: "user", content: params.user },
			],
		}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 500)}`);
	}
	const body = (await res.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
		usage?: { prompt_tokens?: number; completion_tokens?: number };
	};
	const content = body.choices?.[0]?.message?.content;
	if (!content) throw new Error("OpenAI: empty response");
	return {
		content,
		model,
		promptTokens: body.usage?.prompt_tokens ?? null,
		completionTokens: body.usage?.completion_tokens ?? null,
	};
}
