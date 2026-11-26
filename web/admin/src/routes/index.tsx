import { createFileRoute } from "@tanstack/react-router";
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
	return <ContributionWorkspace key={kind} kind={kind} />;
}
