import { createServerFn } from "@tanstack/react-start";
import { quotaBytes } from "../../../shared/private-upload";
import { uploadStore } from "./uploads-store.server";

export const getUploadSettings = createServerFn({ method: "GET" }).handler(
	async () => uploadStore.settings(),
);
export const setUploadQuota = createServerFn({ method: "POST" })
	.validator((data: { gb: number | null; userId?: string }) => ({
		bytes: data.gb === null ? null : quotaBytes(data.gb),
		userId: data.userId,
	}))
	.handler(async ({ data }) => {
		await uploadStore.setQuota(data.bytes, data.userId);
		return { ok: true };
	});
