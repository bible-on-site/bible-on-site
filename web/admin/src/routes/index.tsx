import { createFileRoute } from "@tanstack/react-router";
import { HomeDashboard } from "~/components/HomeDashboard";
import {
	ContributionWorkspace,
	validateContributionHomeSearch,
} from "~/components/tanahpedia/ContributionWorkspace";

export const Route = createFileRoute("/")({
	validateSearch: validateContributionHomeSearch,
	component: HomePage,
});

function HomePage() {
	const search = Route.useSearch();
	const kind = search.tab === "prs" ? "pr" : "issue";
	return (
		<div className="space-y-6">
			{!search.id && <HomeDashboard />}
			<ContributionWorkspace key={kind} kind={kind} />
		</div>
	);
}
