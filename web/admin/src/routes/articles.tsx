import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useMatch,
} from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildPerekOptions, filterPerekOptions } from "~/lib/perek-options";
import { getPerakim } from "~/server/perakim";

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
	const [interactive, setInteractive] = useState(false);
	useEffect(() => setInteractive(true), []);
	const [navQuery, setNavQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const listboxRef = useRef<HTMLDivElement>(null);

	const { data: perakim } = useQuery({
		queryKey: ["perakim"],
		queryFn: () => getPerakim(),
	});

	const options = useMemo(() => buildPerekOptions(perakim ?? []), [perakim]);
	const matches = filterPerekOptions(options, navQuery);
	const activeOption = matches[Math.min(activeIndex, matches.length - 1)];

	const jumpTo = (perekId: number) => {
		window.location.href = `/articles/perek/${perekId}`;
	};

	// Reveal the first option after a reset without touching page scroll.
	const resetSelection = () => {
		setActiveIndex(0);
		if (listboxRef.current) listboxRef.current.scrollTop = 0;
	};

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
					<Plus size={18} aria-hidden="true" />
					<span>מאמר חדש</span>
				</Link>
			</div>

			{/* Perek navigation */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
				<div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
					<h2 className="font-semibold text-gray-900 flex items-center gap-2">
						<Search size={18} aria-hidden="true" />
						<span>ניווט לפרק</span>
					</h2>
				</div>
				<div className="p-6">
					<input
						role="combobox"
						aria-expanded="true"
						aria-controls="perek-nav-options"
						aria-activedescendant={
							activeOption ? `perek-option-${activeOption.perekId}` : undefined
						}
						aria-label="חיפוש ספר ופרק"
						type="search"
						disabled={!interactive}
						value={navQuery}
						onChange={(e) => {
							setNavQuery(e.target.value);
							resetSelection();
						}}
						placeholder="חיפוש ספר או פרק..."
						className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
						onKeyDown={(e) => {
							if (e.key === "ArrowDown" || e.key === "ArrowUp") {
								e.preventDefault();
								const next =
									e.key === "ArrowDown"
										? Math.min(activeIndex + 1, matches.length - 1)
										: Math.max(activeIndex - 1, 0);
								setActiveIndex(next);
								// Keep the selection inside the scrollable list; runs
								// only on arrow keys so the page never scrolls on load.
								const option = matches[next];
								if (option) {
									document
										.getElementById(`perek-option-${option.perekId}`)
										?.scrollIntoView?.({ block: "nearest" });
								}
							} else if (e.key === "Enter") {
								// A digit query still jumps straight to the canonical perek
								// number, even while the option list is still loading.
								const numeric = /^\d+$/.test(navQuery.trim())
									? Number(navQuery.trim())
									: null;
								const target =
									activeOption?.perekId ??
									(numeric && numeric <= 929 ? numeric : undefined);
								if (target) jumpTo(target);
							} else if (e.key === "Escape") {
								setNavQuery("");
								resetSelection();
							}
						}}
					/>
					<div
						ref={listboxRef}
						id="perek-nav-options"
						role="listbox"
						aria-label="פרקים"
						className="mt-3 max-h-96 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg"
					>
						{matches.map((option) => (
							<Link
								key={option.perekId}
								id={`perek-option-${option.perekId}`}
								role="option"
								aria-selected={option === activeOption}
								to="/articles/perek/$perekId"
								params={{ perekId: String(option.perekId) }}
								className={`flex justify-between items-center gap-4 px-4 py-2.5 hover:bg-blue-50 focus-visible:bg-blue-50 focus-visible:outline-none transition-colors ${
									option === activeOption ? "bg-blue-50" : ""
								}`}
							>
								<span className="font-medium text-gray-900">
									{option.seferName}
								</span>
								<span className="text-gray-600">פרק {option.label}</span>
							</Link>
						))}
						{matches.length === 0 && (
							<div className="px-4 py-6 text-center text-gray-500">
								אין פרקים תואמים
							</div>
						)}
					</div>
					{options.length > matches.length && (
						<p className="text-gray-400 text-sm mt-2">
							{matches.length} מתוך {options.length} פרקים
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
