import { describe, expect, it } from "vitest";
import {
	validateTelegramAudienceChange,
	validateTelegramQueueRequest,
} from "~/lib/bulletin-telegram";

const request = {
	date: "2026-10-28",
	requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	expectedAudience: "test",
	expectedRevision: 0,
};

describe("Telegram bulletin request validation", () => {
	it("preserves the captured audience and revision and canonicalizes UUID case", () => {
		expect(
			validateTelegramQueueRequest({
				...request,
				requestKey: request.requestKey.toUpperCase(),
			}),
		).toEqual(request);
	});

	it("accepts explicit UUID versions 1 through 8", () => {
		for (const version of "12345678") {
			expect(
				validateTelegramQueueRequest({
					...request,
					requestKey: `11111111-1111-${version}111-8111-111111111111`,
				}).expectedAudience,
			).toBe("test");
		}
	});

	it("rejects dates, UUIDs, modes and unsafe revisions before any delivery", () => {
		for (const value of [
			null,
			[],
			{},
			{ ...request, date: "2026-02-30" },
			{ ...request, date: "2026-1-28" },
			{ ...request, expectedAudience: "email" },
			{ ...request, expectedRevision: -1 },
			{ ...request, expectedRevision: 0.5 },
			{ ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
			{ ...request, expectedRevision: "0" },
			{ ...request, requestKey: "11111111-1111-0111-8111-111111111111" },
			{ ...request, requestKey: "11111111-1111-4111-7111-111111111111" },
			{ ...request, requestKey: 1 },
		])
			expect(() => validateTelegramQueueRequest(value)).toThrow();
	});

	it("refuses arbitrary destinations, credentials, documents and captions", () => {
		for (const field of [
			"chatId",
			"target",
			"token",
			"bot",
			"pdf",
			"caption",
			"audience",
			"revision",
		]) {
			expect(() =>
				validateTelegramQueueRequest({ ...request, [field]: "unexpected" }),
			).toThrow("בקשת הטלגרם אינה תקינה");
		}
	});

	it("requires literal true before enabling the public channel", () => {
		for (const confirmReal of [undefined, false, "true", 1]) {
			expect(() =>
				validateTelegramAudienceChange({
					audience: "real",
					expectedRevision: 3,
					...(confirmReal === undefined ? {} : { confirmReal }),
				}),
			).toThrow();
		}
		expect(
			validateTelegramAudienceChange({
				audience: "real",
				expectedRevision: 3,
				confirmReal: true,
			}),
		).toEqual({ audience: "real", expectedRevision: 3, confirmReal: true });
	});

	it("allows returning to private test mode without public confirmation", () => {
		expect(
			validateTelegramAudienceChange({ audience: "test", expectedRevision: 4 }),
		).toEqual({ audience: "test", expectedRevision: 4, confirmReal: false });
	});

	it("rejects invalid mode changes and hidden targeting overrides", () => {
		for (const value of [
			null,
			[],
			{ audience: "all", expectedRevision: 1 },
			{ audience: "test", expectedRevision: NaN },
			{ audience: "test", expectedRevision: -1 },
			{ audience: "test", expectedRevision: 1.1 },
			{ audience: "test", expectedRevision: "1" },
			{ audience: "test", expectedRevision: 1, chatId: "override" },
		])
			expect(() => validateTelegramAudienceChange(value)).toThrow();
	});
});
