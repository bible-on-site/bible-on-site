import type { ArticleLinkChangeInput } from "~/lib/tanahpedia/contribution-article-links";
import type { ModelCatalogue } from "./contribution-llm.server";

export const ARTICLE_LINK_AGENT_GUIDE =
	"article_links: existing decimal article targetId required; after:{commands:[{relationshipKey,action,target}]}. Keep all commands for one article in a single article_links change and a separate PR; do not mix article_links with other change kinds. primaryPerek:replace {perekId}; coveringSources:add|remove|replace|clear {pasukCoordinates:[{perekId,pasuk}]}; dedicationAssignments:add|remove|replace {dedicationId,expiresAt?:UTC datetime|null}; moadim:add|remove|replace|clear {moedIds:number[]}. Use supplied perek/dedication/moed IDs only. Never include coverageVerified, author attribution, article prose or pipeline-owned links.";

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
export function agentArticleLinkVariant(catalogue: ModelCatalogue) {
	const targets = catalogue.targets
		.filter((target) => target.kind === "article_links")
		.map((target) => target.id);
	if (!targets.length) return null;
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
				{ enum: ["add", "remove"] },
				object({ pasukCoordinates: { ...coordinates, minItems: 1 } }, [
					"pasukCoordinates",
				]),
			),
		);
	commands.push(
		command(
			"coveringSources",
			{ const: "replace" },
			object({ pasukCoordinates: coordinates }, ["pasukCoordinates"]),
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
			targetId: { type: "string", enum: targets },
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
}
