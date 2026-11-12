import { createFileRoute } from "@tanstack/react-router";
import { ArchivePage } from "~/components/archive/ArchivePage";

export const Route = createFileRoute("/archive/")({ component: ArchivePage });
