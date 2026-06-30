import { createServerFn } from "@tanstack/react-start";
import { getTanahpediaSchemaSummaryForLlm } from "~/lib/tanahpedia/schema-registry";
import { loadTanahpediaEntryById } from "./entries";
import { loadEntryStructuralContext } from "./structural";

/** פלט מוצע בלבד — ללא הרצת SQL או כתיבה ל־DB על ידי המודל */
export interface TanahpediaLlmProposal {
	entry?: {
		title?: string;
		unique_name?: string;
		contentHtml?: string;
	};
	linkedEntities?: Array<{
		entityId: string;
		displayName?: string;
		person?: {
			mainName?: string;
			sex?: "MALE" | "FEMALE" | "UNKNOWN";
		};
		place?: {
			identifications?: Array<{
				id?: string;
				modern_name?: string | null;
				latitude?: number | null;
				longitude?: number | null;
			}>;
		};
	}>;
	notesForEditor?: string;
}

export function buildTanahpediaAssistantSystemPrompt(): string {
	const schema = getTanahpediaSchemaSummaryForLlm();
	return [
		"You are an assistant for Tanahpedia (Jewish encyclopedia) ADMIN editing.",
		"Hebrew is the primary content language.",
		"",
		"CRITICAL CONSTRAINTS:",
		"- You do NOT have database access. Never output SQL.",
		"- Output a SINGLE JSON object matching the user's schema request.",
		"- Only suggest fields that are reasonable from context; omit keys you are unsure about.",
		"- For HTML content: preserve semantic structure; use valid HTML fragments suitable for a rich editor.",
		"- linkedEntities[].entityId MUST be one of the entity UUIDs provided in the user message context.",
		"",
		schema,
		"",
		"OUTPUT JSON shape (all optional except structure):",
		JSON.stringify(
			{
				entry: {
					title: "string?",
					unique_name: "string?",
					contentHtml: "string? (full or partial HTML body)",
				},
				linkedEntities: [
					{
						entityId: "uuid",
						displayName: "string? (maps to tanahpedia_entity.name)",
						person: {
							mainName: "string?",
							sex: "MALE | FEMALE | UNKNOWN?",
						},
						place: {
							identifications: [
								{
									id: "existing uuid or omit for new",
									modern_name: "string|null",
									latitude: "number|null",
									longitude: "number|null",
								},
							],
						},
					},
				],
				notesForEditor: "string? — short rationale in Hebrew or English",
			},
			null,
			2,
		),
	].join("\n");
}

export interface SuggestEditsInput {
	entryId: string;
	userInstruction: string;
	/** תוכן HTML טיוטה מהעורך (כולל שינויים שלא נשמרו) */
	draftContentHtml: string;
	draftTitle?: string;
	draftUniqueName?: string;
}

async function callOpenAiJson(params: {
	system: string;
	user: string;
}): Promise<string> {
	const apiKey = process.env.OPENAI_API_KEY?.trim();
	if (!apiKey) {
		throw new Error(
			"OPENAI_API_KEY אינו מוגדר — הגדר במשתני סביבה (שרת אדמין בלבד)",
		);
	}
	const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			temperature: 0.3,
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
	};
	const content = body.choices?.[0]?.message?.content;
	if (!content) throw new Error("OpenAI: empty response");
	return content;
}

function safeParseProposal(json: string): TanahpediaLlmProposal {
	try {
		return JSON.parse(json) as TanahpediaLlmProposal;
	} catch {
		throw new Error("המודל החזיר JSON לא תקין");
	}
}

export const suggestTanahpediaEntryEdits = createServerFn({ method: "POST" })
	.inputValidator((data: SuggestEditsInput) => data)
	.handler(async ({ data }) => {
		const [entryRow, structural] = await Promise.all([
			loadTanahpediaEntryById(data.entryId),
			loadEntryStructuralContext(data.entryId),
		]);
		if (!entryRow) throw new Error("Entry not found");

		const contextPayload = {
			entry: {
				id: entryRow.id,
				title: data.draftTitle ?? entryRow.title,
				unique_name: data.draftUniqueName ?? entryRow.unique_name,
			},
			linkedEntities: structural.linkedEntities.map((e) => ({
				linkId: e.linkId,
				entityId: e.entityId,
				entityType: e.entityType,
				displayName: e.displayName,
				person: e.person
					? {
							mainName: e.person.mainName,
							sex: e.person.sex,
						}
					: undefined,
				place: e.place
					? {
							identifications: e.place.identifications,
						}
					: undefined,
			})),
		};

		const userMessage = [
			"=== Current entry (DB + draft overrides) ===",
			JSON.stringify(contextPayload, null, 2),
			"",
			"=== Entry body HTML (source string as in editor; this is the WYSIWYG document) ===",
			data.draftContentHtml || "(empty)",
			"",
			"=== Editor instruction ===",
			data.userInstruction.trim(),
		].join("\n");

		const raw = await callOpenAiJson({
			system: buildTanahpediaAssistantSystemPrompt(),
			user: userMessage,
		});

		const proposal = safeParseProposal(raw);

		const allowed = new Set(structural.linkedEntities.map((e) => e.entityId));
		if (proposal.linkedEntities?.length) {
			for (const le of proposal.linkedEntities) {
				if (!allowed.has(le.entityId)) {
					throw new Error(
						`ההצעה מזכירה entityId שלא מקושר לערך: ${le.entityId}`,
					);
				}
			}
		}

		return { proposal, rawJson: raw };
	});
