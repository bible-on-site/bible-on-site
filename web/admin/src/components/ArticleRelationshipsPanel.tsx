import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ARTICLE_RELATIONSHIP_REGISTRY,
	type ArticleRelationshipEntry,
	pendingRelationships,
	relationshipFor,
	supportedRelationships,
} from "~/lib/article-relationships";
import { getArticleRelationshipDetails } from "~/server/article-relationships";

/**
 * The article's full relationship picture (#3102): one section per entry in
 * the shared registry — managed (single-valued/coverage fields live in the
 * form above), workflow-owned (dedication assignments), read-only
 * (pipeline-owned mention annotations) and pending-schema (#3098/#3101).
 * Editing never happens here except through the owning workflow, exactly as
 * the contract's `ownership` field prescribes.
 */
export function ArticleRelationshipsPanel({
	articleId,
	perekId,
	authorId,
	authorName,
	coveringCount,
	coverageVerified,
}: {
	articleId: number;
	perekId: number;
	authorId: number;
	authorName: string | undefined;
	/** undefined when the covering-source schema is not deployed. */
	coveringCount: number | undefined;
	coverageVerified: boolean;
}) {
	const { data, isLoading, isError, error } = useQuery({
		queryKey: ["article-relationships", articleId],
		queryFn: () => getArticleRelationshipDetails({ data: articleId }),
	});

	const registry = supportedRelationships();
	const pending = pendingRelationships();

	return (
		<section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
			<header className="px-8 py-5 border-b border-gray-100">
				<h2 className="text-xl font-bold text-gray-900">🔗 קשרי המאמר</h2>
				<p className="mt-1 text-sm text-gray-500">
					כל הקשרים הסמנטיים שהסכמה תומכת בהם — לפי חוזה הקשרים המשותף (v
					{ARTICLE_RELATIONSHIP_REGISTRY.contractVersion})
				</p>
			</header>

			<div className="divide-y divide-gray-100">
				{/* Single-valued article-owned fields — managed in the form. */}
				<RelationshipSection entry={requireEntry(registry, "primaryPerek")}>
					<p className="text-sm text-gray-700">
						פרק {perekId}{" "}
						<span className="text-xs text-gray-400">
							— נערך בטופס המאמר; אין אפשרות לנקות (שדה חובה)
						</span>
					</p>
				</RelationshipSection>
				<RelationshipSection entry={requireEntry(registry, "author")}>
					<p className="text-sm text-gray-700">
						{authorName ?? `מזהה ${authorId}`}{" "}
						<span className="text-xs text-gray-400">
							— נערך בטופס המאמר; אין אפשרות לנקות (שדה חובה)
						</span>
					</p>
				</RelationshipSection>
				<RelationshipSection entry={requireEntry(registry, "coveringSources")}>
					{coveringCount === undefined ? (
						<p className="text-sm text-gray-400">
							סכמת מקורות הכיסוי עוד לא נפרסה
						</p>
					) : (
						<p className="text-sm text-gray-700">
							{coveringCount} מקורות;{" "}
							{coverageVerified ? (
								<span className="text-green-700 font-medium">
									כיסוי מאומת ✓
								</span>
							) : (
								<span className="text-gray-500">כיסוי לא ידוע</span>
							)}{" "}
							<span className="text-xs text-gray-400">
								— נערך בעורך מקורות הכיסוי בטופס
							</span>
						</p>
					)}
				</RelationshipSection>

				{/* Dedication-workflow-owned assignments. */}
				<RelationshipSection
					entry={requireEntry(registry, "dedicationAssignments")}
				>
					{isLoading ? (
						<p className="text-sm text-gray-400">טוען…</p>
					) : isError ? (
						<p className="text-sm text-red-600">
							שגיאה בטעינה: {(error as Error).message}
						</p>
					) : data && data.dedications.length > 0 ? (
						<ul className="text-sm text-gray-700 space-y-1">
							{data.dedications.map((link) => (
								<li key={link.dedicationId}>
									<span className="font-medium">
										{link.subject ?? `הקדשה ${link.dedicationId}`}
									</span>
									{link.expiresAt && (
										<span className="text-gray-500">
											{" "}
											(הקצאה עד {link.expiresAt})
										</span>
									)}
									{link.dedicationExpiresAt && (
										<span className="text-gray-400">
											{" "}
											— ההקדשה פגה {link.dedicationExpiresAt}
										</span>
									)}
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-gray-500">אין הקדשות משויכות</p>
					)}
					<p className="mt-2 text-xs text-gray-400">
						ניהול ההקצאות מתבצע ב
						<Link
							to="/dedications"
							className="text-blue-600 hover:text-blue-700"
						>
							דף ההקדשות
						</Link>{" "}
						— ההקדשה היא הבעלים של סט היעדים שלה
					</p>
				</RelationshipSection>

				{/* Article-owned moed links (#3101) — managed in the form. */}
				<RelationshipSection entry={requireEntry(registry, "moadim")}>
					{isLoading ? (
						<p className="text-sm text-gray-400">טוען…</p>
					) : isError ? null : data?.moadim === undefined ? (
						<p className="text-sm text-gray-400">
							סכמת המועדים עוד לא נפרסה
						</p>
					) : data.moadim.length > 0 ? (
						<ul className="text-sm text-gray-700 space-y-1">
							{data.moadim.map((moed) => (
								<li key={moed.id}>
									<span className="font-medium">{moed.name}</span>{" "}
									<span className="text-xs text-gray-400">({moed.slug})</span>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-gray-500">אין מועדים משויכים</p>
					)}
					<p className="mt-2 text-xs text-gray-400">
						המאמר הוא הבעלים של סט המועדים שלו — נערך בטופס המאמר; ניהול
						הקטלוג מתבצע ב
						<Link to="/moadim" className="text-blue-600 hover:text-blue-700">
							דף המועדים
						</Link>
					</p>
				</RelationshipSection>

				{/* Pipeline-owned mention annotations — read-only. */}
				<RelationshipSection
					entry={requireEntry(registry, "mentionAnnotations")}
				>
					{isLoading ? (
						<p className="text-sm text-gray-400">טוען…</p>
					) : isError ? null : data?.mentionAnnotations === undefined ? (
						<p className="text-sm text-gray-400">
							סכמת אנוטציות התנכפדיה עוד לא נפרסה
						</p>
					) : data.mentionAnnotations.length > 0 ? (
						<ul className="text-sm text-gray-700 space-y-1">
							{data.mentionAnnotations.map((annotation) => (
								<li key={annotation.id} className="flex flex-wrap gap-x-2">
									<span className="font-medium">{annotation.surface}</span>
									<span className="text-gray-500">
										→ {annotation.intendedName}
									</span>
									<span className="text-gray-400">
										({annotation.entityType}
										{annotation.confidence ? `, ${annotation.confidence}` : ""},{" "}
										{annotation.acceptance})
									</span>
									{!annotation.currentContent && (
										<span className="text-amber-600">
											לא עדכני — התוכן השתנה
										</span>
									)}
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-gray-500">אין אנוטציות מאוחסנות</p>
					)}
					<p className="mt-2 text-xs text-gray-400">
						אנוטציות מיוצרות על ידי צינור התנכפדיה בלבד — לקריאה בלבד; אין נתיב
						כתיבה באדמין או ב-API
					</p>
				</RelationshipSection>

				{/* Pending-schema relationships — surfaced, never fabricated. */}
				{pending.map((entry) => (
					<RelationshipSection key={entry.key} entry={entry}>
						<p className="text-sm text-gray-400">
							ממתין לסכמה — יוטמע דרך חוזה זה כאשר issue #{entry.pendingIssue}{" "}
							ייכנס ל-master
						</p>
					</RelationshipSection>
				))}
			</div>
		</section>
	);
}

function RelationshipSection({
	entry,
	children,
}: {
	entry: ArticleRelationshipEntry;
	children: React.ReactNode;
}) {
	return (
		<div className="px-8 py-5">
			<div className="flex items-baseline gap-3 mb-2">
				<h3 className="text-sm font-semibold text-gray-800">{entry.label}</h3>
				<span className="text-xs text-gray-400">
					{entry.cardinality === "exactly-one" ? "בדיוק אחד" : "רבים"} ·{" "}
					{entry.key}
				</span>
			</div>
			{children}
		</div>
	);
}

export function requireEntry(
	entries: ArticleRelationshipEntry[],
	key: string,
): ArticleRelationshipEntry {
	const entry = entries.find((e) => e.key === key) ?? relationshipFor(key);
	if (!entry) {
		throw new Error(`registry entry missing: ${key}`);
	}
	return entry;
}
