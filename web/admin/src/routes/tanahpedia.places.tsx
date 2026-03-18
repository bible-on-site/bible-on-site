import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getPlaces } from "~/server/tanahpedia/places";

export const Route = createFileRoute("/tanahpedia/places")({
	component: PlacesListPage,
});

function PlacesListPage() {
	const { data: places, isLoading } = useQuery({
		queryKey: ["tanahpedia-places"],
		queryFn: () => getPlaces(),
	});

	return (
		<div className="space-y-8">
			<div className="flex justify-between items-center">
				<div>
					<Link
						to="/tanahpedia"
						className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 text-sm font-medium transition-colors"
					>
						<span>→</span>
						<span>חזרה לתנכפדיה</span>
					</Link>
					<h1 className="text-3xl font-bold text-gray-900 mt-2">מקומות</h1>
				</div>
			</div>

			<div className="bg-white rounded-xl shadow-sm border border-gray-200">
				{isLoading ? (
					<div className="flex items-center justify-center h-32">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
					</div>
				) : (
					<div className="divide-y divide-gray-100">
						{places?.map((place) => (
							<div
								key={place.id}
								className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors"
							>
								<span className="font-medium text-gray-900">{place.name}</span>
							</div>
						))}
						{places?.length === 0 && (
							<div className="p-8 text-center text-gray-500">
								אין מקומות עדיין
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
