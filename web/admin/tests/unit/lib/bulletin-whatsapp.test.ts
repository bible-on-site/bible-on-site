import { describe, expect, it } from "vitest";
import {
	validateWhatsAppAudienceChange,
	validateWhatsAppQueueRequest,
} from "~/lib/bulletin-whatsapp";

const request = {
	date: "2026-10-28",
	requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	expectedAudience: "test" as const,
	expectedRevision: 4,
};

describe("WhatsApp bulletin payload boundary", () => {
	it("retains only the date, captured settings and normalized stable request key", () => {
		expect(validateWhatsAppQueueRequest(request)).toEqual(request);
		expect(
			validateWhatsAppQueueRequest({
				...request,
				requestKey: request.requestKey.toUpperCase(),
				expectedAudience: "real",
				expectedRevision: 0,
			}),
		).toEqual({ ...request, expectedAudience: "real", expectedRevision: 0 });
	});
	it("accepts a plain null-prototype serialized record", () => {
		expect(
			validateWhatsAppQueueRequest(Object.assign(Object.create(null), request)),
		).toEqual(request);
	});
	it.each([
		null,
		undefined,
		false,
		"request",
		[],
		new Date("2026-10-28"),
		{},
		Object.create(request),
		{ ...request, date: "2026-02-30" },
		{ ...request, date: 20261028 },
		{ ...request, expectedAudience: "all" },
		{ ...request, expectedRevision: -1 },
		{ ...request, expectedRevision: 0.5 },
		{ ...request, expectedRevision: Number.NaN },
		{ ...request, expectedRevision: Number.POSITIVE_INFINITY },
		{ ...request, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
		{ ...request, requestKey: 7 },
		{ ...request, requestKey: "invalid" },
		{ ...request, requestKey: "aaaaaaaa-aaaa-0aaa-8aaa-aaaaaaaaaaaa" },
		{ ...request, requestKey: "aaaaaaaa-aaaa-4aaa-7aaa-aaaaaaaaaaaa" },
		{ ...request, groupId: "not-client-owned" },
		{ ...request, token: "not-client-owned" },
		{ ...request, url: "https://example.com/not-client-owned" },
		{ ...request, pdf: "not-client-owned" },
		{ ...request, caption: "not-client-owned" },
		{ ...request, [Symbol("hidden")]: "not-client-owned" },
	])("rejects invalid or client-supplied targeting data %#", (value) => {
		expect(() => validateWhatsAppQueueRequest(value)).toThrow();
	});
	it("requires each queue field to be an own property", () => {
		for (const key of Object.keys(request)) {
			const missing = { ...request } as Record<string, unknown>;
			delete missing[key];
			expect(() => validateWhatsAppQueueRequest(missing)).toThrow();
		}
	});
	it("requires explicit real confirmation but permits a return to test", () => {
		expect(
			validateWhatsAppAudienceChange({
				audience: "real",
				expectedRevision: 4,
				confirmReal: true,
			}),
		).toEqual({ audience: "real", expectedRevision: 4, confirmReal: true });
		expect(
			validateWhatsAppAudienceChange({ audience: "test", expectedRevision: 5 }),
		).toEqual({ audience: "test", expectedRevision: 5, confirmReal: false });
		expect(
			validateWhatsAppAudienceChange({
				audience: "test",
				expectedRevision: 0,
				confirmReal: false,
			}),
		).toEqual({ audience: "test", expectedRevision: 0, confirmReal: false });
	});
	it.each([
		null,
		[],
		{},
		{ audience: "real", expectedRevision: 4 },
		{ audience: "real", expectedRevision: 4, confirmReal: false },
		{ audience: "real", expectedRevision: 4, confirmReal: "true" },
		{ audience: "test", expectedRevision: 4, confirmReal: null },
		{ audience: "test", expectedRevision: -1 },
		{ audience: "test", expectedRevision: "4" },
		{ audience: "test", expectedRevision: 4.5 },
		{ audience: "all", expectedRevision: 4 },
		{ audience: "test", expectedRevision: 4, groupId: "override" },
		{ audience: "test", revision: 4 },
	])("rejects an unconfirmed or malformed audience change %#", (value) => {
		expect(() => validateWhatsAppAudienceChange(value)).toThrow();
	});
});
