import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn(), config: vi.fn() }));
vi.mock("@aws-sdk/client-sesv2", () => ({
	SESv2Client: class {
		constructor(config: unknown) {
			mocks.config(config);
		}
		send = mocks.send;
	},
	GetContactCommand: class {
		kind = "get";
		constructor(public input: unknown) {}
	},
	CreateContactCommand: class {
		kind = "create";
		constructor(public input: unknown) {}
	},
	UpdateContactCommand: class {
		kind = "update";
		constructor(public input: unknown) {}
	},
	SendEmailCommand: class {
		kind = "send";
		constructor(public input: unknown) {}
	},
}));

import {
	isSesSubscribed,
	SesClient,
	SesError,
	SesSuppressedError,
} from "~/server/ses-client.server";

const config = {
	region: "il-central-1",
	fromAddress: "bulletin@example.com",
	replyToAddress: "contact@example.com",
	contactListName: "daily-bulletin",
	configurationSetName: "daily-bulletin-events",
	senderName: 'תנ"ך על הפרק',
	contactAddress: "Example organization, 10 Example Street",
};
const request = {
	to: "reader@example.com",
	subject: 'תנ"ך על הפרק - בראשית א',
	html: '<html><body dir="rtl"><p>בְּרֵאשִׁ֖ית בָּרָ֣א בֶן־אָדָם</p></body></html>',
	audience: "test" as const,
	externalId: "attempt-123",
};
function contact() {
	return {
		EmailAddress: "reader@example.com",
		ContactListName: config.contactListName,
		UnsubscribeAll: false,
		TopicPreferences: [{ TopicName: "test", SubscriptionStatus: "OPT_IN" }],
		AttributesData: '{"source":"legacy"}',
	};
}
function sdkError(status: number, name = "ProviderException") {
	return Object.assign(
		new Error("Private account and credentials must not leak"),
		{
			name,
			$metadata: { httpStatusCode: status },
		},
	);
}
function calls(kind: string) {
	return mocks.send.mock.calls.filter(([command]) => command.kind === kind);
}

describe("SES managed-subscription transport", () => {
	beforeEach(() => {
		mocks.send.mockReset();
		mocks.config.mockReset();
		mocks.send.mockImplementation(async (command) => {
			if (command.kind === "get") return contact();
			if (command.kind === "send") return { MessageId: "ses-message-123" };
			return { $metadata: { httpStatusCode: 200 } };
		});
	});

	it("uses the configured region with one SDK attempt, never automatic send retries", () => {
		new SesClient(config);
		expect(mocks.config).toHaveBeenCalledExactlyOnceWith({
			region: "il-central-1",
			maxAttempts: 1,
		});
	});
	it.each([
		{ region: "" },
		{ contactListName: " " },
		{ configurationSetName: "" },
		{ senderName: " " },
		{ senderName: "sender\r\nBcc: other@example.com" },
		{ senderName: "א".repeat(101) },
		{ fromAddress: "invalid" },
		{ fromAddress: "first@example.com,second@example.com" },
		{ fromAddress: "Name <first@example.com>" },
		{ replyToAddress: "a@example.com\nBcc:x@example.com" },
	])("rejects missing configuration or header injection (%j)", (override) => {
		expect(() => new SesClient({ ...config, ...override })).toThrow(SesError);
		expect(mocks.config).not.toHaveBeenCalled();
	});
	it("normalizes configuration whitespace and defaults replies to its sender", async () => {
		const client = new SesClient({
			...config,
			region: " il-central-1 ",
			contactListName: " daily-bulletin ",
			configurationSetName: " daily-bulletin-events ",
			replyToAddress: undefined,
		});
		await client.sendOne(request);
		expect(calls("send")[0][0].input.ReplyToAddresses).toEqual([
			config.fromAddress,
		]);
		expect(mocks.config.mock.calls[0][0].region).toBe("il-central-1");
	});
	it("retrieves explicit preferences without considering default opt-in sufficient consent", async () => {
		mocks.send.mockResolvedValueOnce({
			...contact(),
			TopicPreferences: undefined,
			TopicDefaultPreferences: [
				{ TopicName: "test", SubscriptionStatus: "OPT_IN" },
			],
		});
		const result = await new SesClient(config).getContact("READER@example.com");
		expect(result).toEqual({
			email: "reader@example.com",
			unsubscribeAll: false,
			topics: {},
			attributesData: '{"source":"legacy"}',
		});
		expect(result && isSesSubscribed(result, "test")).toBe(false);
		expect(calls("get")[0][0].input).toEqual({
			ContactListName: "daily-bulletin",
			EmailAddress: "reader@example.com",
		});
	});
	it("returns null for a missing contact", async () => {
		mocks.send.mockRejectedValueOnce(sdkError(404, "NotFoundException"));
		expect(await new SesClient(config).getContact(request.to)).toBeNull();
	});
	it("sanitizes a failed contact lookup without classifying it as an uncertain send", async () => {
		mocks.send.mockRejectedValueOnce(new Error("private network information"));
		const result = new SesClient(config).getContact(request.to);
		await expect(result).rejects.toMatchObject({ outcome: "failed" });
		await expect(result).rejects.not.toHaveProperty(
			"message",
			"private network information",
		);
	});
	it.each(
		[
			null,
			{ ...contact(), EmailAddress: "other@example.com" },
			{ ...contact(), ContactListName: "other-list" },
			{ ...contact(), UnsubscribeAll: undefined },
			{
				...contact(),
				TopicPreferences: [
					{ TopicName: "test", SubscriptionStatus: "UNKNOWN" },
				],
			},
			{
				...contact(),
				TopicPreferences: [{ TopicName: "", SubscriptionStatus: "OPT_IN" }],
			},
			{
				...contact(),
				TopicPreferences: [
					{ TopicName: "test", SubscriptionStatus: "OPT_IN" },
					{ TopicName: "test", SubscriptionStatus: "OPT_OUT" },
				],
			},
		].map((response) => ({ response })),
	)(
		"fails closed for malformed contact response (%j)",
		async ({ response }) => {
			mocks.send.mockResolvedValueOnce(response);
			await expect(
				new SesClient(config).getContact(request.to),
			).rejects.toMatchObject({ outcome: "failed" });
		},
	);
	it("creates a newly consented contact in only the requested topic", async () => {
		mocks.send.mockRejectedValueOnce(sdkError(404, "NotFoundException"));
		expect(
			await new SesClient(config).ensureSubscribedContact(
				"READER@example.com",
				"test",
			),
		).toBe("subscribed");
		expect(calls("create")[0][0].input).toEqual({
			ContactListName: "daily-bulletin",
			EmailAddress: "reader@example.com",
			UnsubscribeAll: false,
			TopicPreferences: [{ TopicName: "test", SubscriptionStatus: "OPT_IN" }],
		});
		expect(calls("update")).toHaveLength(0);
		expect(calls("send")).toHaveLength(0);
	});
	it.each(
		[
			{ ...contact(), UnsubscribeAll: true },
			{
				...contact(),
				TopicPreferences: [
					{ TopicName: "test", SubscriptionStatus: "OPT_OUT" },
				],
			},
		].map((response) => ({ response })),
	)(
		"never clears an existing global or topic opt-out (%j)",
		async ({ response }) => {
			mocks.send.mockResolvedValueOnce(response);
			expect(
				await new SesClient(config).ensureSubscribedContact(request.to, "test"),
			).toBe("opted_out");
			expect(mocks.send).toHaveBeenCalledTimes(1);
		},
	);
	it("does not update contacts who already explicitly subscribed", async () => {
		expect(
			await new SesClient(config).ensureSubscribedContact(request.to, "test"),
		).toBe("subscribed");
		expect(mocks.send).toHaveBeenCalledTimes(1);
	});
	it("never overwrites concurrent preference changes while enrolling an existing contact", async () => {
		mocks.send.mockResolvedValueOnce({
			...contact(),
			TopicPreferences: [
				{ TopicName: "real", SubscriptionStatus: "OPT_OUT" },
				{ TopicName: "archive", SubscriptionStatus: "OPT_IN" },
			],
		});
		expect(
			await new SesClient(config).ensureSubscribedContact(request.to, "test"),
		).toBe("opted_out");
		expect(calls("update")).toHaveLength(0);
		expect(calls("create")).toHaveLength(0);
		expect(mocks.send).toHaveBeenCalledTimes(1);
	});
	it("suppresses globally without writing topic snapshots or attributes", async () => {
		await new SesClient(config).unsubscribeContact("READER@example.com");
		expect(calls("update")[0][0].input).toEqual({
			ContactListName: config.contactListName,
			EmailAddress: request.to,
			UnsubscribeAll: true,
		});
		expect(calls("update")[0][0].input).not.toHaveProperty("TopicPreferences");
		expect(calls("update")[0][0].input).not.toHaveProperty("AttributesData");
	});
	it("does not create or update a missing or already globally suppressed contact", async () => {
		mocks.send.mockRejectedValueOnce(sdkError(404, "NotFoundException"));
		await new SesClient(config).unsubscribeContact(request.to);
		mocks.send.mockResolvedValueOnce({ ...contact(), UnsubscribeAll: true });
		await new SesClient(config).unsubscribeContact(request.to);
		expect(calls("update")).toHaveLength(0);
		expect(calls("create")).toHaveLength(0);
	});
	it.each([403, 500, 408])(
		"reports global unsubscribe failures safely (HTTP %s)",
		async (status) => {
			mocks.send
				.mockResolvedValueOnce(contact())
				.mockRejectedValueOnce(sdkError(status));
			await expect(
				new SesClient(config).unsubscribeContact(request.to),
			).rejects.toMatchObject({
				outcome: status === 403 ? "failed" : "uncertain",
			});
		},
	);
	it.each([400, 403, 429, 500, 408])(
		"reports contact setup failures safely (HTTP %s)",
		async (status) => {
			mocks.send
				.mockRejectedValueOnce(sdkError(404, "NotFoundException"))
				.mockRejectedValueOnce(sdkError(status));
			await expect(
				new SesClient(config).ensureSubscribedContact(request.to, "test"),
			).rejects.toMatchObject({
				outcome: status >= 500 || status === 408 ? "uncertain" : "failed",
			});
			expect(calls("create")).toHaveLength(1);
		},
	);
	it("sends one recipient with managed unsubscribe, configuration-set events and accepted message ID", async () => {
		const result = await new SesClient(config).sendOne(request);
		expect(result).toBe("ses-message-123");
		const sent = calls("send")[0][0].input;
		expect(sent.Destination).toEqual({ ToAddresses: [request.to] });
		expect(sent.ListManagementOptions).toEqual({
			ContactListName: "daily-bulletin",
			TopicName: "test",
		});
		expect(sent.ConfigurationSetName).toBe("daily-bulletin-events");
		expect(sent.ReplyToAddresses).toEqual(["contact@example.com"]);
		expect(sent.Content.Simple.Subject).toEqual({
			Data: request.subject,
			Charset: "UTF-8",
		});
		expect(sent.Content.Simple.Body.Html.Charset).toBe("UTF-8");
		expect(sent.Content.Simple.Body.Html.Data).toContain(
			"{{amazonSESUnsubscribeUrl}}",
		);
		expect(sent.Content.Simple.Body.Html.Data).toContain("להסרה מרשימת התפוצה");
		expect(sent.Content.Simple.Body.Html.Data).toContain("בְּרֵאשִׁ֖ית בָּרָ֣א בֶן־אָדָם");
		expect(sent.Content.Simple.Body.Html.Data.indexOf("<footer")).toBeLessThan(
			sent.Content.Simple.Body.Html.Data.indexOf("</body>"),
		);
		expect(sent.EmailTags).toEqual([
			{ Name: "bulletin_audience", Value: "test" },
			{ Name: "bulletin_attempt", Value: "attempt-123" },
		]);
		for (const [, options] of mocks.send.mock.calls)
			expect(options.abortSignal).toBeInstanceOf(AbortSignal);
		expect(calls("create")).toHaveLength(0);
		expect(calls("update")).toHaveLength(0);
	});
	it("creates a valid Hebrew friendly-sender header without splitting multibyte names", async () => {
		const senderName = "מ".repeat(100);
		await new SesClient({ ...config, senderName }).sendOne(request);
		const header = calls("send")[0][0].input.FromEmailAddress;
		const words = [...header.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
		expect(
			words
				.map((word) => Buffer.from(word[1], "base64").toString("utf8"))
				.join(""),
		).toBe(senderName);
		expect(words.every((word) => word[0].length <= 75)).toBe(true);
		expect(header).toContain("<bulletin@example.com>");
	});
	it("escapes and normalizes configured footer text without changing scripture or message content", async () => {
		await new SesClient({
			...config,
			senderName: 'תנ״ך <שם> & "',
			contactAddress: "רחוב־א <כתובת> & 'בית'",
		}).sendOne(request);
		const html = calls("send")[0][0].input.Content.Simple.Body.Html.Data;
		expect(html).not.toContain("<שם>");
		const header = calls("send")[0][0].input.FromEmailAddress;
		expect(
			[...header.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
				.map((word) => Buffer.from(word[1], "base64").toString("utf8"))
				.join(""),
		).toBe('תנ"ך <שם> & "');
		expect(html).toContain("רחוב-א &lt;כתובת&gt; &amp; &#39;בית&#39;");
		expect(html).toContain("בֶן־אָדָם");
	});
	it("supports fragments without an optional address or trace tag", async () => {
		const client = new SesClient({ ...config, contactAddress: undefined });
		await client.sendOne({
			...request,
			html: "<p>ניסיון פנימי</p>",
			externalId: undefined,
		});
		expect(calls("send")[0][0].input.Content.Simple.Body.Html.Data).toContain(
			'<p>ניסיון פנימי</p><table role="presentation"',
		);
		expect(calls("send")[0][0].input.EmailTags).toEqual([
			{ Name: "bulletin_audience", Value: "test" },
		]);
		mocks.send.mockClear();
		mocks.send.mockResolvedValueOnce({
			...contact(),
			TopicPreferences: [{ TopicName: "real", SubscriptionStatus: "OPT_IN" }],
		});
		await expect(
			client.sendOne({ ...request, audience: "real" }),
		).resolves.toBe("ses-message-123");
		expect(calls("send")).toHaveLength(1);
	});
	it("replaces one renderer marker inside its centered card with one cohesive footer row", async () => {
		const html =
			'<html><body><table width="680"><tbody><tr><td><h1>תנ"ך על הפרק</h1><p>Saved article</p></td></tr><!--BULLETIN_EMAIL_FOOTER--></tbody></table></body></html>';
		await new SesClient(config).sendOne({ ...request, html });
		const output = calls("send")[0][0].input.Content.Simple.Body.Html.Data;
		const container = document.createElement("div");
		container.innerHTML = output;
		const footer = container.querySelector("footer");
		expect(footer?.closest("table")?.getAttribute("width")).toBe("680");
		expect(footer?.closest("td")?.getAttribute("align")).toBe("right");
		expect(footer?.closest("td")?.getAttribute("style")).toContain(
			"padding:20px 28px",
		);
		expect(container.querySelectorAll("footer")).toHaveLength(1);
		expect(container.querySelectorAll("h1,h2,h3")).toHaveLength(1);
		expect(output).not.toContain("BULLETIN_EMAIL_FOOTER");
		expect(output.split("{{amazonSESUnsubscribeUrl}}")).toHaveLength(2);
		expect(container.querySelectorAll("table")).toHaveLength(1);
		expect(footer?.textContent).not.toContain('תנ"ך על הפרק');
	});
	it("uses a centered six-hundred-pixel fallback for immutable legacy snapshots", async () => {
		await new SesClient(config).sendOne(request);
		const output = calls("send")[0][0].input.Content.Simple.Body.Html.Data;
		const container = document.createElement("div");
		container.innerHTML = output;
		const table = container.querySelector("footer")?.closest("table");
		expect(table?.getAttribute("width")).toBe("600");
		expect(table?.getAttribute("style")).toContain("max-width:600px");
		expect(table?.parentElement?.getAttribute("align")).toBe("center");
		expect(output.indexOf("<footer")).toBeLessThan(output.indexOf("</body>"));
	});
	it("includes the public website contact channels with isolated LTR phone and email", async () => {
		await new SesClient(config).sendOne(request);
		const output = calls("send")[0][0].input.Content.Simple.Body.Html.Data;
		const container = document.createElement("div");
		container.innerHTML = output;
		for (const href of [
			"mailto:tanah.site@gmail.com",
			"tel:+37257078640",
			"https://wa.me/37257078640",
			"https://t.me/BibleOnSite",
			"https://xn--febl3a.co.il/",
		]) {
			expect(container.querySelectorAll(`a[href="${href}"]`)).toHaveLength(1);
		}
		expect(
			container
				.querySelector('a[href="tel:+37257078640"]')
				?.getAttribute("dir"),
		).toBe("ltr");
		expect(
			container
				.querySelector('a[href="mailto:tanah.site@gmail.com"]')
				?.getAttribute("dir"),
		).toBe("ltr");
		expect(output).toContain("+372-57078640");
		expect(output).toContain("background:#f5f9fa");
	});
	it("does not repeat the website email when it is also the configured reply address", async () => {
		await new SesClient({
			...config,
			replyToAddress: "TANAH.SITE@gmail.com",
		}).sendOne(request);
		const container = document.createElement("div");
		container.innerHTML =
			calls("send")[0][0].input.Content.Simple.Body.Html.Data;
		expect(
			container.querySelectorAll('a[href="mailto:tanah.site@gmail.com"]'),
		).toHaveLength(1);
		expect(container.textContent).not.toContain("למענה על הדיוור");
	});
	it("pairs the four original website contact icons with readable links using small email-safe PNGs", async () => {
		await new SesClient({
			...config,
			replyToAddress: "tanah.site@gmail.com",
		}).sendOne(request);
		const output = calls("send")[0][0].input.Content.Simple.Body.Html.Data;
		const container = document.createElement("div");
		container.innerHTML = output;
		const images = Array.from(container.querySelectorAll("footer img"));
		expect(images).toHaveLength(4);
		const filenames = [
			"envelope-12f047cbf921.png",
			"phone-fba2eb24d511.png",
			"whatsapp-97aa65ad2e4e.png",
			"telegram-4d1164ab375c.png",
		];
		const manifest = JSON.parse(
			readFileSync(
				resolve(process.cwd(), "../bulletin/assets/email/manifest.json"),
				"utf8",
			),
		) as { assets: { id: string; url: string; contentType: string }[] };
		expect(images.map((image) => image.getAttribute("src"))).toEqual(
			manifest.assets
				.filter((asset) => asset.id !== "logo-header")
				.map((asset) => asset.url),
		);
		for (const [index, image] of images.entries()) {
			expect(image.getAttribute("src")).toBe(
				`https://bible-on-site-assets.s3.il-central-1.amazonaws.com/branding/daily-bulletin/${filenames[index]}`,
			);
			expect(image.getAttribute("width")).toBe("16");
			expect(image.getAttribute("height")).toBe("16");
			expect(image.getAttribute("alt")).toBe("");
			expect(image.getAttribute("role")).toBe("presentation");
			expect(image.parentElement?.querySelector("a")?.textContent).toBeTruthy();
		}
		expect(output).not.toContain("data:image");
		expect(output).not.toContain("<svg");
		expect(output.split("{{amazonSESUnsubscribeUrl}}")).toHaveLength(2);
		expect(calls("send")[0][0].input.Content.Simple).not.toHaveProperty(
			"Attachments",
		);
	});
	it("preserves escaped dynamic replies and dollar replacement text inside a marker footer", async () => {
		await new SesClient({
			...config,
			replyToAddress: "ops&daily@example.com",
			contactAddress: "<כתובת> $& $'",
		}).sendOne({
			...request,
			html: "<table><tbody><!--BULLETIN_EMAIL_FOOTER--></tbody></table>",
		});
		const output = calls("send")[0][0].input.Content.Simple.Body.Html.Data;
		expect(output).toContain("ops&amp;daily@example.com");
		expect(output).toContain("&lt;כתובת&gt; $&amp; $&#39;");
		expect(output).not.toContain("BULLETIN_EMAIL_FOOTER");
	});
	it("fails closed if a renderer contains more than one footer insertion marker", async () => {
		await expect(
			new SesClient(config).sendOne({
				...request,
				html: "<!--BULLETIN_EMAIL_FOOTER--><!--BULLETIN_EMAIL_FOOTER-->",
			}),
		).rejects.toMatchObject({ outcome: "failed" });
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it("awaits the configured rate reservation after contact consent and immediately before the send", async () => {
		const beforeSend = vi.fn().mockResolvedValue(undefined);
		await new SesClient({ ...config, beforeSend }).sendOne(request);
		expect(beforeSend).toHaveBeenCalledOnce();
		expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(
			beforeSend.mock.invocationCallOrder[0],
		);
		expect(beforeSend.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.send.mock.invocationCallOrder[1],
		);
	});
	it("does not call SES SendEmail if reserving the send rate fails", async () => {
		const beforeSend = vi
			.fn()
			.mockRejectedValue(new Error("private limiter details"));
		const result = new SesClient({ ...config, beforeSend }).sendOne(request);
		await expect(result).rejects.toMatchObject({ outcome: "failed" });
		await expect(result).rejects.not.toHaveProperty(
			"message",
			"private limiter details",
		);
		expect(calls("send")).toHaveLength(0);
	});
	it("preserves the typed suppression error from the final guard", async () => {
		const error = new SesSuppressedError();
		await expect(
			new SesClient({
				...config,
				beforeSend: async () => {
					throw error;
				},
			}).sendOne(request),
		).rejects.toBe(error);
		expect(calls("send")).toHaveLength(0);
	});
	it("uses the explicit real-topic preference only when the caller requests it", async () => {
		mocks.send.mockResolvedValueOnce({
			...contact(),
			TopicPreferences: [{ TopicName: "real", SubscriptionStatus: "OPT_IN" }],
		});
		await new SesClient(config).sendOne({ ...request, audience: "real" });
		expect(calls("send")[0][0].input.ListManagementOptions.TopicName).toBe(
			"real",
		);
	});
	it.each([
		{ to: "one@example.com,two@example.com" },
		{ to: "שם@example.com" },
		{ to: `${"x".repeat(255)}@example.com` },
		{ subject: "" },
		{ subject: "Hello\nBcc: other@example.com" },
		{ html: " " },
		{ externalId: "unsafe id" },
		{ externalId: "x".repeat(257) },
		{ html: "{{amazonSESUnsubscribeUrl}} {{amazonSESUnsubscribeUrl}}" },
	])(
		"rejects malformed or multi-recipient send input before contact lookup (%j)",
		async (override) => {
			await expect(
				new SesClient(config).sendOne({ ...request, ...override }),
			).rejects.toMatchObject({ outcome: "failed" });
			expect(mocks.send).not.toHaveBeenCalled();
		},
	);
	it("rejects an unsupported runtime audience", async () => {
		await expect(
			new SesClient(config).sendOne({
				...request,
				audience: "other" as "test",
			}),
		).rejects.toMatchObject({ outcome: "failed" });
		expect(mocks.send).not.toHaveBeenCalled();
	});
	it.each(
		[
			{ ...contact(), UnsubscribeAll: true },
			{
				...contact(),
				TopicPreferences: [
					{ TopicName: "test", SubscriptionStatus: "OPT_OUT" },
				],
			},
			{
				...contact(),
				TopicPreferences: [],
				TopicDefaultPreferences: [
					{ TopicName: "test", SubscriptionStatus: "OPT_IN" },
				],
			},
		].map((response) => ({ response })),
	)(
		"does not send or resubscribe a suppressed/nonconsenting contact (%j)",
		async ({ response }) => {
			mocks.send.mockResolvedValueOnce(response);
			await expect(
				new SesClient(config).sendOne(request),
			).rejects.toMatchObject({ outcome: "failed" });
			expect(mocks.send).toHaveBeenCalledTimes(1);
		},
	);
	it("never creates a missing contact while sending", async () => {
		mocks.send.mockRejectedValueOnce(sdkError(404, "NotFoundException"));
		await expect(new SesClient(config).sendOne(request)).rejects.toMatchObject({
			outcome: "failed",
		});
		expect(calls("create")).toHaveLength(0);
		expect(calls("send")).toHaveLength(0);
	});
	it.each([400, 403, 404, 429, 408, 500, 503])(
		"classifies HTTP %s send failures without retries or provider detail leakage",
		async (status) => {
			mocks.send
				.mockResolvedValueOnce(contact())
				.mockRejectedValueOnce(sdkError(status));
			const result = new SesClient(config).sendOne(request);
			await expect(result).rejects.toMatchObject({
				outcome: status >= 500 || status === 408 ? "uncertain" : "failed",
			});
			await expect(result).rejects.not.toHaveProperty(
				"message",
				"Private account and credentials must not leak",
			);
			expect(calls("send")).toHaveLength(1);
		},
	);
	it.each([new Error("network private details"), "unknown thrown value", null])(
		"keeps unknown transport failures uncertain (%j)",
		async (error) => {
			mocks.send.mockResolvedValueOnce(contact()).mockRejectedValueOnce(error);
			await expect(
				new SesClient(config).sendOne(request),
			).rejects.toMatchObject({ outcome: "uncertain" });
		},
	);
	it.each([{}, { MessageId: " " }, { MessageId: 42 }, null])(
		"treats malformed send acknowledgment as uncertain (%j)",
		async (response) => {
			mocks.send
				.mockResolvedValueOnce(contact())
				.mockResolvedValueOnce(response);
			await expect(
				new SesClient(config).sendOne(request),
			).rejects.toMatchObject({ outcome: "uncertain" });
			expect(calls("send")).toHaveLength(1);
		},
	);
});
