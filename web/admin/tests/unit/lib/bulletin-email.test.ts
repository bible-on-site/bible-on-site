import { describe, expect, it } from "vitest";
import {
	validateAudienceChange,
	validateEmailQueueRequest,
	validateSubscriberChange,
} from "~/lib/bulletin-email";

describe("bulletin audience requests", () => {
	it("accepts test mode without permission to activate the real audience", () => {
		expect(validateAudienceChange({ audience: "test", revision: 0 })).toEqual({
			audience: "test",
			revision: 0,
			confirmReal: false,
		});
	});

	it("requires a literal explicit confirmation for the real audience", () => {
		expect(
			validateAudienceChange({
				audience: "real",
				revision: 7,
				confirmReal: true,
			}),
		).toEqual({ audience: "real", revision: 7, confirmReal: true });
		for (const confirmReal of [undefined, false, "true", 1, {}]) {
			expect(() =>
				validateAudienceChange({ audience: "real", revision: 7, confirmReal }),
			).toThrow();
		}
	});

	it.each([
		null,
		undefined,
		[],
		"test",
		{},
		{ audience: "all", revision: 1 },
		{ audience: "test" },
		...[
			-1,
			0.1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.MAX_SAFE_INTEGER + 1,
			"1",
			null,
		].map((revision) => ({ audience: "test", revision })),
	])("rejects malformed audience/revision state %j", (value) => {
		expect(() => validateAudienceChange(value)).toThrow();
	});

	it("accepts a safe revision while returning only the allowed request fields", () => {
		expect(
			validateAudienceChange({
				audience: "test",
				revision: Number.MAX_SAFE_INTEGER,
				confirmReal: true,
				provider: "unexpected",
			}),
		).toEqual({
			audience: "test",
			revision: Number.MAX_SAFE_INTEGER,
			confirmReal: true,
		});
	});
});

describe("subscriber change requests", () => {
	const consent = {
		email: "reader@example.com",
		audience: "test",
		action: "confirm",
		source: "Explicit newsletter signup",
	};
	it("normalizes an explicit consent request and strips privileged override fields", () => {
		expect(
			validateSubscriberChange({
				...consent,
				email: " Reader@Example.com ",
				source: " Explicit newsletter signup ",
				forceRestore: true,
				consent_status: "confirmed",
			}),
		).toEqual(consent);
	});

	it("does not require consent evidence in order to unsubscribe", () => {
		expect(
			validateSubscriberChange({
				...consent,
				action: "unsubscribe",
				source: undefined,
			}),
		).toEqual({ ...consent, action: "unsubscribe", source: "" });
	});

	it.each([
		null,
		[],
		"reader@example.com",
		{},
		{ ...consent, email: 42 },
		{ ...consent, email: "reader@example.com\r\nBcc:other@example.com" },
		{ ...consent, email: "Reader <reader@example.com>" },
		{ ...consent, email: "reader@דוגמה.com" },
		{ ...consent, email: `${"a".repeat(250)}@example.com` },
		{ ...consent, audience: "everyone" },
		{ ...consent, action: "resubscribe" },
		{ ...consent, source: "short" },
		{ ...consent, source: "a".repeat(121) },
	])(
		"rejects invalid identity, audience, action or consent source %j",
		(value) => {
			expect(() => validateSubscriberChange(value)).toThrow();
		},
	);
});

describe("bulletin queue requests", () => {
	const request = {
		date: "2026-10-28",
		audience: "test",
		revision: 3,
		requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
	};

	it("preserves a valid date, audience, revision and idempotency token", () => {
		expect(
			validateEmailQueueRequest({
				...request,
				recipients: ["untrusted@example.com"],
			}),
		).toEqual(request);
	});

	it("accepts a real-audience queue request without changing audience settings", () => {
		expect(validateEmailQueueRequest({ ...request, audience: "real" })).toEqual(
			{ ...request, audience: "real" },
		);
	});

	it("accepts UUIDv7 and uppercase UUIDs as well as UUIDv4", () => {
		for (const requestKey of [
			"018f47f1-f6a0-7d9e-9f77-40e3bdac5d22",
			request.requestKey.toUpperCase(),
		]) {
			expect(
				validateEmailQueueRequest({ ...request, requestKey }).requestKey,
			).toBe(requestKey);
		}
	});

	it.each([
		null,
		undefined,
		"send",
		[],
		{},
		{ ...request, date: "2026-02-30" },
		{ ...request, date: "2026-13-01" },
		{ ...request, date: "2026-10-28T00:00:00Z" },
		{ ...request, date: 20261028 },
		{ ...request, audience: "everyone" },
		{ ...request, revision: "3" },
		{ ...request, revision: -1 },
		{ ...request, revision: 0.5 },
		{ ...request, revision: Number.MAX_SAFE_INTEGER + 1 },
		{ ...request, requestKey: undefined },
		{ ...request, requestKey: 123 },
		{ ...request, requestKey: "not-a-uuid" },
		{ ...request, requestKey: "aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaa1" },
		{ ...request, requestKey: "aaaaaaaa-aaaa-4aaa-0aaa-aaaaaaaaaaa1" },
		{ ...request, requestKey: ` ${request.requestKey}` },
	])("rejects malformed queue request %j", (value) => {
		expect(() => validateEmailQueueRequest(value)).toThrow();
	});
});
