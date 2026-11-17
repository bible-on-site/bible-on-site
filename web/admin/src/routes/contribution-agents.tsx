import { createFileRoute } from "@tanstack/react-router";
import { ContributionAgents } from "~/components/tanahpedia/ContributionAgents";

export const Route = createFileRoute("/contribution-agents")({
	component: ContributionAgents,
});
