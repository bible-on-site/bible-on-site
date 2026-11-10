import { createFileRoute } from "@tanstack/react-router";
import { UploadSettings } from "~/components/UploadSettings";

export const Route = createFileRoute("/uploads")({ component: UploadSettings });
