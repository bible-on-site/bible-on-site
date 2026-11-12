import { createHash } from "node:crypto";
import { hasBulletinArticleText } from "../lib/bulletin-article";

export interface ApprovalArticle {
	id: number;
	name: string;
	content: string | null;
	distributable: number | boolean;
}

export interface BulletinApprovalChange {
	id: number;
	before: number;
	after: number;
	sourceHash: string;
}

function validId(id: number): boolean {
	return Number.isSafeInteger(id) && id > 0 && id <= 8_388_607;
}

/** One owner-authorized approval pass, never an automatic deployment backfill. */
export function planBulletinApprovals(articles: ApprovalArticle[]): {
	written: number;
	excluded: number;
	changes: BulletinApprovalChange[];
} {
	const seen = new Set<number>();
	const changes: BulletinApprovalChange[] = [];
	let written = 0;
	for (const article of articles) {
		if (
			!validId(article.id) ||
			seen.has(article.id) ||
			typeof article.name !== "string" ||
			(article.content !== null && typeof article.content !== "string") ||
			![0, 1, false, true].includes(article.distributable)
		)
			throw new Error("Invalid article approval snapshot");
		seen.add(article.id);
		const before = Number(article.distributable);
		const after = Number(hasBulletinArticleText(article.content, article.name));
		written += after;
		if (before !== after)
			changes.push({
				id: article.id,
				before,
				after,
				sourceHash: createHash("sha256")
					.update(`${article.name}\0${article.content ?? ""}`, "utf8")
					.digest("hex"),
			});
	}
	return { written, excluded: articles.length - written, changes };
}

/**
 * SQL for the existing database deployment Lambda. Temporary tables survive
 * its legacy creation-statement rewriter. Locks and snapshot guards make a
 * stale, repeated or partial operation fail and roll back on connection close.
 * Only distributable is assigned; the reverse plan is the guarded rollback.
 */
export function bulletinApprovalSql(
	changes: BulletinApprovalChange[],
	rollback = false,
): string {
	const seen = new Set<number>();
	if (!changes.length) throw new Error("No article approval changes");
	const values = changes
		.map((change) => {
			if (
				!validId(change.id) ||
				seen.has(change.id) ||
				![0, 1].includes(change.before) ||
				![0, 1].includes(change.after) ||
				change.before === change.after ||
				!/^[a-f0-9]{64}$/.test(change.sourceHash)
			)
				throw new Error("Invalid article approval change");
			seen.add(change.id);
			return `(${change.id},${rollback ? change.after : change.before},${rollback ? change.before : change.after},'${change.sourceHash}')`;
		})
		.join(",\n");
	const count = changes.length;
	const hash =
		"SHA2(CONCAT(a.name,CHAR(0),COALESCE(a.content,'')),256)=p.source_hash";
	return (
		"CREATE TEMPORARY TABLE bulletin_approval_plan (article_id MEDIUMINT NOT NULL PRIMARY KEY,previous_flag BOOLEAN NOT NULL,next_flag BOOLEAN NOT NULL,source_hash CHAR(64) NOT NULL);\n" +
		`INSERT INTO bulletin_approval_plan VALUES\n${values};\n` +
		"CREATE TEMPORARY TABLE bulletin_approval_guard (ok TINYINT NOT NULL,CHECK(ok=1));\n" +
		"START TRANSACTION;\n" +
		"SELECT a.id FROM tanah_article a JOIN bulletin_approval_plan p ON p.article_id=a.id ORDER BY a.id FOR UPDATE;\n" +
		`INSERT INTO bulletin_approval_guard SELECT IF(COUNT(*)=${count},1,0) FROM tanah_article a JOIN bulletin_approval_plan p ON p.article_id=a.id WHERE ${hash} AND a.distributable=p.previous_flag;\n` +
		"UPDATE tanah_article a JOIN bulletin_approval_plan p ON p.article_id=a.id SET a.distributable=p.next_flag;\n" +
		"SET @bulletinApprovalChanged=ROW_COUNT();\n" +
		`INSERT INTO bulletin_approval_guard SELECT IF(@bulletinApprovalChanged=${count} AND COUNT(*)=${count},1,0) FROM tanah_article a JOIN bulletin_approval_plan p ON p.article_id=a.id WHERE ${hash} AND a.distributable=p.next_flag;\n` +
		"COMMIT;\n"
	);
}
