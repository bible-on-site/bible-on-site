/**
 * Markdown document renderers for the public corpus (issue #3257).
 *
 * Each renderer loads through the SAME services the matching page
 * uses — never a parallel editorial corpus — so attribution, qri/ktiv,
 * Masoretic bounds, aliases and published-state semantics stay
 * identical. `null` means genuinely missing/unpublished content (the
 * route maps it to 404); any thrown service error propagates to the
 * route's 503 path so a transient DB failure never renders a false 404
 * and is never cached (the loaders' unstable_cache contract already
 * drops rejects).
 */
import DOMPurify from "isomorphic-dompurify";
import { toLetters } from "gematry";
import { sefarim } from "@/data/db/sefarim";
import { getPerekByPerekId } from "@/data/perek-dto";
import {
	getMasoraUnitById,
	getAllMasoraUnits,
} from "@/data/masora/masora-units";
import {
	getAllParashaUnits,
	getParashaEntry,
	getParashaUnitById,
	parashaRefSpan,
	rangesRefSpans,
} from "@/data/parasha/parasha-units";
import { parashaCanonicalPath } from "@/data/parasha/parasha-slugs";
import {
	getAllAuthorSlugs,
	getAuthorByName,
	getArticlesByAuthorId,
} from "@/lib/authors";
import { authorNameToSlug } from "@/lib/authors/url-utils";
import {
	getArticleById,
	getArticleSummariesByPerekId,
} from "@/lib/articles/service";
import {
	getPerushimByPerekId,
	getPerushDetail,
	getPerushimForRanges,
} from "@/lib/perushim/service";
import { demoteHeadings } from "@/lib/html-headings";
import { MOADIM_ROOT, moedHref } from "@/lib/moadim";
import {
	MOED_STALE_BOUND_SECONDS,
	getMoedArticleSummaries,
	getMoedBySlug,
	getPublishedMoadim,
} from "@/lib/moadim/service";
import type { Moed } from "@/lib/moadim/types";
import {
	getMasoraRangeArticles,
	getMasoraRangePerushim,
	getParashaRangeArticles,
	getParashaRangePerushim,
} from "@/app/components/reading/unit-range-summaries";
import {
	COLLECTION_TAGS,
	articleTag,
	authorArticlesTag,
	authorTag,
	cachedPerKey,
	moedTag,
	perekArticlesTag,
	perekPerushimTag,
	perushDetailTag,
} from "@/lib/revalidate/tags";
import {
	articlePath,
	perushPath,
	authorPath,
} from "@/lib/seo/core-jsonld";
import { absUrl } from "@/lib/seo/jsonld";
import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
} from "@/lib/tanahpedia/category-hierarchy";
import {
	categoryHref,
	resolveCategoryRoute,
} from "@/lib/tanahpedia/category-slug";
import { normalizeFootnoteHtml } from "@/lib/tanahpedia/normalize-footnotes";
import {
	ENTITY_TYPE_LABELS,
	getAnimalsByClassification,
	getEntitiesWithEntries,
	getEntitiesWithEntriesByRole,
	getEntryByUniqueName,
	getEntryOccurrences,
} from "@/lib/tanahpedia/service";
import {
	entryHref,
	resolveSynonymSlug,
} from "@/lib/tanahpedia/synonym-resolution";
import type {
	AnimalKind,
	AnimalPurity,
	CategoryKey,
	EntityType,
	PersonRole,
} from "@/lib/tanahpedia/types";
import { htmlToMarkdown } from "./html";
import type { MarkdownTarget } from "./paths";
import { pasukLine, scriptureMarkdown } from "./scripture";

export interface MarkdownDocument {
	title: string;
	/** Canonical HTML URL path (what `rel="canonical"`/alternate links point at). */
	canonicalPath: string;
	/** UTF-8 Markdown body including the `# title` line. */
	markdown: string;
}

/**
 * Cached loaders — the same `cachedPerKey` baseKeys and tags the HTML
 * pages use, so a Markdown request rides the warm data cache of the
 * page and a content edit expires both representations together
 * (thrown loader errors are never cached — cachedPerKey contract).
 */
const getCachedArticleSummaries = cachedPerKey(
	"article-summaries",
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.articles, perekArticlesTag(Number(key))],
	(perekId: number) => getArticleSummariesByPerekId(perekId),
);

const getCachedPerushim = cachedPerKey(
	"perushim",
	(perekId: number) => String(perekId),
	(key) => [COLLECTION_TAGS.perushim, perekPerushimTag(Number(key))],
	(perekId: number) => getPerushimByPerekId(perekId),
);

const getCachedArticle = cachedPerKey(
	"article",
	(id: number) => String(id),
	(key) => [COLLECTION_TAGS.articles, articleTag(Number(key))],
	(id: number) => getArticleById(id),
);

const getCachedPerushDetail = cachedPerKey(
	"perush-detail",
	(perushId: number, perekId: number) => `${perushId}:${perekId}`,
	(key) => {
		const [perushId, perekId] = key.split(":").map(Number);
		return [COLLECTION_TAGS.perushim, perushDetailTag(perushId, perekId)];
	},
	(perushId: number, perekId: number) => getPerushDetail(perushId, perekId),
);

/** Same "author-by-param" entry as the author page — keyed on the
 * percent-encoded param so both representations share one cache entry. */
const getCachedAuthor = cachedPerKey(
	"author-by-param",
	(param: string) => param,
	(key) => [COLLECTION_TAGS.authors, authorTag(key)],
	(param) => getAuthorByName(decodeURIComponent(param)),
);

const getCachedAuthorArticles = cachedPerKey(
	"author-articles",
	(authorId: number) => String(authorId),
	(key) => [
		COLLECTION_TAGS.articles,
		COLLECTION_TAGS.authors,
		authorArticlesTag(Number(key)),
	],
	(authorId: number) => getArticlesByAuthorId(authorId),
);

const getCachedAuthorSlugs = cachedPerKey(
	"author-slugs",
	() => "all",
	() => [COLLECTION_TAGS.authors],
	() => getAllAuthorSlugs(),
);

const getCachedMoadim = cachedPerKey(
	"moadim-published",
	() => "all",
	() => [COLLECTION_TAGS.moadim],
	() => getPublishedMoadim(),
	MOED_STALE_BOUND_SECONDS,
);

const getCachedMoed = cachedPerKey(
	"moed-detail",
	(slug: string) => slug,
	(slug) => [COLLECTION_TAGS.moadim, moedTag(slug)],
	(slug) => getMoedBySlug(slug),
	MOED_STALE_BOUND_SECONDS,
);

const getCachedMoedPerushim = cachedPerKey(
	"moed-perushim",
	(moed: Moed) => moed.slug,
	(slug) => [COLLECTION_TAGS.perushim, moedTag(slug)],
	(moed) => getPerushimForRanges(moed.ranges),
);

const getCachedMoedArticles = cachedPerKey(
	"moed-article-summaries",
	(moed: Moed) => moed.slug,
	(slug) => [COLLECTION_TAGS.articles, moedTag(slug)],
	(moed) => getMoedArticleSummaries(moed.id, moed.ranges),
);

/** Sanitized body HTML → Markdown — the same sanitize pipeline the page runs. */
function bodyMarkdown(
	html: string | null,
	{ footnotes = false }: { footnotes?: boolean } = {},
): string {
	if (!html) return "";
	const prepared = footnotes
		? normalizeFootnoteHtml(demoteHeadings(html))
		: demoteHeadings(html);
	return htmlToMarkdown(DOMPurify.sanitize(prepared));
}

function canonicalFooter(canonicalPath: string): string {
	return `---\nCanonical: ${absUrl(canonicalPath)}\nMarkdown: ${absUrl(`${canonicalPath === "/" ? "" : canonicalPath}.md`)}`;
}

/** Shared rendering for a related-content pair (perushim + articles). */
function relatedSections(
	perushim: { name: string; parshanName: string; perekId: number }[],
	articles: { id: number; perekId: number; name: string; authorName: string }[],
	tags: { articles: string; perushim: string },
): string[] {
	const sections: string[] = [];
	if (perushim.length > 0) {
		sections.push(
			`## ${tags.perushim}`,
			...perushim.map(
				(perush) =>
					`- [${perush.name}](${perushPath(perush.perekId, perush.name)}) - ${perush.parshanName}`,
			),
		);
	}
	if (articles.length > 0) {
		sections.push(
			`## ${tags.articles}`,
			...articles.map(
				(article) =>
					`- [${article.name}](${articlePath(article.perekId, article.id)}) - ${article.authorName}`,
			),
		);
	}
	return sections;
}

function homeDocument(): MarkdownDocument {
	const markdown = [
		"# תנ\"ך על הפרק",
		"",
		"לימוד יומי על הפרק - אתר זיכוי הרבים. כל תוכן הלימוד הציבורי פתוח לסריקה, אינדוקס, שימוש בבינה מלאכותית ואימון מודלים.",
		"",
		"## משפחות תוכן",
		"- [תנ\"ך על הפרק - 929 פרקים](/929) - הטקסט המסורתי המנוקד עם פירושים ומאמרים",
		"- [פרשה על הפרק](/פרשה) - חלוקת הקריאה לפרשיות עם הפטרות",
		"- [מסורה על הפרק](/מסורה) - חלוקת הקריאה לפרשיות סתומות ופתוחות",
		`- [מועדים](${MOADIM_ROOT}) - קריאות ומאמרים למועדי השנה`,
		"- [תנכפדיה](/pedia) - אנציקלופדיית ישויות התנ\"ך",
		"- [הרבנים והמחברים](/929/authors) - מחברי המאמרים",
		"",
		"## למכונות",
		"- [llms.txt](/llms.txt) - מדריך שימוש לסוכנים ומודלי שפה",
		"- [sitemap.xml](/sitemap.xml) - כל הכתובות הקנוניות",
		"- [API catalog](/.well-known/api-catalog) - קטלוג ה-API הציבורי (RFC 9727)",
		"- מסמך זה זמין גם בכתובת `/.md` וכל דף תוכן זמין בסיומת `.md` או בכותרת `Accept: text/markdown`.",
		"",
		canonicalFooter("/"),
	].join("\n");
	return { title: 'תנ"ך על הפרק', canonicalPath: "/", markdown };
}

function tanahIndexDocument(): MarkdownDocument {
	const parts: string[] = ["# תנ\"ך על הפרק - 929 פרקים", ""];
	for (const sefer of sefarim) {
		parts.push(`## ${sefer.name}`);
		const groups =
			"additionals" in sefer ? sefer.additionals : [sefer];
		for (const group of groups) {
			for (let perekId = group.perekFrom; perekId <= group.perekTo; perekId++) {
				const source = getPerekByPerekId(perekId).source;
				parts.push(`- [${source}](/929/${perekId})`);
			}
		}
		parts.push("");
	}
	parts.push(canonicalFooter("/929"));
	return {
		title: "תנ\"ך על הפרק - 929 פרקים",
		canonicalPath: "/929",
		markdown: parts.join("\n"),
	};
}

async function perekDocument(perekId: number): Promise<MarkdownDocument | null> {
	const perek = getPerekByPerekId(perekId);
	const [articles, perushim] = await Promise.all([
		getCachedArticleSummaries(perekId),
		getCachedPerushim(perekId),
	]);
	const parts: string[] = [
		`# ${perek.source}`,
		"",
		...perek.pesukim.map((pasuk, index) => pasukLine(pasuk, index + 1)),
	];
	if (perek.recitation?.audioUrl) {
		parts.push("", "## הקראה", `- [הקלטת הפרק](${perek.recitation.audioUrl})`);
	}
	if (perushim.length > 0) {
		parts.push(
			"",
			"## פירושים",
			...perushim.map(
				(perush) =>
					`- [${perush.name}](${perushPath(perekId, perush.name)}) - ${perush.parshanName}`,
			),
		);
	}
	if (articles.length > 0) {
		parts.push(
			"",
			"## מאמרים",
			...articles.map(
				(article) =>
					`- [${article.name}](${articlePath(perekId, article.id)}) - ${article.authorName}`,
			),
		);
	}
	const canonicalPath = `/929/${perekId}`;
	parts.push("", canonicalFooter(canonicalPath));
	return {
		title: perek.source,
		canonicalPath,
		markdown: parts.join("\n"),
	};
}

async function articleDocument(
	perekId: number,
	articleId: number,
): Promise<MarkdownDocument | null> {
	const article = await getCachedArticle(articleId);
	if (!article || article.perekId !== perekId) return null;
	const perek = getPerekByPerekId(article.perekId);
	const parts: string[] = [
		`# ${article.name}`,
		"",
		`מאת [${article.authorName}](${authorPath(authorNameToSlug(article.authorName))}) - על ${perek.source}`,
	];
	if (article.abstract) {
		parts.push("", bodyMarkdown(article.abstract));
	}
	const body = bodyMarkdown(article.content);
	if (body) parts.push("", body);
	const canonicalPath = articlePath(article.perekId, article.id);
	parts.push("", canonicalFooter(canonicalPath));
	return { title: article.name, canonicalPath, markdown: parts.join("\n") };
}

async function perushDocument(
	perekId: number,
	name: string,
): Promise<MarkdownDocument | null> {
	const perushim = await getCachedPerushim(perekId);
	const summary = perushim.find((perush) => perush.name === name);
	if (!summary) return null;
	const detail = await getCachedPerushDetail(summary.id, perekId);
	if (!detail) return null;
	const perek = getPerekByPerekId(perekId);
	const parts: string[] = [
		`# ${detail.name}`,
		"",
		`מפרש: ${detail.parshanName} - על ${perek.source}`,
	];
	for (const note of detail.notes) {
		const content = bodyMarkdown(note.noteContent);
		if (!content) continue;
		parts.push("", `**${toLetters(note.pasuk)}:** ${content}`);
	}
	const canonicalPath = perushPath(perekId, detail.name);
	parts.push("", canonicalFooter(canonicalPath));
	return { title: detail.name, canonicalPath, markdown: parts.join("\n") };
}

async function authorsIndexDocument(): Promise<MarkdownDocument | null> {
	const slugs = await getCachedAuthorSlugs();
	const parts = [
		"# הרבנים והמחברים",
		"",
		...slugs.map(
			(slug) => `- [${slug.replace(/-/g, " ")}](${authorPath(encodeURIComponent(slug))})`,
		),
		"",
		canonicalFooter("/929/authors"),
	];
	return {
		title: "הרבנים והמחברים",
		canonicalPath: "/929/authors",
		markdown: parts.join("\n"),
	};
}

async function authorDocument(slug: string): Promise<MarkdownDocument | null> {
	const author = await getCachedAuthor(encodeURIComponent(slug));
	if (!author) return null;
	const articles = await getCachedAuthorArticles(author.id);
	const parts: string[] = [`# ${author.name}`, ""];
	const details = bodyMarkdown(author.details);
	if (details) parts.push(details, "");
	if (author.imageUrl) {
		parts.push(`![${author.name}](${author.imageUrl})`, "");
	}
	if (articles.length > 0) {
		parts.push(
			"## מאמרים",
			...articles.map(
				(article) =>
					`- [${article.name}](${articlePath(article.perekId, article.id)}) - ${getPerekByPerekId(article.perekId).source}`,
			),
			"",
		);
	}
	const canonicalPath = authorPath(encodeURIComponent(slug));
	parts.push(canonicalFooter(canonicalPath));
	return { title: author.name, canonicalPath, markdown: parts.join("\n") };
}

function parashaIndexDocument(): MarkdownDocument {
	const units = getAllParashaUnits();
	const parts = ["# פרשה על הפרק", ""];
	let lastSefer = "";
	for (const unit of units) {
		if (unit.seferName !== lastSefer) {
			parts.push(`## ${unit.seferName}`);
			lastSefer = unit.seferName;
		}
		parts.push(
			`- [${unit.heading}](${parashaCanonicalPath(unit.unitId)}) - ${parashaRefSpan(unit)}`,
		);
	}
	parts.push("", canonicalFooter("/פרשה"));
	return {
		title: "פרשה על הפרק",
		canonicalPath: "/פרשה",
		markdown: parts.join("\n"),
	};
}

async function parashaDocument(unitId: number): Promise<MarkdownDocument | null> {
	const unit = getParashaUnitById(unitId);
	const entry = getParashaEntry(unitId);
	const parts: string[] = [
		`# פרשת ${unit.heading}`,
		"",
		`**${parashaRefSpan(unit)}**`,
		"",
		scriptureMarkdown(unit.ranges),
	];
	for (const note of entry.notes) {
		parts.push("", `> ${note}`);
	}
	const haftarot = entry.haftarot;
	if (haftarot.length > 0) {
		for (const haftara of haftarot) {
			parts.push(
				"",
				`## הפטרה - ${haftara.label}`,
				"",
				`**${rangesRefSpans(haftara.ranges).join("; ")}**`,
				"",
				scriptureMarkdown(haftara.ranges),
			);
			if (haftara.note) parts.push("", `> ${haftara.note}`);
		}
	}
	const [torahArticles, torahPerushim] = await Promise.all([
		getParashaRangeArticles(unitId, "torah"),
		getParashaRangePerushim(unitId, "torah"),
	]);
	const related = relatedSections(torahPerushim, torahArticles, {
		articles: "מאמרים על הפרשה",
		perushim: "פירושים על הפרשה",
	});
	if (haftarot.length > 0) {
		const [haftaraArticles, haftaraPerushim] = await Promise.all([
			getParashaRangeArticles(unitId, "haftara"),
			getParashaRangePerushim(unitId, "haftara"),
		]);
		related.push(
			...relatedSections(haftaraPerushim, haftaraArticles, {
				articles: "מאמרים על ההפטרה",
				perushim: "פירושים על ההפטרה",
			}),
		);
	}
	if (related.length > 0) parts.push("", ...related);
	const canonicalPath = parashaCanonicalPath(unitId);
	parts.push("", canonicalFooter(canonicalPath));
	return {
		title: `פרשת ${unit.heading}`,
		canonicalPath,
		markdown: parts.join("\n"),
	};
}

function masoraIndexDocument(): MarkdownDocument {
	const units = getAllMasoraUnits();
	const parts = ["# מסורה על הפרק", ""];
	let lastSefer = "";
	for (const unit of units) {
		if (unit.seferName !== lastSefer) {
			parts.push(`## ${unit.seferName}`);
			lastSefer = unit.seferName;
		}
		parts.push(`- [${unit.heading}](/מסורה/${unit.unitId})`);
	}
	parts.push("", canonicalFooter("/מסורה"));
	return {
		title: "מסורה על הפרק",
		canonicalPath: "/מסורה",
		markdown: parts.join("\n"),
	};
}

async function masoraDocument(unitId: number): Promise<MarkdownDocument | null> {
	const unit = getMasoraUnitById(unitId);
	const parts: string[] = [`# ${unit.heading}`, "", scriptureMarkdown(unit.ranges)];
	if (unit.closingBreak) {
		parts.push(
			"",
			`פרשה ${unit.closingBreak === "stuma" ? "סתומה" : "פתוחה"}`,
		);
	}
	const [articles, perushim] = await Promise.all([
		getMasoraRangeArticles(unitId),
		getMasoraRangePerushim(unitId),
	]);
	const related = relatedSections(perushim, articles, {
		articles: "מאמרים",
		perushim: "פירושים",
	});
	if (related.length > 0) parts.push("", ...related);
	const canonicalPath = `/מסורה/${unitId}`;
	parts.push("", canonicalFooter(canonicalPath));
	return {
		title: unit.heading,
		canonicalPath,
		markdown: parts.join("\n"),
	};
}

async function moadimIndexDocument(): Promise<MarkdownDocument | null> {
	const moadim = await getCachedMoadim();
	const parts = [
		"# מועדים",
		"",
		...moadim.map(
			(moed) =>
				`- [${moed.name}](${moedHref(moed.slug)})${moed.dateLabel ? ` - ${moed.dateLabel}` : ""}`,
		),
		"",
		canonicalFooter(MOADIM_ROOT),
	];
	return {
		title: "מועדים",
		canonicalPath: MOADIM_ROOT,
		markdown: parts.join("\n"),
	};
}

async function moedDocument(slug: string): Promise<MarkdownDocument | null> {
	const moed = await getCachedMoed(slug);
	if (!moed) return null;
	const meta = [moed.hebrewMonth, moed.dateLabel].filter(Boolean).join(" - ");
	const parts: string[] = [`# ${moed.name}`, ""];
	if (meta) parts.push(meta, "");
	if (moed.summary) parts.push(moed.summary, "");
	for (const section of moed.sections) {
		parts.push(
			`## ${section.label}`,
			"",
			`**${rangesRefSpans(section.ranges).join("; ")}**`,
			"",
			scriptureMarkdown(section.ranges),
			"",
		);
	}
	if (moed.sections.length === 0 && moed.ranges.length > 0) {
		parts.push(scriptureMarkdown(moed.ranges), "");
	}
	const [articles, perushim] = await Promise.all([
		getCachedMoedArticles(moed),
		getCachedMoedPerushim(moed),
	]);
	const related = relatedSections(perushim, articles, {
		articles: "מאמרים",
		perushim: "פירושים",
	});
	if (related.length > 0) parts.push(...related, "");
	const canonicalPath = moedHref(moed.slug);
	parts.push(canonicalFooter(canonicalPath));
	return { title: moed.name, canonicalPath, markdown: parts.join("\n") };
}

function pediaIndexDocument(): MarkdownDocument {
	const parts = ["# תנכפדיה", "", "## קטגוריות"];
	for (const category of CATEGORY_HIERARCHY) {
		const keys: CategoryKey[] = [
			category.type,
			...(category.children ?? []),
		];
		for (const key of keys) {
			parts.push(`- [${labelForCategoryKey(key)}](${categoryHref(key)})`);
		}
	}
	parts.push("", canonicalFooter("/pedia"));
	return {
		title: "תנכפדיה",
		canonicalPath: "/pedia",
		markdown: parts.join("\n"),
	};
}

const ANIMAL_PURITIES: CategoryKey[] = ["TAHOR", "TAMEH"];

async function pediaCategoryDocument(
	entityType: EntityType,
	sub: CategoryKey | undefined,
	label: string,
	canonicalPath: string,
): Promise<MarkdownDocument> {
	const entities =
		sub && entityType === "PERSON"
			? await getEntitiesWithEntriesByRole(sub as PersonRole)
			: sub && entityType === "ANIMAL"
				? ANIMAL_PURITIES.includes(sub)
					? await getAnimalsByClassification("purity", sub as AnimalPurity)
					: await getAnimalsByClassification("kind", sub as AnimalKind)
				: await getEntitiesWithEntries(entityType);
	const parts: string[] = [`# ${label} - תנכפדיה`, ""];
	for (const entity of entities) {
		if (entity.linkedEntries.length === 0) {
			parts.push(`- ${entity.entityName}`);
			continue;
		}
		for (const linked of entity.linkedEntries) {
			parts.push(
				`- [${linked.title}](${entryHref(linked.uniqueName)}) - ${entity.entityName}`,
			);
		}
	}
	if (entities.length === 0) {
		parts.push(`עדיין אין ערכים בקטגוריה זו.`);
	}
	parts.push("", canonicalFooter(canonicalPath));
	return {
		title: `${label} - תנכפדיה`,
		canonicalPath,
		markdown: parts.join("\n"),
	};
}

async function pediaDocument(slug: string): Promise<MarkdownDocument | null> {
	const resolvedCategory = resolveCategoryRoute(slug);
	if (resolvedCategory) {
		const label = resolvedCategory.sub
			? labelForCategoryKey(resolvedCategory.sub)
			: ENTITY_TYPE_LABELS[resolvedCategory.entityType];
		return pediaCategoryDocument(
			resolvedCategory.entityType,
			resolvedCategory.sub ?? undefined,
			label,
			resolvedCategory.canonicalPath,
		);
	}
	const entry = await getEntryByUniqueName(slug);
	if (!entry) {
		const resolution = await resolveSynonymSlug(slug);
		if (resolution.kind === "alias") {
			// Alias slugs carry the entry under their canonical uniqueName —
			// the proxy/HTML path permanent-redirects; for Markdown we serve
			// the target document directly with its canonical path.
			return pediaDocument(resolution.target.uniqueName);
		}
		if (resolution.kind === "disambiguation") {
			const parts: string[] = [
				`# ${slug} - תנכפדיה`,
				"",
				`השם מתייחס ליותר מערך אחד:`,
				...resolution.targets.map(
					(target) =>
						`- [${target.label ? `${target.title} (${target.label})` : target.title}](${entryHref(target.uniqueName)})`,
				),
				"",
				canonicalFooter(`/pedia/${encodeURIComponent(slug)}`),
			];
			return {
				title: `${slug} - תנכפדיה`,
				canonicalPath: `/pedia/${encodeURIComponent(slug)}`,
				markdown: parts.join("\n"),
			};
		}
		return null;
	}
	const occurrences = await getEntryOccurrences(entry.id);
	const parts: string[] = [`# ${entry.title}`, ""];
	if (entry.entities.length > 0) {
		parts.push(
			`קטגוריות: ${entry.entities
				.map(
					(ee) =>
						`[${ENTITY_TYPE_LABELS[ee.entityType as EntityType] ?? ee.entityType}](${categoryHref(ee.entityType as EntityType)})`,
				)
				.join(", ")}`,
			"",
		);
	}
	const body = bodyMarkdown(entry.content, { footnotes: true });
	parts.push(body === "" ? "אין תוכן עדיין לערך זה." : body);
	if (occurrences.length > 0) {
		parts.push(
			"",
			"## מראי מקום",
			...occurrences.map(
				(occ) =>
					`- [${getPerekByPerekId(occ.perekId).source} ${toLetters(occ.pasukNumber)}](/929/${occ.perekId})`,
			),
		);
	}
	const canonicalPath = entryHref(entry.uniqueName);
	parts.push("", canonicalFooter(canonicalPath));
	return {
		title: `${entry.title} - תנכפדיה`,
		canonicalPath,
		markdown: parts.join("\n"),
	};
}

/**
 * Render a Markdown target to its document. `null` = genuinely missing
 * (unpublished/misspelled); thrown errors = transient failures.
 */
export async function renderMarkdown(
	target: MarkdownTarget,
): Promise<MarkdownDocument | null> {
	switch (target.kind) {
		case "home":
			return homeDocument();
		case "tanah-index":
			return tanahIndexDocument();
		case "perek":
			return perekDocument(target.perekId);
		case "article":
			return articleDocument(target.perekId, target.articleId);
		case "perush":
			return perushDocument(target.perekId, target.name);
		case "authors-index":
			return authorsIndexDocument();
		case "author":
			return authorDocument(target.slug);
		case "parasha-index":
			return parashaIndexDocument();
		case "parasha":
			return parashaDocument(target.unitId);
		case "masora-index":
			return masoraIndexDocument();
		case "masora":
			return masoraDocument(target.unitId);
		case "moadim-index":
			return moadimIndexDocument();
		case "moed":
			return moedDocument(target.slug);
		case "pedia-index":
			return pediaIndexDocument();
		case "pedia":
			return pediaDocument(target.slug);
	}
}


