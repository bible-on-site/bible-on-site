import { createServerFn } from "@tanstack/react-start";
import {
	validateAudienceChange,
	validateEmailQueueRequest,
	validateInactivityUnsubscribe,
	validateSubscriberChange,
} from "~/lib/bulletin-email";
import { validateRolloutChange } from "~/lib/bulletin-rollout";
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

export const setDailyBulletinEmailRollout = createServerFn({ method: "POST" })
	.validator(validateRolloutChange)
	.handler(async ({ data }) => {
		const { setRolloutState } = await import("./rollout-state.server");
		return setRolloutState(data);
	});

export const getDailyBulletinEmailEngagement = createServerFn({
	method: "GET",
}).handler(async () => {
	const { readEmailEngagementPanel } = await import(
		"./bulletin-engagement.server"
	);
	return readEmailEngagementPanel();
});

export const confirmDailyBulletinInactivityUnsubscribe = createServerFn({
	method: "POST",
})
	.validator(validateInactivityUnsubscribe)
	.handler(async ({ data }) => {
		const { resolveEditorIdentity } = await import("./editor-identity");
		const { confirmInactivityUnsubscribe } = await import(
			"./bulletin-engagement.server"
		);
		// The session edge already gates this call to admins; the resolved
		// identity is recorded on the subscriber row as the acting admin.
		await confirmInactivityUnsubscribe(
			data.subscriberId,
			(await resolveEditorIdentity()).id,
		);
	});
