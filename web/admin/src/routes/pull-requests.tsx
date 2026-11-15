import { createFileRoute } from "@tanstack/react-router";
import {
	ContributionWorkspace,
	validateContributionSearch,
} from "~/components/tanahpedia/ContributionWorkspace";

export const Route = createFileRoute("/pull-requests")({
	validateSearch: validateContributionSearch,
	component: () => <ContributionWorkspace kind="pr" />,
});
