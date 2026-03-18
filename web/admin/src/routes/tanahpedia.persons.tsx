import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getPersons } from "~/server/tanahpedia/persons";

export const Route = createFileRoute("/tanahpedia/persons")({
	component: PersonsListPage,
});

function PersonsListPage() {
	const { data: persons, isLoading } = useQuery({
		queryKey: ["tanahpedia-persons"],
		queryFn: () => getPersons(),
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
					<h1 className="text-3xl font-bold text-gray-900 mt-2">אישים</h1>
				</div>
			</div>

			<div className="bg-white rounded-xl shadow-sm border border-gray-200">
				{isLoading ? (
					<div className="flex items-center justify-center h-32">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
					</div>
				) : (
					<div className="divide-y divide-gray-100">
						{persons?.map((person) => (
							<div
								key={person.id}
								className="flex justify-between items-center p-4 hover:bg-gray-50 transition-colors"
							>
								<div>
									<span className="font-medium text-gray-900">
										{person.name ?? "ללא שם"}
									</span>
									{person.sex && (
										<span className="text-sm text-gray-500 mr-3">
											(
											{person.sex === "MALE"
												? "זכר"
												: person.sex === "FEMALE"
													? "נקבה"
													: "לא ידוע"}
											)
										</span>
									)}
								</div>
							</div>
						))}
						{persons?.length === 0 && (
							<div className="p-8 text-center text-gray-500">
								אין אישים עדיין
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
