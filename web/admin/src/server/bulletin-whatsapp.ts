import { createServerFn } from "@tanstack/react-start";
import {
	validateWhatsAppAudienceChange,
	validateWhatsAppQueueRequest,
} from "~/lib/bulletin-whatsapp";
import { validateBulletinDate } from "~/lib/daily-bulletin";

// The shared server entry authenticates every /_serverFn request before dispatch.
// Keep provider and database modules behind that boundary and payload validation.
export const getDailyBulletinWhatsApp = createServerFn({ method: "GET" })
	.validator(validateBulletinDate)
	.handler(async ({ data }) => {
		const { getBulletinWhatsAppState } = await import(
			"./whatsapp-delivery.server"
		);
		return getBulletinWhatsAppState(data);
	});

export const verifyDailyBulletinWhatsApp = createServerFn({ method: "POST" })
	.validator(validateBulletinDate)
	.handler(async ({ data }) => {
		const { verifyBulletinWhatsApp } = await import(
			"./whatsapp-delivery.server"
		);
		return verifyBulletinWhatsApp(data);
	});

export const updateDailyBulletinWhatsAppAudience = createServerFn({
	method: "POST",
})
	.validator(validateWhatsAppAudienceChange)
	.handler(async ({ data }) => {
		const { setWhatsAppAudience } = await import("./whatsapp-delivery.server");
		return setWhatsAppAudience(data);
	});

export const queueDailyBulletinWhatsApp = createServerFn({ method: "POST" })
	.validator(validateWhatsAppQueueRequest)
	.handler(async ({ data }) => {
		const { enqueueBulletinWhatsApp } = await import(
			"./whatsapp-delivery.server"
		);
		return enqueueBulletinWhatsApp(data);
	});
