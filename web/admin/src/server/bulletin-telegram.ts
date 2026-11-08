import { createServerFn } from "@tanstack/react-start";
import {
	validateTelegramAudienceChange,
	validateTelegramQueueRequest,
} from "~/lib/bulletin-telegram";
import { validateBulletinDate } from "~/lib/daily-bulletin";

export const getDailyBulletinTelegram = createServerFn({ method: "GET" })
	.validator(validateBulletinDate)
	.handler(async ({ data }) => {
		const { getBulletinTelegramState } = await import(
			"./telegram-delivery.server"
		);
		return getBulletinTelegramState(data);
	});

export const queueDailyBulletinTelegram = createServerFn({ method: "POST" })
	.validator(validateTelegramQueueRequest)
	.handler(async ({ data }) => {
		const { enqueueBulletinTelegram } = await import(
			"./telegram-delivery.server"
		);
		return enqueueBulletinTelegram(data);
	});

export const setDailyBulletinTelegramAudience = createServerFn({
	method: "POST",
})
	.validator(validateTelegramAudienceChange)
	.handler(async ({ data }) => {
		const { setTelegramAudience } = await import("./telegram-delivery.server");
		return setTelegramAudience(data);
	});
