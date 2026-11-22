import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarDays,
	FileText,
	Heart,
	type LucideIcon,
	Newspaper,
	UserRound,
} from "lucide-react";
import { hebrewBulletinDate, todayInJerusalem } from "~/lib/daily-bulletin";
import { type DashboardTarget, dashboardStats } from "~/lib/dashboard";
import { getArticles } from "~/server/articles";
import { getAuthors } from "~/server/authors";
import { listDedications } from "~/server/dedications";
import { listMoadim } from "~/server/moadim";

const STAT_ICONS: Record<DashboardTarget, LucideIcon> = {
	"/articles": FileText,
	"/rabbis": UserRound,
	"/dedications": Heart,
	"/moadim": CalendarDays,
	"/bulletins": Newspaper,
};

/**
 * Live-count stat strip above the contribution queues (#3714). Every card
 * links to the management page its number describes - no decorative cards.
 */
export function HomeDashboard() {
	// staleTime 0 keeps the counts fresh on every home visit even though the
	// management mutations invalidate narrower query keys.
	const articles = useQuery({
		queryKey: ["articles"],
		queryFn: () => getArticles(),
		staleTime: 0,
	});
	const rabbis = useQuery({
		queryKey: ["authors"],
		queryFn: () => getAuthors(),
		staleTime: 0,
	});
	const dedications = useQuery({
		queryKey: ["dedications", "", "active"],
		queryFn: () => listDedications({ data: { show: "active" } }),
		staleTime: 0,
	});
	const moadim = useQuery({
		queryKey: ["moadim"],
		queryFn: () => listMoadim(),
		staleTime: 0,
	});

	const stats = dashboardStats({
		articles: articles.data?.length,
		rabbis: rabbis.data?.length,
		activeDedications: dedications.data?.length,
		moadim: moadim.data?.length,
		todayHebrew: hebrewBulletinDate(todayInJerusalem()),
	});

	return (
		<div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
			{stats.map((stat) => {
				const Icon = STAT_ICONS[stat.to] ?? FileText;
				return (
					<Link
						key={stat.to}
						to={stat.to}
						className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-4 hover:border-blue-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2 transition-all"
					>
						<span className="flex items-center gap-2 text-sm font-medium text-gray-500">
							<Icon size={16} aria-hidden="true" />
							{stat.label}
						</span>
						<span className="block mt-2 text-2xl font-bold text-gray-900">
							{stat.value}
						</span>
					</Link>
				);
			})}
		</div>
	);
}
