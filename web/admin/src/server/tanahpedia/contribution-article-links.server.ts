import { createHash } from "node:crypto";
import type { PoolConnection } from "mysql2/promise";
import { cataloguePerekLabel } from "~/lib/article-linking/catalogue";
import { extractPlainText } from "~/lib/article-linking/html-text";
import { canonicalJson } from "~/lib/canonical-json";
import {
	type ArticleLinkChangeInput,
	type ArticleLinkState,
	articleLinksHaveEffect,
	contributionArticleId,
	projectArticleLinks,
	validateArticleLinkState,
} from "~/lib/tanahpedia/contribution-article-links";
import type {
	ChangeState,
	ReviewedChange,
} from "~/lib/tanahpedia/contributions";
import { txQuery, txQueryOne } from "../db";

interface ArticleRow {
	id: number;
	name: string;
	abstract: string | null;
	content: string | null;
	perekId: number;
	authorId: number;
	coverageVerified: number;
	contentHash: string;
}

async function readArticle(
	conn: PoolConnection,
	articleId: string,
	current = false,
): Promise<ArticleRow> {
	const id = Number(contributionArticleId(articleId));
	// The authenticated relationship API owns the article's write lock. Holding
	// it here while awaiting that API would deadlock our own merge request.
	const row = await txQueryOne<ArticleRow>(
		conn,
		`SELECT id,name,abstract,content,perek_id AS perekId,author_id AS authorId,coverage_verified AS coverageVerified,LOWER(HEX(content_hash)) AS contentHash FROM tanah_article WHERE id=?${current ? " FOR SHARE" : ""}`,
		[id],
	);
	if (!row) throw new Error("Article not found");
	return row;
}

function sourceHash(row: ArticleRow): string {
	// The API's contentHash also changes when primaryPerek changes. This
	// independent hash distinguishes our approved link write from a prose edit
	// when recovering an interrupted API response; it never edits those fields.
	return createHash("sha256")
		.update(
			canonicalJson({
				name: row.name,
				abstract: row.abstract,
				content: row.content,
				authorId: Number(row.authorId),
			}),
		)
		.digest("hex");
}

export async function readArticleLinkState(
	conn: PoolConnection,
	articleId: string,
	options: { current?: boolean } = {},
): Promise<ArticleLinkState> {
	const row = await readArticle(conn, articleId, options.current);
	return articleState(conn, row, options.current);
}

async function articleState(
	conn: PoolConnection,
	row: ArticleRow,
	current = false,
): Promise<ArticleLinkState> {
	const [coveringSources, dedicationAssignments, moadim] = await Promise.all([
		txQuery<{ perekId: number; pasuk: number }>(
			conn,
			`SELECT perek_id AS perekId,pasuk FROM tanah_article_covering_source WHERE article_id=? ORDER BY perek_id,pasuk${current ? " FOR SHARE" : ""}`,
			[row.id],
		),
		txQuery<{ dedicationId: number; expiresAt: string | null }>(
			conn,
			`SELECT dedication_id AS dedicationId,DATE_FORMAT(expires_at,'%Y-%m-%d %H:%i:%s') AS expiresAt FROM tanah_article_dedication WHERE article_id=? ORDER BY dedication_id${current ? " FOR SHARE" : ""}`,
			[row.id],
		),
		txQuery<{ moedId: number }>(
			conn,
			`SELECT moed_id AS moedId FROM tanah_article_moed WHERE article_id=? ORDER BY moed_id${current ? " FOR SHARE" : ""}`,
			[row.id],
		),
	]);
	return validateArticleLinkState({
		contentHash: row.contentHash,
		sourceHash: sourceHash(row),
		perekId: Number(row.perekId),
		authorId: Number(row.authorId),
		coverageVerified: Number(row.coverageVerified) === 1,
		coveringSources: coveringSources.map((c) => ({
			perekId: Number(c.perekId),
			pasuk: Number(c.pasuk),
		})),
		dedicationAssignments: dedicationAssignments.map((a) => ({
			dedicationId: Number(a.dedicationId),
			expiresAt: a.expiresAt,
		})),
		moedIds: moadim.map((m) => Number(m.moedId)),
	});
}

export async function readArticleLinkContext(
	conn: PoolConnection,
	articleId: string,
	options: { current?: boolean } = {},
) {
	const row = await readArticle(conn, articleId, options.current);
	const state = await articleState(conn, row, options.current);
	return {
		id: String(row.id),
		title: row.name,
		plainText: [row.name, row.abstract ?? "", row.content ?? ""]
			.map(extractPlainText)
			.filter(Boolean)
			.join("\n"),
		state,
	};
}

const ID_SET =
	"IN (SELECT id FROM JSON_TABLE(?, '$[*]' COLUMNS (id INT PATH '$')) ids)";

/** Validate catalogue references without taking canonical locks across an API call. */
export async function articleLinkReferenceLabels(
	conn: PoolConnection,
	input: ArticleLinkChangeInput,
	base: ArticleLinkState,
	articleTitle?: string,
): Promise<Record<string, string>> {
	const projected = projectArticleLinks(base, input.after);
	const perekIds = [
		...new Set([
			base.perekId,
			projected.perekId,
			...base.coveringSources.map((c) => c.perekId),
			...projected.coveringSources.map((c) => c.perekId),
			...input.after.commands.flatMap((command) =>
				command.relationshipKey === "primaryPerek"
					? [command.target.perekId]
					: command.relationshipKey === "coveringSources"
						? command.target.pasukCoordinates.map((c) => c.perekId)
						: [],
			),
		]),
	].sort((a, b) => a - b);
	const dedicationIds = [
		...new Set(
			[...base.dedicationAssignments, ...projected.dedicationAssignments]
				.map((a) => a.dedicationId)
				.concat(
					input.after.commands.flatMap((c) =>
						c.relationshipKey === "dedicationAssignments"
							? [c.target.dedicationId]
							: [],
					),
				),
		),
	].sort((a, b) => a - b);
	const moedIds = [
		...new Set([
			...base.moedIds,
			...projected.moedIds,
			...input.after.commands.flatMap((c) =>
				c.relationshipKey === "moadim" ? c.target.moedIds : [],
			),
		]),
	].sort((a, b) => a - b);
	const [article, perakim, dedications, moadim] = await Promise.all([
		articleTitle === undefined
			? txQueryOne<{ name: string }>(
					conn,
					"SELECT name FROM tanah_article WHERE id=?",
					[Number(input.targetId)],
				)
			: Promise.resolve({ name: articleTitle }),
		txQuery<{
			id: number;
			seferName: string;
			additionalLetter: string | null;
			perekInContext: number;
			pasukCount: number | null;
		}>(
			conn,
			`SELECT id,sefer_name AS seferName,additional_letter AS additionalLetter,perek_in_context AS perekInContext,pasuk_count AS pasukCount FROM tanah_perek_view WHERE id ${ID_SET}`,
			[JSON.stringify(perekIds)],
		),
		txQuery<{ id: number; subject: string }>(
			conn,
			`SELECT id,subject FROM tanah_dedication WHERE id ${ID_SET}`,
			[JSON.stringify(dedicationIds)],
		),
		txQuery<{ id: number; name: string }>(
			conn,
			`SELECT id,name FROM tanah_moed WHERE id ${ID_SET}`,
			[JSON.stringify(moedIds)],
		),
	]);
	const byPerek = new Map(perakim.map((p) => [Number(p.id), p]));
	if (perekIds.some((id) => !byPerek.has(id)))
		throw new Error("Referenced perek does not exist");
	if (dedicationIds.some((id) => !dedications.some((d) => Number(d.id) === id)))
		throw new Error("Referenced dedication does not exist");
	if (moedIds.some((id) => !moadim.some((m) => Number(m.id) === id)))
		throw new Error("Referenced moed does not exist");
	for (const command of input.after.commands)
		if (command.relationshipKey === "coveringSources")
			for (const coordinate of command.target.pasukCoordinates) {
				const count = byPerek.get(coordinate.perekId)?.pasukCount;
				if (
					count === null ||
					count === undefined ||
					coordinate.pasuk > Number(count)
				)
					throw new Error("Referenced pasuk is outside its canonical perek");
			}
	if (!article) throw new Error("Article not found");
	return {
		[`article:${input.targetId}`]: article.name,
		...Object.fromEntries(
			perakim.map((p) => [
				`perek:${p.id}`,
				cataloguePerekLabel({
					...p,
					id: Number(p.id),
					perekInContext: Number(p.perekInContext),
					pasukCount: p.pasukCount === null ? null : Number(p.pasukCount),
				}),
			]),
		),
		...Object.fromEntries(
			dedications.map((d) => [`dedication:${d.id}`, d.subject]),
		),
		...Object.fromEntries(moadim.map((m) => [`moed:${m.id}`, m.name])),
	};
}

export async function prepareArticleLinkChange(
	conn: PoolConnection,
	input: ArticleLinkChangeInput,
	options: { refresh?: boolean } = {},
): Promise<ReviewedChange> {
	const article = await readArticle(conn, input.targetId, true);
	const before = await articleState(conn, article, true);
	if (!options.refresh && !articleLinksHaveEffect(before, input.after))
		throw new Error("This proposal does not change the article's links");
	const labels = await articleLinkReferenceLabels(
		conn,
		input,
		before,
		article.name,
	);
	return {
		kind: "article_links",
		targetId: input.targetId,
		before: before as unknown as ChangeState,
		after: input.after as unknown as ChangeState,
		labels,
	};
}

/** Browser preview is one bounded article lookup, never a whole prose catalogue. */
export async function readArticleLinkPreview(
	conn: PoolConnection,
	articleId: string,
) {
	const article = await readArticle(conn, articleId, true);
	const state = await articleState(conn, article, true);
	const [labels, dedications, moadim] = await Promise.all([
		articleLinkReferenceLabels(
			conn,
			{ kind: "article_links", targetId: articleId, after: { commands: [] } },
			state,
			article.name,
		),
		txQuery<{ id: number; name: string }>(
			conn,
			"SELECT id,subject AS name FROM tanah_dedication ORDER BY subject,id LIMIT 2001",
		),
		txQuery<{ id: number; name: string }>(
			conn,
			"SELECT id,name FROM tanah_moed ORDER BY name,id LIMIT 2001",
		),
	]);
	return {
		id: String(article.id),
		title: article.name,
		state,
		labels,
		references: {
			dedication: dedications.slice(0, 2000),
			moed: moadim.slice(0, 2000),
		},
		hasMore: {
			dedication: dedications.length > 2000,
			moed: moadim.length > 2000,
		},
	};
}
