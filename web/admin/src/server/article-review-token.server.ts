import { createHash } from "node:crypto";

export interface ArticleReviewSource {
	name: string;
	abstract: string | null;
	content: string | null;
	perekId: number;
	authorId: number;
}

// Persisted proposals and reviewed changes use the original 32-hex token.
// Match the bytes of the old MySQL expression so those records stay valid.
export function articleReviewToken(article: ArticleReviewSource): string {
	return createHash("md5")
		.update(
			[
				article.name,
				article.abstract ?? "",
				article.content ?? "",
				article.perekId,
				article.authorId,
			].join("\x01"),
		)
		.digest("hex");
}
