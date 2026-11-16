import {
	allowedLiteralArticleCoordinates,
	assertLiteralArticleCoverage,
} from "~/lib/tanahpedia/contribution-article-grounding";
import type { ArticleLinkChangeInput } from "~/lib/tanahpedia/contribution-article-links";
import type { Contribution } from "~/lib/tanahpedia/contributions";
import type { ModelCatalogue } from "./contribution-llm.server";

export const ARTICLE_LINK_AGENT_GUIDE =
	"article_links: existing decimal article targetId required; after:{commands:[{relationshipKey,action,target}]}. Keep all commands for one article in a single article_links change and a separate PR; do not mix article_links with other change kinds. primaryPerek:replace {perekId}; coveringSources:add|remove|replace|clear {pasukCoordinates:[{perekId,pasuk}]}; dedicationAssignments:add|remove|replace {dedicationId,expiresAt?:UTC datetime|null}; moadim:add|remove|replace|clear {moedIds:number[]}. Use supplied perek/dedication/moed IDs only. New coveringSources add/replace coordinates must be exact paired points from this article's resolved literal citations; semantic meaning-only links are deferred. Ranges expand deterministically. Retain existing canonical/current-PR proposed points when preserving a sequence. If an explicit citation is unresolved, clarify instead of guessing; removal/clear and other metadata keep their normal validation. Reuse chapter IDs already supplied by currentRecords or catalogue. When a chapter identity is missing, search kind perek with its book/chapter label, then use its returned id for the appropriate perekId field and an integer pasuk verse number. currentRecords targets are already read; article_text supplies the remaining paged source prose. Never include coverageVerified, author attribution, article prose or pipeline-owned links.";

function referenceIds(catalogue: ModelCatalogue, family: string): number[] {
	return [
		...new Set(
			(catalogue.references?.[family] ?? []).flatMap((row) => {
				const id = Number(row.id);
				return Number.isSafeInteger(id) &&
					id > 0 &&
					id <= 2147483647 &&
					String(id) === String(row.id)
					? [id]
					: [];
			}),
		),
	];
}

function object(properties: Record<string, unknown>, required: string[]) {
	return { type: "object", additionalProperties: false, properties, required };
}

/** Generated links can use read catalogue identities, never verification authority. */
export function agentArticleLinkVariant(
	catalogue: ModelCatalogue,
	preservedChanges: Contribution["changes"] = [],
) {
	const targets = catalogue.targets
		.filter((target) => target.kind === "article_links")
		.map((target) => target.id);
	if (!targets.length) return null;
	const variants = targets.map((id) =>
		articleLinkVariantForTarget(catalogue, id, preservedChanges),
	);
	return variants.length === 1
		? variants[0]
		: {
				...object(
					{
						kind: { const: "article_links" },
						targetId: { type: "string", enum: targets },
						after: { type: "object" },
					},
					["kind", "targetId", "after"],
				),
				oneOf: variants,
			};
}

function articleLinkVariantForTarget(
	catalogue: ModelCatalogue,
	articleId: string,
	preservedChanges: Contribution["changes"],
) {
	const target = catalogue.targets.find(
		(target) => target.kind === "article_links" && target.id === articleId,
	);
	const allowed = allowedLiteralArticleCoordinates(
		articleId,
		target?.current ?? target?.after,
		catalogue.articleGroundings ?? [],
		preservedChanges,
	);
	const perakim = referenceIds(catalogue, "perek");
	const dedications = referenceIds(catalogue, "dedication");
	const moadim = referenceIds(catalogue, "moed");
	const commands: Record<string, unknown>[] = [];
	const command = (
		relationshipKey: string,
		action: Record<string, unknown>,
		target: Record<string, unknown>,
	) =>
		object({ relationshipKey: { const: relationshipKey }, action, target }, [
			"relationshipKey",
			"action",
			"target",
		]);
	if (perakim.length) {
		commands.push(
			command(
				"primaryPerek",
				{ const: "replace" },
				object({ perekId: { type: "integer", enum: perakim } }, ["perekId"]),
			),
		);
	}
	const coordinates = perakim.length
		? {
				type: "array",
				uniqueItems: true,
				maxItems: 1000,
				items: object(
					{
						perekId: { type: "integer", enum: perakim },
						pasuk: { type: "integer", minimum: 1, maximum: 2147483647 },
					},
					["perekId", "pasuk"],
				),
			}
		: { type: "array", maxItems: 0 };
	if (perakim.length)
		commands.push(
			command(
				"coveringSources",
				{ const: "remove" },
				object({ pasukCoordinates: { ...coordinates, minItems: 1 } }, [
					"pasukCoordinates",
				]),
			),
		);
	const versesByChapter = new Map<number, number[]>();
	for (const coordinate of allowed) {
		const verses = versesByChapter.get(coordinate.perekId) ?? [];
		verses.push(coordinate.pasuk);
		versesByChapter.set(coordinate.perekId, verses);
	}
	const groundedCoordinates = allowed.length
		? {
				type: "array",
				uniqueItems: true,
				maxItems: 1000,
				items: {
					oneOf: [...versesByChapter].map(([perekId, verses]) =>
						object(
							{
								perekId: { const: perekId },
								pasuk: { type: "integer", enum: verses },
							},
							["perekId", "pasuk"],
						),
					),
				},
			}
		: { type: "array", maxItems: 0 };
	if (allowed.length)
		commands.push(
			command(
				"coveringSources",
				{ const: "add" },
				object({ pasukCoordinates: { ...groundedCoordinates, minItems: 1 } }, [
					"pasukCoordinates",
				]),
			),
		);
	commands.push(
		command(
			"coveringSources",
			{ const: "replace" },
			object({ pasukCoordinates: groundedCoordinates }, ["pasukCoordinates"]),
		),
		command(
			"coveringSources",
			{ const: "clear" },
			object({ pasukCoordinates: { type: "array", maxItems: 0 } }, [
				"pasukCoordinates",
			]),
		),
	);
	if (dedications.length)
		commands.push(
			command(
				"dedicationAssignments",
				{ enum: ["add", "remove", "replace"] },
				object(
					{
						dedicationId: { type: "integer", enum: dedications },
						expiresAt: {
							type: ["string", "null"],
							pattern: "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$",
						},
					},
					["dedicationId"],
				),
			),
		);
	if (moadim.length)
		commands.push(
			command(
				"moadim",
				{ enum: ["add", "remove"] },
				object(
					{
						moedIds: {
							type: "array",
							uniqueItems: true,
							minItems: 1,
							maxItems: 1000,
							items: { type: "integer", enum: moadim },
						},
					},
					["moedIds"],
				),
			),
		);
	commands.push(
		command(
			"moadim",
			{ const: "replace" },
			object(
				{
					moedIds: moadim.length
						? {
								type: "array",
								uniqueItems: true,
								maxItems: 1000,
								items: { type: "integer", enum: moadim },
							}
						: { type: "array", maxItems: 0 },
				},
				["moedIds"],
			),
		),
		command(
			"moadim",
			{ const: "clear" },
			object({ moedIds: { type: "array", maxItems: 0 } }, ["moedIds"]),
		),
	);
	return object(
		{
			kind: { const: "article_links" },
			targetId: { type: "string", enum: [articleId] },
			after: object(
				{
					commands: {
						type: "array",
						uniqueItems: true,
						minItems: 1,
						maxItems: 40,
						items: { oneOf: commands },
					},
				},
				["commands"],
			),
		},
		["kind", "targetId", "after"],
	);
}

export function assertAgentArticleLinkReferences(
	change: ArticleLinkChangeInput,
	catalogue: ModelCatalogue,
	preservedChanges: Contribution["changes"] = [],
): void {
	if (
		!catalogue.targets.some(
			(target) =>
				target.kind === "article_links" && target.id === change.targetId,
		)
	)
		throw new Error("The agent did not read this article's current link state");
	const identities = {
		perek: new Set(referenceIds(catalogue, "perek")),
		dedication: new Set(referenceIds(catalogue, "dedication")),
		moed: new Set(referenceIds(catalogue, "moed")),
	};
	const known = (family: keyof typeof identities, id: number) => {
		if (!identities[family].has(id))
			throw new Error(
				"The agent referenced an article link outside its read catalogue",
			);
	};
	for (const command of change.after.commands) {
		switch (command.relationshipKey) {
			case "primaryPerek":
				known("perek", command.target.perekId);
				break;
			case "coveringSources":
				if (Object.hasOwn(command.target, "coverageVerified"))
					throw new Error("Agents cannot change article coverage verification");
				for (const coordinate of command.target.pasukCoordinates)
					known("perek", coordinate.perekId);
				break;
			case "dedicationAssignments":
				known("dedication", command.target.dedicationId);
				break;
			case "moadim":
				for (const id of command.target.moedIds) known("moed", id);
				break;
		}
	}
	const target = catalogue.targets.find(
		(target) =>
			target.kind === "article_links" && target.id === change.targetId,
	);
	assertLiteralArticleCoverage(
		change,
		target?.current ?? target?.after,
		catalogue.articleGroundings ?? [],
		preservedChanges,
	);
}
