import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useMatch } from "@tanstack/react-router";
import { useState } from "react";
import { getPerakim, type Perek } from "~/server/perakim";
import { getSefarim, type Sefer } from "~/server/sefarim";
import { formatPerekLabel } from "~/utils/hebrew";

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
		<div className="space-y-8">
			{/* Header */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div>
					<h1 className="text-3xl font-bold text-gray-900">ניהול מאמרים</h1>
					<p className="text-gray-500 mt-1">
						בחר ספר ופרק לצפייה במאמרים או צור מאמר חדש
					</p>
				</div>
				<Link
					to="/articles/$id"
					params={{ id: "new" }}
					search={{}}
					className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-lg hover:bg-blue-700 transition-all shadow-sm hover:shadow-md font-medium"
				>
					<span className="text-lg">+</span>
					<span>מאמר חדש</span>
				</Link>
			</div>

			{/* Quick navigation */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="bg-linear-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
					<h2 className="font-semibold text-gray-900 flex items-center gap-2">
						<span>🚀</span>
						<span>ניווט מהיר לפי פרק</span>
					</h2>
				</div>
				<div className="p-6">
					<div className="flex gap-3">
						<input
							type="number"
							min="1"
							max="929"
							value={perekInput}
							onChange={(e) => setPerekInput(e.target.value)}
							placeholder="מספר פרק (1-929)"
							className="border border-gray-300 rounded-lg px-4 py-3 w-56 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
							onKeyDown={(e) => e.key === "Enter" && handleNavigateToPerek()}
						/>
						<button
							type="button"
							onClick={handleNavigateToPerek}
							className="bg-gray-700 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-all font-medium shadow-sm hover:shadow-md"
						>
							עבור לפרק →
						</button>
					</div>
					<p className="text-gray-500 text-sm mt-3">
						הזן מספר פרק בין 1 ל-929 ולחץ Enter או לחץ על הכפתור
					</p>
				</div>
			</div>

			{/* Sefarim accordion */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="bg-linear-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-gray-200">
					<h2 className="font-semibold text-gray-900 flex items-center gap-2">
						<span>📚</span>
						<span>ספרים ופרקים</span>
					</h2>
				</div>
				<div className="divide-y divide-gray-100">
					{sefarim?.map((sefer: Sefer) => (
						<div key={sefer.id}>
							<button
								type="button"
								onClick={() => toggleSefer(sefer.id)}
								className="w-full flex justify-between items-center px-6 py-4 hover:bg-gray-50 transition-colors text-right group"
							>
								<span className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
									{sefer.name}
								</span>
								<span
									className={`text-gray-400 transition-transform duration-200 ${
										expandedSefarim.includes(sefer.id)
											? "rotate-180"
											: "rotate-0"
									}`}
								>
									▼
								</span>
							</button>
							{expandedSefarim.includes(sefer.id) && (
								<div className="px-6 pb-5 pt-2 bg-gray-50/50">
									<div className="flex flex-wrap gap-2">
										{perakimBySefer?.[sefer.id]?.map((perek: Perek) => (
											<Link
												key={perek.id}
												to="/articles/perek/$perekId"
												params={{ perekId: String(perek.perek_id) }}
												className="px-4 py-2 bg-white hover:bg-blue-100 hover:text-blue-700 border border-gray-200 hover:border-blue-300 rounded-lg text-sm transition-all font-medium shadow-sm"
											>
												{formatPerekLabel(
													perek.perek_in_context ?? perek.perek ?? 0,
													perek.additional_letter,
												)}
											</Link>
										))}
									</div>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
