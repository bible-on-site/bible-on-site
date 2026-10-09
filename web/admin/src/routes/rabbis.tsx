import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatch } from "@tanstack/react-router";
import { type Author, deleteAuthor, getAuthors } from "~/server/authors";

export const Route = createFileRoute("/rabbis")({
	component: RabbisLayout,
});

function RabbisLayout() {
	// Check if we're on a child route (like /rabbis/1 or /rabbis/new)
	const childMatch = useMatch({
		from: "/rabbis/$id",
		shouldThrow: false,
	});

	// If we're on a child route, render the Outlet (child component)
	if (childMatch) {
		return <Outlet />;
	}

	// Otherwise render the list
	return <RabbisListPage />;
}

function RabbisListPage() {
	const queryClient = useQueryClient();

	const { data: authors, isLoading } = useQuery({
		queryKey: ["authors"],
		queryFn: () => getAuthors(),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: number) => deleteAuthor({ data: id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["authors"] });
		},
	});

	const handleDelete = (author: Author) => {
		if (window.confirm(`האם אתה בטוח שברצונך למחוק את "${author.name}"?`)) {
			deleteMutation.mutate(author.id);
		}
	};

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	return (
		<div className="space-y-8">
			{/* Header */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">ניהול רבנים</h1>
					<p className="text-gray-500 mt-1">
						{authors?.length || 0} רבנים במערכת
					</p>
				</div>
				<Link
					to="/rabbis/$id"
					params={{ id: "new" }}
					className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-all shadow-sm hover:shadow-md font-medium"
				>
					<span className="text-lg">+</span>
					<span>רב חדש</span>
				</Link>
			</div>

			{authors?.length === 0 ? (
				<div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm">
					<div className="text-6xl mb-4">👤</div>
					<h3 className="text-xl font-semibold text-gray-700 mb-2">
						אין רבנים במערכת
					</h3>
					<p className="text-gray-500 mb-4">התחל להוסיף רבנים למערכת</p>
					<Link
						to="/rabbis/$id"
						params={{ id: "new" }}
						className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium"
					>
						<span>+</span>
						<span>הוסף רב חדש</span>
					</Link>
				</div>
			) : (
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
					<div className="divide-y divide-gray-100">
						{authors?.map((author: Author) => (
							<div
								key={author.id}
								className="flex items-center gap-5 p-5 hover:bg-gray-50 transition-colors"
							>
							{author.imageUrl ? (
								<img
									src={author.imageUrl}
									alt={author.name}
									className="w-16 h-16 rounded-full object-cover ring-2 ring-gray-100"
								/>
							) : (
								<div className="w-16 h-16 rounded-full bg-linear-to-br from-gray-200 to-gray-300 flex items-center justify-center text-gray-500 text-2xl ring-2 ring-gray-100">
									👤
								</div>
							)}
								<div className="flex-1 min-w-0">
									<h3 className="font-semibold text-gray-900 text-lg">
										{author.name}
									</h3>
									<p className="text-gray-600 text-sm line-clamp-2 mt-1">
										{author.details || "אין תיאור"}
									</p>
								</div>
								<div className="flex gap-3 shrink-0">
									<Link
										to="/rabbis/$id"
										params={{ id: String(author.id) }}
										className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 px-4 py-2 border border-blue-200 rounded-lg hover:bg-blue-50 transition-all font-medium text-sm"
									>
										<span>✏️</span>
										<span>עריכה</span>
									</Link>
									<button
										type="button"
										onClick={() => handleDelete(author)}
										className="inline-flex items-center gap-1.5 text-red-600 hover:text-red-700 px-4 py-2 border border-red-200 rounded-lg hover:bg-red-50 transition-all font-medium text-sm"
									>
										<span>🗑️</span>
										<span>מחק</span>
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
