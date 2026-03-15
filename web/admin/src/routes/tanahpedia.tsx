import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getEntries } from "~/server/tanahpedia/entries";

export const Route = createFileRoute("/tanahpedia")({
	component: TanahpediaIndexPage,
});

function TanahpediaIndexPage() {
	const { data: entries, isLoading } = useQuery({
		queryKey: ["tanahpedia-entries"],
		queryFn: () => getEntries(),
	});

	return (
		<div className="space-y-8">
			<div className="flex justify-between items-center">
				<h1 className="text-3xl font-bold text-gray-900">תנ&quot;ךפדיה</h1>
				<div className="flex gap-3">
					<Link
						to="/tanahpedia/entries/$id"
						params={{ id: "new" }}
						className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all font-medium text-sm shadow-sm"
					>
						+ ערך חדש
					</Link>
				</div>
			</div>

			<div className="grid md:grid-cols-3 gap-4">
				<Link
					to="/tanahpedia/entries/$id"
					params={{ id: "new" }}
					className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all"
				>
					<h3 className="text-lg font-semibold text-gray-900">ערכים</h3>
					<p className="text-sm text-gray-500 mt-1">
						{entries?.length ?? "..."} ערכים
					</p>
				</Link>
				<Link
					to="/tanahpedia/persons"
					className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all"
				>
					<h3 className="text-lg font-semibold text-gray-900">אישים</h3>
					<p className="text-sm text-gray-500 mt-1">ניהול אישים</p>
				</Link>
				<Link
					to="/tanahpedia/places"
					className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-all"
				>
					<h3 className="text-lg font-semibold text-gray-900">מקומות</h3>
					<p className="text-sm text-gray-500 mt-1">ניהול מקומות</p>
				</Link>
			</div>

			<div className="bg-white rounded-xl shadow-sm border border-gray-200">
				<div className="p-6 border-b border-gray-200">
					<h2 className="text-xl font-semibold text-gray-900">ערכים אחרונים</h2>
				</div>
				{isLoading ? (
					<div className="flex items-center justify-center h-32">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
					</div>
				) : (
					<div className="divide-y divide-gray-100">
						{entries?.map((entry) => (
							<Link
								key={entry.id}
								to="/tanahpedia/entries/$id"
								params={{ id: entry.id }}
								className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors"
							>
								<div>
									<span className="font-medium text-gray-900">
										{entry.title}
									</span>
									<span className="text-sm text-gray-500 mr-3">
										{entry.unique_name}
									</span>
								</div>
								<span className="text-xs text-gray-400">
									{new Date(entry.updated_at).toLocaleDateString("he-IL")}
								</span>
							</Link>
						))}
						{entries?.length === 0 && (
							<div className="p-8 text-center text-gray-500">
								אין ערכים עדיין
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
