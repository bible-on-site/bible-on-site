import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AutoSaveIndicator } from "~/components/AutoSaveIndicator";
import { WysiwygEditor } from "~/components/WysiwygEditor";
import {
	type Article,
	createArticle,
	deleteArticle,
	getArticle,
	invalidateArticleCache,
	invalidatePerekCache,
	updateArticle,
} from "~/server/articles";
import { type Author, getAuthors } from "~/server/authors";

interface ArticleFormData {
	perek_id: number;
	author_id: number;
	abstract: string;
	name: string;
	priority: number;
	content: string;
}

type ArticleSearch = {
	perekId?: number;
};

export const Route = createFileRoute("/articles/$id")({
	validateSearch: (search: Record<string, unknown>): ArticleSearch => {
		return {
			perekId: search.perekId ? Number(search.perekId) : undefined,
		};
	},
	component: ArticleEditPage,
});

function ArticleEditPage() {
	const { id } = Route.useParams();
	const { perekId: searchPerekId } = useSearch({ from: "/articles/$id" });
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const isNew = id === "new";
	const articleId = isNew ? null : Number.parseInt(id, 10);
	const defaultPerekId = searchPerekId ?? 1;

	const [formData, setFormData] = useState<ArticleFormData>({
		perek_id: defaultPerekId,
		author_id: 1,
		abstract: "",
		name: "",
		priority: 1,
		content: "",
	});

	const [hasChanges, setHasChanges] = useState(false);
	const [lastSaved, setLastSaved] = useState<Date | null>(null);

	const { data: article, isLoading: articleLoading } = useQuery({
		queryKey: ["article", articleId],
		queryFn: () => {
			if (articleId === null) throw new Error("Article ID is required");
			return getArticle({ data: articleId });
		},
		enabled: !!articleId,
	});

	const { data: authors } = useQuery({
		queryKey: ["authors"],
		queryFn: () => getAuthors(),
	});

	// Initialize form with article data
	useEffect(() => {
		if (article) {
			setFormData({
				perek_id: article.perek_id,
				author_id: article.author_id,
				abstract: article.abstract ?? "",
				name: article.name,
				priority: article.priority,
				content: article.content ?? "",
			});
		}
	}, [article]);

	const saveMutation = useMutation({
		mutationFn: async (data: ArticleFormData) => {
			if (isNew || articleId === null) {
				return createArticle({ data });
			}
			return updateArticle({ data: { id: articleId, ...data } });
		},
		onSuccess: async (savedArticle: Article) => {
			queryClient.invalidateQueries({ queryKey: ["article", savedArticle.id] });
			queryClient.invalidateQueries({
				queryKey: ["articles", "perek", savedArticle.perek_id],
			});
			setLastSaved(new Date());
			setHasChanges(false);

			// Invalidate website cache
			await invalidateArticleCache({ data: savedArticle.id });
			await invalidatePerekCache({ data: savedArticle.perek_id });

			if (isNew) {
				navigate({
					to: "/articles/$id",
					params: { id: String(savedArticle.id) },
					search: {},
					replace: true,
				});
			}
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => {
			if (articleId === null) throw new Error("Article ID is required");
			return deleteArticle({ data: articleId });
		},
		onSuccess: async () => {
			if (article) {
				await invalidatePerekCache({ data: article.perek_id });
			}
			navigate({
				to: "/articles/perek/$perekId",
				params: { perekId: String(article?.perek_id ?? 1) },
			});
		},
	});

	const handleFieldChange = useCallback(
		<K extends keyof ArticleFormData>(field: K, value: ArticleFormData[K]) => {
			setFormData((prev) => ({ ...prev, [field]: value }));
			setHasChanges(true);
		},
		[],
	);

	const handleContentChange = useCallback((content: string) => {
		setFormData((prev) => ({ ...prev, content }));
		setHasChanges(true);
	}, []);

	// Auto-save effect
	useEffect(() => {
		if (!hasChanges || saveMutation.isPending) return;

		const timer = setTimeout(() => {
			if (formData.name.trim()) {
				saveMutation.mutate(formData);
			}
		}, 2000);

		return () => clearTimeout(timer);
	}, [formData, hasChanges, saveMutation.isPending, saveMutation]);

	const handleDelete = () => {
		if (window.confirm("האם אתה בטוח שברצונך למחוק את המאמר?")) {
			deleteMutation.mutate();
		}
	};

	if (articleLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<Link
						to="/articles/perek/$perekId"
						params={{ perekId: String(formData.perek_id) }}
						className="text-blue-600 hover:text-blue-700 text-sm"
					>
						← חזרה לפרק {formData.perek_id}
					</Link>
					<h1 className="text-2xl font-bold text-gray-900 mt-1">
						{isNew ? "מאמר חדש" : "עריכת מאמר"}
					</h1>
				</div>
				<div className="flex items-center gap-4">
					<AutoSaveIndicator
						isSaving={saveMutation.isPending}
						lastSaved={lastSaved}
						hasChanges={hasChanges}
					/>
					{!isNew && (
						<button
							type="button"
							onClick={handleDelete}
							className="text-red-600 hover:text-red-700 text-sm"
						>
							מחק מאמר
						</button>
					)}
				</div>
			</div>

			<form className="space-y-6 bg-white p-6 rounded-lg shadow border border-gray-200">
				<div className="grid md:grid-cols-2 gap-6">
					<div>
						<label
							htmlFor="name"
							className="block text-sm font-medium text-gray-700 mb-1"
						>
							שם המאמר *
						</label>
						<input
							id="name"
							type="text"
							value={formData.name}
							onChange={(e) => handleFieldChange("name", e.target.value)}
							className="w-full border border-gray-300 rounded-lg px-4 py-2"
							placeholder="הכנס שם מאמר"
						/>
					</div>

					<div>
						<label
							htmlFor="author"
							className="block text-sm font-medium text-gray-700 mb-1"
						>
							מחבר
						</label>
						<select
							id="author"
							value={formData.author_id}
							onChange={(e) =>
								handleFieldChange(
									"author_id",
									Number.parseInt(e.target.value, 10),
								)
							}
							className="w-full border border-gray-300 rounded-lg px-4 py-2"
						>
							{authors?.map((author: Author) => (
								<option key={author.id} value={author.id}>
									{author.name}
								</option>
							))}
						</select>
					</div>

					<div>
						<label
							htmlFor="perek"
							className="block text-sm font-medium text-gray-700 mb-1"
						>
							פרק (1-929)
						</label>
						<input
							id="perek"
							type="number"
							min={1}
							max={929}
							value={formData.perek_id}
							onChange={(e) =>
								handleFieldChange(
									"perek_id",
									Number.parseInt(e.target.value, 10),
								)
							}
							className="w-full border border-gray-300 rounded-lg px-4 py-2"
						/>
					</div>

					<div>
						<label
							htmlFor="priority"
							className="block text-sm font-medium text-gray-700 mb-1"
						>
							עדיפות (1-10)
						</label>
						<input
							id="priority"
							type="number"
							min={1}
							max={10}
							value={formData.priority}
							onChange={(e) =>
								handleFieldChange(
									"priority",
									Number.parseInt(e.target.value, 10),
								)
							}
							className="w-full border border-gray-300 rounded-lg px-4 py-2"
						/>
					</div>
				</div>

				<div>
					<label
						htmlFor="abstract"
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						תקציר
					</label>
					<textarea
						id="abstract"
						value={formData.abstract}
						onChange={(e) => handleFieldChange("abstract", e.target.value)}
						rows={3}
						className="w-full border border-gray-300 rounded-lg px-4 py-2"
						placeholder="תקציר קצר של המאמר"
					/>
				</div>

				<div>
					{/* biome-ignore lint/a11y/noLabelWithoutControl: WysiwygEditor is a custom component */}
					<label className="block text-sm font-medium text-gray-700 mb-1">
						תוכן המאמר
					</label>
					<WysiwygEditor
						content={formData.content}
						onChange={handleContentChange}
						placeholder="הכנס את תוכן המאמר..."
					/>
				</div>

				<div className="flex justify-end gap-3">
					<Link
						to="/articles/perek/$perekId"
						params={{ perekId: String(formData.perek_id) }}
						className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
					>
						ביטול
					</Link>
					<button
						type="button"
						onClick={() => saveMutation.mutate(formData)}
						disabled={saveMutation.isPending || !formData.name.trim()}
						className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
					>
						{saveMutation.isPending ? "שומר..." : "שמור עכשיו"}
					</button>
				</div>
			</form>
		</div>
	);
}
