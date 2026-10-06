"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
	type ArticleSort,
	type ArticleSortKey,
	type AuthorArticleRow,
	DEFAULT_ARTICLE_SORT,
	distinctSefarim,
	filterAuthorArticles,
	sortAuthorArticles,
} from "../../../../lib/authors/articles-grid";
import styles from "./author-articles-table.module.css";

const SORTABLE_COLUMNS: { key: ArticleSortKey; label: string }[] = [
	{ key: "name", label: "שם המאמר" },
	{ key: "sefer", label: "ספר" },
	{ key: "perek", label: "פרק" },
];

function articleHref(row: AuthorArticleRow): string {
	return `/929/${row.perekId}/${row.id}`;
}

function sortAria(
	column: ArticleSortKey,
	sort: ArticleSort,
): "ascending" | "descending" | "none" {
	if (sort.key !== column) return "none";
	return sort.direction === "asc" ? "ascending" : "descending";
}

/**
 * Interactive datagrid of an author's articles with text search,
 * sefer filtering and per-column sorting. Rows navigate to the article.
 */
export function AuthorArticlesTable({ rows }: { rows: AuthorArticleRow[] }) {
	const router = useRouter();
	const [search, setSearch] = useState("");
	const [sefer, setSefer] = useState("");
	const [sort, setSort] = useState<ArticleSort>(DEFAULT_ARTICLE_SORT);

	const sefarim = useMemo(() => distinctSefarim(rows), [rows]);
	const visible = useMemo(
		() => sortAuthorArticles(filterAuthorArticles(rows, search, sefer), sort),
		[rows, search, sefer, sort],
	);

	const toggleSort = (key: ArticleSortKey) =>
		setSort((current) =>
			current.key === key
				? { key, direction: current.direction === "asc" ? "desc" : "asc" }
				: { key, direction: "asc" },
		);

	return (
		<div className={styles.grid}>
			<div className={styles.toolbar}>
				<input
					type="search"
					className={styles.search}
					placeholder="חיפוש מאמר..."
					aria-label="חיפוש מאמר"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
				/>
				<select
					className={styles.seferFilter}
					aria-label="סינון לפי ספר"
					value={sefer}
					onChange={(event) => setSefer(event.target.value)}
				>
					<option value="">כל הספרים</option>
					{sefarim.map((name) => (
						<option key={name} value={name}>
							{name}
						</option>
					))}
				</select>
			</div>

			<div className={styles.tableWrap}>
				<table className={styles.table}>
					<thead>
						<tr>
							{SORTABLE_COLUMNS.map((column) => (
								<th
									key={column.key}
									scope="col"
									aria-sort={sortAria(column.key, sort)}
									className={styles.sortable}
								>
									<button
										type="button"
										className={styles.sortButton}
										onClick={() => toggleSort(column.key)}
									>
										{column.label}
										<span aria-hidden="true" className={styles.sortGlyph}>
											{sort.key === column.key
												? sort.direction === "asc"
													? "▲"
													: "▼"
												: "↕"}
										</span>
									</button>
								</th>
							))}
							<th scope="col" className={styles.abstractColumn}>
								תקציר
							</th>
						</tr>
					</thead>
					<tbody>
						{visible.map((row) => (
							<tr
								key={row.id}
								className={styles.row}
								onClick={(event) => {
									if ((event.target as HTMLElement).closest("a")) return;
									router.push(articleHref(row));
								}}
							>
								<td className={styles.nameCell}>
									<Link href={articleHref(row)} prefetch={false}>
										{row.name}
									</Link>
								</td>
								<td>{row.sefer}</td>
								<td>{row.source}</td>
								<td className={styles.abstractCell}>{row.abstract ?? ""}</td>
							</tr>
						))}
						{visible.length === 0 && (
							<tr>
								<td colSpan={4} className={styles.noResults}>
									לא נמצאו מאמרים תואמים
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			{(search !== "" || sefer !== "") && (
				<p className={styles.resultCount}>
					מציג {visible.length} מתוך {rows.length} מאמרים
				</p>
			)}
		</div>
	);
}
