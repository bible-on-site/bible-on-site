import { createFileRoute } from "@tanstack/react-router";
import {
	ContributionWorkspace,
	validateContributionSearch,
} from "~/components/tanahpedia/ContributionWorkspace";

export const Route = createFileRoute("/issues")({
	validateSearch: validateContributionSearch,
	component: () => <ContributionWorkspace kind="issue" />,
});
