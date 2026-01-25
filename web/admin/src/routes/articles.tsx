import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatch } from "@tanstack/react-router";
import { useState } from "react";
import { getPerakim, type Perek } from "~/server/perakim";
import { getSefarim, type Sefer } from "~/server/sefarim";

export const Route = createFileRoute("/articles")({
	component: ArticlesLayout,
});

function ArticlesLayout() {
	// Check if we're on a child route
	const articleMatch = useMatch({
		from: "/articles/$id",
		shouldThrow: false,
	});
	const perekMatch = useMatch({
		from: "/articles/perek/$perekId",
		shouldThrow: false,
	});

	// If we're on a child route, render only the Outlet (child component)
	if (articleMatch || perekMatch) {
		return <Outlet />;
	}

	// Otherwise render the articles navigation page
	return <ArticlesNavPage />;
}

function ArticlesNavPage() {
	const [perekInput, setPerekInput] = useState("");
	const [expandedSefarim, setExpandedSefarim] = useState<number[]>([]);

	const { data: sefarim } = useQuery({
		queryKey: ["sefarim"],
		queryFn: () => getSefarim(),
	});

	const { data: perakim } = useQuery({
		queryKey: ["perakim"],
		queryFn: () => getPerakim(),
	});

	const handleNavigateToPerek = () => {
		const perekNum = Number.parseInt(perekInput, 10);
		if (perekNum >= 1 && perekNum <= 929) {
			window.location.href = `/articles/perek/${perekNum}`;
		}
	};

	const toggleSefer = (seferId: number) => {
		setExpandedSefarim((prev) =>
			prev.includes(seferId)
				? prev.filter((id) => id !== seferId)
				: [...prev, seferId],
		);
	};

	// Group perakim by sefer
	const perakimBySefer = perakim?.reduce<Record<number, Perek[]>>(
		(acc: Record<number, Perek[]>, perek: Perek) => {
			const seferId = perek.sefer_id ?? 0;
			if (!acc[seferId]) {
				acc[seferId] = [];
			}
			acc[seferId].push(perek);
			return acc;
		},
		{},
	);

	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<h1 className="text-2xl font-bold text-gray-900">ניהול מאמרים</h1>
				<Link
					to="/articles/$id"
					params={{ id: "new" }}
					search={{}}
					className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
				>
					+ מאמר חדש
				</Link>
			</div>

			{/* Quick navigation */}
			<div className="bg-white rounded-lg shadow p-4 border border-gray-200">
				<h2 className="font-semibold text-gray-900 mb-3">ניווט מהיר לפי פרק</h2>
				<div className="flex gap-3">
					<input
						type="number"
						min="1"
						max="929"
						value={perekInput}
						onChange={(e) => setPerekInput(e.target.value)}
						placeholder="מספר פרק (1-929)"
						className="border border-gray-300 rounded-lg px-4 py-2 w-48"
						onKeyDown={(e) => e.key === "Enter" && handleNavigateToPerek()}
					/>
					<button
						type="button"
						onClick={handleNavigateToPerek}
						className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
					>
						עבור לפרק
					</button>
				</div>
			</div>

			{/* Sefarim accordion */}
			<div className="bg-white rounded-lg shadow border border-gray-200">
				<h2 className="font-semibold text-gray-900 p-4 border-b border-gray-200">
					ספרים ופרקים
				</h2>
				<div className="divide-y divide-gray-200">
					{sefarim?.map((sefer: Sefer) => (
						<div key={sefer.id}>
							<button
								type="button"
								onClick={() => toggleSefer(sefer.id)}
								className="w-full flex justify-between items-center px-4 py-3 hover:bg-gray-50 transition-colors text-right"
							>
								<span className="font-medium text-gray-900">{sefer.name}</span>
								<span className="text-gray-500">
									{expandedSefarim.includes(sefer.id) ? "▲" : "▼"}
								</span>
							</button>
							{expandedSefarim.includes(sefer.id) && (
								<div className="px-4 pb-3 flex flex-wrap gap-2">
									{perakimBySefer?.[sefer.id]?.map((perek: Perek) => (
										<Link
											key={perek.id}
											to="/articles/perek/$perekId"
											params={{ perekId: String(perek.perek_id) }}
											className="px-3 py-1 bg-gray-100 hover:bg-blue-100 rounded text-sm transition-colors"
										>
											{perek.perek}
										</Link>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
