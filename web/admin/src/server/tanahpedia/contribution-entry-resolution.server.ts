import type { PoolConnection } from "mysql2/promise";
import { contributionIdentifierKey } from "~/lib/tanahpedia/contribution-identifiers";
import {
	type ChangeInput,
	validateChanges,
} from "~/lib/tanahpedia/contributions";
import { txQuery } from "../db";

/** A pending creation becomes metadata edits when its requested public name now
 * resolves to an existing entry. Canonical addresses and prose are preserved. */
export async function resolveEntryCreations(
	conn: PoolConnection,
	inputs: ChangeInput[],
): Promise<ChangeInput[]> {
	if (
		!inputs.some(
			(c) =>
				c.kind === "entry" || (c.kind === "place_profile" && c.after.entry),
		)
	)
		return inputs;
	const removals = new Set(
		inputs
			.filter(
				(c) => c.kind === "alias_mapping" && c.after === null && c.targetId,
			)
			.map((c) => contributionIdentifierKey(c.targetId as string)),
	);
	const output: ChangeInput[] = [];
	for (const input of inputs) {
		if (input.kind === "place_profile" && input.after.entry) {
			const resolved = await resolveEntryCreations(conn, [
				{
					kind: "entry",
					targetId: input.targetId,
					after: { ...input.after.entry, entityType: "PLACE" },
				},
			]);
			const entity = resolved.find((change) => change.kind === "metadata");
			if (!entity) {
				output.push(input);
				continue;
			}
			const places = await txQuery<{ id: string }>(
				conn,
				"SELECT id FROM tanahpedia_place WHERE entity_id=? FOR SHARE",
				[entity.targetId],
			);
			if (places.length !== 1)
				throw new Error("The existing entry must identify one place.");
			output.push({
				kind: "place_profile",
				targetId: places[0].id,
				after: { ...input.after, entry: null },
			});
			continue;
		}
		if (input.kind !== "entry") {
			output.push(input);
			continue;
		}
		const canonical = await txQuery<{ id: string }>(
			conn,
			"SELECT id FROM tanahpedia_entry WHERE unique_name=? FOR UPDATE",
			[input.after.uniqueName],
		);
		let candidates = canonical;
		if (!candidates.length) {
			const aliases = await txQuery<{ aliasId: string; id: string }>(
				conn,
				"SELECT id AS aliasId,entry_id AS id FROM tanahpedia_entry_synonym WHERE name=? FOR SHARE",
				[input.after.uniqueName],
			);
			// A deliberate, explicitly reviewed address transfer remains atomic.
			if (
				aliases.some((a) => removals.has(contributionIdentifierKey(a.aliasId)))
			) {
				output.push(input);
				continue;
			}
			const choices = aliases.length
				? await txQuery<{ id: string }>(
						conn,
						"SELECT d.entry_id AS id FROM tanahpedia_entry_synonym_disambiguation d JOIN tanahpedia_entry_synonym s ON s.id=d.synonym_id WHERE s.name=? FOR SHARE",
						[input.after.uniqueName],
					)
				: [];
			candidates = [
				...new Map(
					[...aliases, ...choices].map((r) => [
						contributionIdentifierKey(r.id),
						r,
					]),
				).values(),
			];
		}
		if (!candidates.length && input.targetId)
			candidates = await txQuery<{ id: string }>(
				conn,
				"SELECT id FROM tanahpedia_entry WHERE id=? FOR UPDATE",
				[input.targetId],
			);
		if (!candidates.length) {
			output.push(input);
			continue;
		}
		if (candidates.length !== 1)
			throw new Error(
				"The proposed creation now resolves to an ambiguous alias. Choose its existing destination manually.",
			);
		const entryId = candidates[0].id;
		// Match merge's entry -> entity order, before the metadata read takes
		// entity locks. Concurrent resolutions serialize on the entry as well.
		await txQuery(
			conn,
			"SELECT id FROM tanahpedia_entry WHERE id=? FOR UPDATE",
			[entryId],
		);
		const entities = await txQuery<{ id: string }>(
			conn,
			"SELECT e.id FROM tanahpedia_entry_entity ee JOIN tanahpedia_entity e ON e.id=ee.entity_id WHERE ee.entry_id=? AND e.entity_type=? ORDER BY e.id FOR SHARE",
			[entryId, input.after.entityType],
		);
		const distinct = [
			...new Map(
				entities.map((e) => [contributionIdentifierKey(e.id), e]),
			).values(),
		];
		if (distinct.length !== 1)
			throw new Error(
				`The existing entry must identify one ${input.after.entityType} entity. Repair the proposal's target manually.`,
			);
		output.push(
			{
				kind: "entry_title",
				targetId: entryId,
				after: { title: input.after.title },
			},
			{
				kind: "metadata",
				targetId: distinct[0].id,
				after: { displayName: input.after.displayName },
			},
		);
	}
	return validateChanges(output);
}
