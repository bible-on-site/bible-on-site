import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useMatch,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
	CATEGORY_HIERARCHY,
	labelForCategoryKey,
	websiteSubcategoryPath,
} from "~/lib/tanahpedia/category-hierarchy";
import { CATEGORY_LABELS, type CategoryKey } from "~/lib/tanahpedia/labels";
import {
	getTanahpediaCategoryCounts,
	listTanahpediaEntriesForAdmin,
} from "~/server/tanahpedia/entries";

const WEBSITE_BASE =
	typeof import.meta.env.VITE_WEBSITE_URL === "string"
		? import.meta.env.VITE_WEBSITE_URL.replace(/\/$/, "")
		: "http://localhost:3001";

type TanahpediaSearch = {
	category?: CategoryKey;
	q?: string;
};

function categoryFromSearch(raw: unknown): CategoryKey | undefined {
	if (typeof raw !== "string") return undefined;
	const c = raw.trim().toUpperCase();
	if (Object.hasOwn(CATEGORY_LABELS, c)) {
		return c as CategoryKey;
	}
	return undefined;
}

export const Route = createFileRoute("/tanahpedia")({
	validateSearch: (search: Record<string, unknown>): TanahpediaSearch => ({
		category: categoryFromSearch(search.category),
		q: typeof search.q === "string" ? search.q : undefined,
	}),
	component: TanahpediaLayout,
});

function TanahpediaLayout() {
	const entriesMatch = useMatch({
		from: "/tanahpedia/entries/$id",
		shouldThrow: false,
	});
	const personsMatch = useMatch({
		from: "/tanahpedia/persons",
		shouldThrow: false,
	});
	const placesMatch = useMatch({
		from: "/tanahpedia/places",
		shouldThrow: false,
	});

	if (entriesMatch || personsMatch || placesMatch) {
		return <Outlet />;
	}

	return <TanahpediaIndexPage />;
}

function TanahpediaIndexPage() {
	const navigate = useNavigate({ from: "/tanahpedia" });
	const { category, q } = useSearch({ from: "/tanahpedia" });
	const [qInput, setQInput] = useState(q ?? "");

	useEffect(() => {
		setQInput(q ?? "");
	}, [q]);

	useEffect(() => {
		const t = setTimeout(() => {
			const nextQ = qInput.trim() || undefined;
			const curQ = q?.trim() || undefined;
			if (nextQ === curQ) return;
			navigate({
				search: (prev) => ({ ...prev, q: nextQ }),
				replace: true,
			});
		}, 350);
		return () => clearTimeout(t);
	}, [qInput, navigate, q]);

	const setCategory = useCallback(
		(next: CategoryKey | undefined) => {
			navigate({
				search: (prev) => ({
					...prev,
					category: next,
				}),
				replace: true,
			});
		},
		[navigate],
	);

	const { data: countPayload, isLoading: countsLoading } = useQuery({
		queryKey: ["tanahpedia-admin-counts"],
		queryFn: () => getTanahpediaCategoryCounts(),
	});

	const { data: entries, isLoading: listLoading } = useQuery({
		queryKey: ["tanahpedia-admin-entries", category, q],
		queryFn: () =>
			listTanahpediaEntriesForAdmin({
				data: {
					category,
					q,
				},
			}),
	});

	const counts = countPayload?.counts;

	return (
		<div className="space-y-8">
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">תנכפדיה</h1>
					<p className="text-gray-500 mt-1">
						ניהול ערכים לפי קטגוריות כמו באתר, חיפוש ועריכת HTML
					</p>
				</div>
				<Link
					to="/tanahpedia/entries/$id"
					params={{ id: "new" }}
					search={{}}
					className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium text-sm shadow-sm"
				>
					+ ערך חדש
				</Link>
			</div>

			<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="bg-linear-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
					<h2 className="font-semibold text-gray-900 flex items-center gap-2">
						<span>🔎</span>
						<span>חיפוש ערכים</span>
					</h2>
				</div>
				<div className="p-6 flex flex-col sm:flex-row gap-3 sm:items-center border-b border-gray-100">
					<input
						type="search"
						value={qInput}
						onChange={(e) => setQInput(e.target.value)}
						placeholder="חיפוש לפי כותרת או שם ייחודי…"
						className="flex-1 border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
						dir="rtl"
					/>
					<button
						type="button"
						onClick={() => {
							setQInput("");
							navigate({
								search: (prev) => ({ ...prev, q: undefined }),
								replace: true,
							});
						}}
						className="shrink-0 bg-gray-100 text-gray-800 px-5 py-3 rounded-lg hover:bg-gray-200 transition-all font-medium text-sm border border-gray-200"
					>
						נקה חיפוש
					</button>
				</div>
				{category && (
					<div className="px-6 py-3 flex flex-wrap gap-2 items-center text-sm border-b border-gray-100 bg-gray-50/50">
						<span className="text-gray-500">מסנן פעיל:</span>
						<span className="font-medium text-blue-800 bg-blue-50 px-2 py-1 rounded">
							{labelForCategoryKey(category)}
						</span>
						<button
							type="button"
							onClick={() => setCategory(undefined)}
							className="text-blue-600 hover:text-blue-800 underline"
						>
							הצג את כל הערכים
						</button>
					</div>
				)}

				<div className="p-0">
					<div className="px-6 py-3 flex justify-between items-center flex-wrap gap-2 border-b border-gray-100 bg-white">
						<h3 className="text-base font-semibold text-gray-900">תוצאות</h3>
						<span className="text-sm text-gray-500">
							{listLoading ? "טוען…" : `${entries?.length ?? 0} ערכים`}
						</span>
					</div>
					{listLoading ? (
						<div className="flex items-center justify-center h-28">
							<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
						</div>
					) : (
						<div className="divide-y divide-gray-100 max-h-[min(420px,50vh)] overflow-y-auto">
							{entries?.map((entry) => (
								<Link
									key={entry.id}
									to="/tanahpedia/entries/$id"
									params={{ id: entry.id }}
									search={{}}
									className="flex justify-between items-center px-6 py-3 hover:bg-gray-50 transition-colors gap-4"
								>
									<div className="min-w-0">
										<span className="font-medium text-gray-900 block truncate">
											{entry.title}
										</span>
										<span className="text-sm text-gray-500 truncate block">
											{entry.unique_name}
										</span>
									</div>
									<span className="text-xs text-gray-400 shrink-0">
										{new Date(entry.updated_at).toLocaleDateString("he-IL")}
									</span>
								</Link>
							))}
							{entries?.length === 0 && (
								<div className="px-6 py-8 text-center text-gray-500">
									אין ערכים התואמים לסינון
								</div>
							)}
						</div>
					)}
				</div>
			</div>

			<section>
				<h2 className="text-xl font-semibold text-gray-900 mb-4">קטגוריות</h2>
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{CATEGORY_HIERARCHY.map((cat) => (
						<div
							key={cat.type}
							className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
						>
							<div className="p-4 border-b border-gray-100 flex justify-between items-start gap-2">
								<button
									type="button"
									onClick={() =>
										setCategory(
											category === cat.type ? undefined : cat.type,
										)
									}
									className={`text-right flex-1 rounded-lg p-2 -m-2 transition-colors ${
										category === cat.type
											? "bg-blue-50 ring-2 ring-blue-200"
											: "hover:bg-gray-50"
									}`}
								>
									<div className="font-semibold text-gray-900">
										{CATEGORY_LABELS[cat.type]}
									</div>
									<div className="text-sm text-gray-500 mt-1">
										{countsLoading
											? "…"
											: `${counts?.[cat.type] ?? 0} ערכים`}
									</div>
								</button>
								<a
									href={`${WEBSITE_BASE}/tanahpedia/${cat.type.toLowerCase()}`}
									target="_blank"
									rel="noopener noreferrer"
									className="shrink-0 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded border border-blue-100 hover:bg-blue-50"
								>
									אתר ↗
								</a>
							</div>
							{cat.children && cat.children.length > 0 && (
								<div className="p-3 flex flex-wrap gap-2 bg-gray-50/80">
									{cat.children.map((sub) => (
										<div key={sub} className="flex items-center gap-1">
											<button
												type="button"
												onClick={() =>
													setCategory(category === sub ? undefined : sub)
												}
												className={`text-sm px-3 py-1.5 rounded-lg border transition-all ${
													category === sub
														? "bg-blue-600 text-white border-blue-600"
														: "bg-white border-gray-200 text-gray-800 hover:border-blue-300"
												}`}
											>
												{CATEGORY_LABELS[sub]}
												<span className="text-xs opacity-80 mr-1">
													({countsLoading ? "…" : (counts?.[sub] ?? 0)})
												</span>
											</button>
											<a
												href={`${WEBSITE_BASE}${websiteSubcategoryPath(sub)}`}
												target="_blank"
												rel="noopener noreferrer"
												className="text-[10px] text-gray-400 hover:text-blue-600 px-0.5"
												title="פתח באתר"
											>
												↗
											</a>
										</div>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			</section>

			<div className="flex flex-wrap gap-3">
				<Link
					to="/tanahpedia/persons"
					className="bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm hover:border-blue-300 text-sm font-medium text-gray-800"
				>
					ניהול אישים (ישויות)
				</Link>
				<Link
					to="/tanahpedia/places"
					className="bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm hover:border-blue-300 text-sm font-medium text-gray-800"
				>
					ניהול מקומות (ישויות)
				</Link>
			</div>
		</div>
	);
}
