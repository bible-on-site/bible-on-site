import { createFileRoute, redirect } from "@tanstack/react-router";
import { validateContributionSearch } from "~/components/tanahpedia/ContributionWorkspace";

export const Route = createFileRoute("/pull-requests")({
	validateSearch: validateContributionSearch,
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/",
			search: { ...search, tab: "prs" },
			replace: true,
		});
	},
});
