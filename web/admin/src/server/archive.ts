import { createServerFn } from "@tanstack/react-start";
import { quotaBytes } from "~/lib/archive";
import { archiveStore } from "./archive-store.server";

export const getUploadSettings = createServerFn({ method: "GET" }).handler(
	async () => archiveStore.settings(),
);
export const setUploadQuota = createServerFn({ method: "POST" })
	.validator((data: { gb: number | null; userId?: string }) => ({
		bytes: data.gb === null ? null : quotaBytes(data.gb),
		userId: data.userId,
	}))
	.handler(async ({ data }) => {
		await archiveStore.setQuota(data.bytes, data.userId);
		return { ok: true };
	});
