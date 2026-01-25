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
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<h1 className="text-2xl font-bold text-gray-900">ניהול רבנים</h1>
				<Link
					to="/rabbis/$id"
					params={{ id: "new" }}
					className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
				>
					+ רב חדש
				</Link>
			</div>

			{authors?.length === 0 ? (
				<div className="bg-gray-50 rounded-lg p-8 text-center border border-gray-200">
					<p className="text-gray-500">אין רבנים במערכת</p>
					<Link
						to="/rabbis/$id"
						params={{ id: "new" }}
						className="text-blue-600 hover:underline mt-2 inline-block"
					>
						הוסף רב חדש
					</Link>
				</div>
			) : (
				<div className="bg-white rounded-lg shadow border border-gray-200">
					<div className="grid gap-4 p-4">
						{authors?.map((author: Author) => (
							<div
								key={author.id}
								className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg"
							>
								{author.imageUrl ? (
									<img
										src={author.imageUrl}
										alt={author.name}
										className="w-16 h-16 rounded-full object-cover"
									/>
								) : (
									<div className="w-16 h-16 rounded-full bg-gray-300 flex items-center justify-center text-gray-500 text-2xl">
										👤
									</div>
								)}
								<div className="flex-1">
									<h3 className="font-semibold text-gray-900">{author.name}</h3>
									<p className="text-gray-600 text-sm line-clamp-2">
										{author.details}
									</p>
								</div>
								<div className="flex gap-2">
									<Link
										to="/rabbis/$id"
										params={{ id: String(author.id) }}
										className="text-blue-600 hover:text-blue-700 px-3 py-1 border border-blue-600 rounded hover:bg-blue-50 transition-colors"
									>
										עריכה
									</Link>
									<button
										type="button"
										onClick={() => handleDelete(author)}
										className="text-red-600 hover:text-red-700 px-3 py-1 border border-red-600 rounded hover:bg-red-50 transition-colors"
									>
										מחק
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
