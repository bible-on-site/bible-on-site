import { createFileRoute } from "@tanstack/react-router";
import { DailyBulletinPage } from "~/components/DailyBulletinPage";

export const Route = createFileRoute("/bulletins")({
	component: DailyBulletinPage,
});
