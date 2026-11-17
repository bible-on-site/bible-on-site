import { createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { canonicalJson } from "~/lib/canonical-json";
import {
	allowedLiteralArticleCoordinates,
	assertLiteralArticleCoverage,
} from "~/lib/tanahpedia/contribution-article-grounding";
import type { ChangeInput, Contribution } from "~/lib/tanahpedia/contributions";
import { readArticleLinkContext } from "./contribution-article-links.server";
import type { ModelCatalogue } from "./contribution-llm.server";
import { readAgentPerek } from "./contribution-perek-reads.server";

/** Recheck every new literal addition under current source/chapter locks before any draft write. */
export async function assertCurrentAgentArticleGrounding(
	conn: PoolConnection,
	changes: readonly ChangeInput[],
	catalogue: ModelCatalogue,
	preservedChanges: Contribution["changes"] = [],
): Promise<void> {
	const articleChanges = changes
		.filter((change) => change.kind === "article_links")
		.sort((a, b) => Number(a.targetId) - Number(b.targetId));
	const chapters = new Map<number, string>();
	for (const change of articleChanges) {
		const additions = change.after.commands.flatMap((command) =>
			command.relationshipKey === "coveringSources" &&
			(command.action === "add" || command.action === "replace")
				? command.target.pasukCoordinates
				: [],
		);
		if (!additions.length) continue;
		const article = await readArticleLinkContext(conn, change.targetId, {
			current: true,
		});
		const groundings = catalogue.articleGroundings ?? [];
		assertLiteralArticleCoverage(
			change,
			article.state,
			groundings,
			preservedChanges,
		);
		const retained = new Set(
			allowedLiteralArticleCoordinates(
				change.targetId,
				article.state,
				[],
				preservedChanges,
			).map((coordinate) => `${coordinate.perekId}:${coordinate.pasuk}`),
		);
		for (const coordinate of additions) {
			if (retained.has(`${coordinate.perekId}:${coordinate.pasuk}`)) continue;
			const matches = groundings.filter(
				(grounding) =>
					grounding.articleId === change.targetId &&
					grounding.sourceHash === article.state.sourceHash &&
					grounding.coordinates.some(
						(literal) =>
							literal.perekId === coordinate.perekId &&
							literal.pasuk === coordinate.pasuk,
					),
			);
			if (!matches.length)
				throw new Error(
					"Agent article coverage requires an explicit source citation",
				);
			let fingerprint = chapters.get(coordinate.perekId);
			if (!fingerprint) {
				const chapter = await readAgentPerek(conn, coordinate.perekId, true);
				if (!chapter)
					throw new Error(
						"An article citation chapter changed during execution",
					);
				fingerprint = createHash("sha256")
					.update(canonicalJson(chapter.coordinates))
					.digest("hex");
				chapters.set(coordinate.perekId, fingerprint);
			}
			if (
				!matches.every((grounding) =>
					grounding.chapters.some(
						(chapter) =>
							chapter.id === coordinate.perekId &&
							chapter.fingerprint === fingerprint,
					),
				)
			)
				throw new Error("An article citation chapter changed during execution");
		}
	}
}
