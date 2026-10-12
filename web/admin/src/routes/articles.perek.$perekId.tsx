import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	type Article,
	deleteArticle,
	getArticlesByPerek,
} from "~/server/articles";
import { getPerek } from "~/server/perakim";

export const Route = createFileRoute("/articles/perek/$perekId")({
	component: PerekArticles,
});

function PerekArticles() {
	const { perekId } = Route.useParams();
	const perekIdNum = Number.parseInt(perekId, 10);
	const queryClient = useQueryClient();

	const { data: perek } = useQuery({
		queryKey: ["perek", perekIdNum],
		queryFn: () => getPerek({ data: perekIdNum }),
		enabled: !Number.isNaN(perekIdNum),
	});

	const { data: articles, isLoading } = useQuery({
		queryKey: ["articles", "perek", perekIdNum],
		queryFn: () => getArticlesByPerek({ data: perekIdNum }),
		enabled: !Number.isNaN(perekIdNum),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteArticle({ data: id }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["articles", "perek", perekIdNum],
			});
		},
	});

	const handleDelete = (article: Article) => {
		if (confirm(`האם למחוק את המאמר "${article.name}"?`)) {
			deleteMutation.mutate(article.id);
		}
	};

	if (isLoading) {
		return (
			<div className="flex justify-center py-12">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<Link
						to="/articles"
						className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
					>
						<span>→</span>
						<span>חזרה לניהול מאמרים</span>
					</Link>
					<h1 className="text-3xl font-bold text-gray-900 mt-2">
						📖 פרק {perek?.perek ?? perekId}
					</h1>
					{perek?.sefer_name && (
						<p className="text-gray-500 mt-1">ספר {perek.sefer_name}</p>
					)}
				</div>
				<Link
					to="/articles/$id"
					params={{ id: "new" }}
					search={{ perekId: perekIdNum }}
					className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-all shadow-sm hover:shadow-md font-medium"
				>
					<span className="text-lg">+</span>
					<span>מאמר חדש לפרק זה</span>
				</Link>
			</div>

			{/* Articles List */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="bg-linear-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
					<h2 className="font-semibold text-gray-900 flex items-center gap-2">
						<span>📝</span>
						<span>
							מאמרים בפרק זה ({articles?.length ?? 0} מאמרים)
						</span>
					</h2>
				</div>

				{articles?.length === 0 ? (
					<div className="p-12 text-center">
						<div className="text-6xl mb-4">📄</div>
						<h3 className="text-xl font-semibold text-gray-700 mb-2">
							אין מאמרים בפרק זה עדיין
						</h3>
						<p className="text-gray-500 mb-4">
							התחל להוסיף מאמרים לפרק זה
						</p>
						<Link
							to="/articles/$id"
							params={{ id: "new" }}
							search={{ perekId: perekIdNum }}
							className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
						>
							<span>+</span>
							<span>הוסף מאמר חדש</span>
						</Link>
					</div>
				) : (
					<div className="divide-y divide-gray-100">
						{articles?.map((article: Article) => (
							<div
								key={article.id}
								className="px-6 py-5 flex justify-between items-center hover:bg-gray-50 transition-colors"
							>
								<div className="flex-1 min-w-0">
									<Link
										to="/articles/$id"
										params={{ id: String(article.id) }}
										search={{}}
										className="text-blue-600 hover:text-blue-800 font-semibold text-lg block"
									>
										{article.name || "(ללא כותרת)"}
									</Link>
									{article.author_name && (
										<span className="text-sm text-gray-500 mt-1 block">
											👤 מאת: {article.author_name}
										</span>
									)}
								</div>
								<div className="flex gap-3 shrink-0">
									<Link
										to="/articles/$id"
										params={{ id: String(article.id) }}
										search={{}}
										className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 px-4 py-2 border border-blue-200 rounded-lg hover:bg-blue-50 transition-all font-medium text-sm"
									>
										<span>✏️</span>
										<span>עריכה</span>
									</Link>
									<button
										type="button"
										onClick={() => handleDelete(article)}
										className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 px-4 py-2 border border-red-200 rounded-lg hover:bg-red-50 transition-all font-medium text-sm disabled:opacity-50"
										disabled={deleteMutation.isPending}
									>
										<span>🗑️</span>
										<span>מחיקה</span>
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Navigation hints */}
			<div className="flex gap-4">
				{perekIdNum > 1 && (
					<Link
						to="/articles/perek/$perekId"
						params={{ perekId: String(perekIdNum - 1) }}
						className="inline-flex items-center gap-2 text-gray-600 hover:text-blue-600 px-4 py-2 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all"
					>
						<span>→</span>
						<span>פרק {perekIdNum - 1}</span>
					</Link>
				)}
				{perekIdNum < 929 && (
					<Link
						to="/articles/perek/$perekId"
						params={{ perekId: String(perekIdNum + 1) }}
						className="inline-flex items-center gap-2 text-gray-600 hover:text-blue-600 px-4 py-2 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-all"
					>
						<span>פרק {perekIdNum + 1}</span>
						<span>←</span>
					</Link>
				)}
			</div>
		</div>
	);
}
