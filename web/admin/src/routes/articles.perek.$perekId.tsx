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
		<div className="bg-white rounded-lg shadow border border-gray-200">
			<div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center">
				<h2 className="font-semibold text-gray-900">
					מאמרים בפרק {perek?.perek ?? perekId} ({perek?.sefer_name ?? ""})
				</h2>
				<Link
					to="/articles/$id"
					params={{ id: "new" }}
					search={{ perekId: perekIdNum }}
					className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors"
				>
					+ מאמר חדש לפרק זה
				</Link>
			</div>

			{articles?.length === 0 ? (
				<div className="p-8 text-center text-gray-500">
					אין מאמרים בפרק זה עדיין
				</div>
			) : (
				<div className="divide-y divide-gray-200">
					{articles?.map((article: Article) => (
						<div
							key={article.id}
							className="px-4 py-3 flex justify-between items-center hover:bg-gray-50"
						>
							<div>
								<Link
									to="/articles/$id"
									params={{ id: String(article.id) }}
									search={{}}
									className="text-blue-600 hover:text-blue-800 font-medium"
								>
									{article.name || "(ללא כותרת)"}
								</Link>
								{article.author_name && (
									<span className="text-sm text-gray-500 mr-2">
										מאת: {article.author_name}
									</span>
								)}
							</div>
							<div className="flex gap-2">
								<Link
									to="/articles/$id"
									params={{ id: String(article.id) }}
									search={{}}
									className="text-gray-600 hover:text-blue-600 px-2 py-1 text-sm"
								>
									עריכה
								</Link>
								<button
									type="button"
									onClick={() => handleDelete(article)}
									className="text-red-600 hover:text-red-800 px-2 py-1 text-sm"
									disabled={deleteMutation.isPending}
								>
									מחיקה
								</button>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
