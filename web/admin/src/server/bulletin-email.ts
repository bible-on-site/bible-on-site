import { createServerFn } from "@tanstack/react-start";
import {
	validateAudienceChange,
	validateEmailQueueRequest,
	validateSubscriberChange,
} from "~/lib/bulletin-email";
import { validateBulletinDate } from "~/lib/daily-bulletin";

export const getDailyBulletinEmail = createServerFn({ method: "GET" })
	.validator(validateBulletinDate)
	.handler(async ({ data }) => {
		const { getBulletinEmailState } = await import("./ses-settings.server");
		return getBulletinEmailState(data);
	});

export const queueDailyBulletinEmail = createServerFn({ method: "POST" })
	.validator(validateEmailQueueRequest)
	.handler(async ({ data }) => {
		const { enqueueBulletinEmail } = await import("./ses-delivery.server");
		return enqueueBulletinEmail(data.date, data.requestKey, {
			audience: data.audience,
			revision: data.revision,
		});
	});

export const setDailyBulletinEmailAudience = createServerFn({ method: "POST" })
	.validator(validateAudienceChange)
	.handler(async ({ data }) => {
		const { setEmailAudience } = await import("./ses-settings.server");
		return setEmailAudience(data);
	});

export const changeDailyBulletinSubscriber = createServerFn({ method: "POST" })
	.validator(validateSubscriberChange)
	.handler(async ({ data }) => {
		const { changeSubscriber } = await import("./ses-settings.server");
		return changeSubscriber(data);
	});
