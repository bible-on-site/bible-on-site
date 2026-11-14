import { createServerFn } from "@tanstack/react-start";
import { validateBulletinDate } from "~/lib/daily-bulletin";

export const getDailyBulletin = createServerFn({ method: "GET" })
	.validator(validateBulletinDate)
	.handler(async ({ data }) => {
		const { readPreparedBulletin } = await import("./daily-bulletins.server");
		return readPreparedBulletin(data);
	});

export const prepareDailyBulletin = createServerFn({ method: "POST" })
	.validator(validateBulletinDate)
	.handler(async ({ data }) => {
		const { prepareBulletin } = await import("./daily-bulletins.server");
		return prepareBulletin(data);
	});
