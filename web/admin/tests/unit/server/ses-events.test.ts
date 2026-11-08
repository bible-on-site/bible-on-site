import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import { parseSesEvent } from "~/server/ses-events.server";

const expected = {
	accountId: "123456789012",
	configurationSetName: "bulletin-events",
	contactListName: "bulletin-contacts",
};
const sentAt = "2026-10-28T08:00:00.000Z";
const changedAt = "2026-10-28T08:02:03.456Z";
const email = "reader@example.com";
const messageId = "010201example-1234-5678-000000";
const attemptId = "42_5a3bee60-4bda-4d0a-9e6e-303a0b788717";

// Structure follows the SES configuration-set event examples, not SNS envelopes:
// https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html
function mail() {
	return {
		timestamp: sentAt,
		source: "sender@example.com",
		sourceArn: "arn:aws:ses:eu-west-1:123456789012:identity/example.com",
		sendingAccountId: expected.accountId,
		messageId,
		destination: [email],
		tags: {
			"ses:configuration-set": [expected.configurationSetName],
			bulletin_attempt: [attemptId],
			bulletin_audience: ["test"],
		},
	};
}

function delivery() {
	return {
		eventType: "Delivery",
		mail: mail(),
		delivery: { timestamp: changedAt, recipients: [email] },
	};
}

function bounce(bounceType = "Permanent") {
	return {
		eventType: "Bounce",
		mail: mail(),
		bounce: {
			bounceType,
			timestamp: changedAt,
			bouncedRecipients: [{ emailAddress: email, status: "5.1.1" }],
		},
	};
}

function complaint() {
	return {
		eventType: "Complaint",
		mail: mail(),
		complaint: {
			timestamp: changedAt,
			complainedRecipients: [{ emailAddress: email }],
		},
	};
}

function subscription() {
	return {
		eventType: "Subscription",
		mail: mail(),
		subscription: {
			contactList: expected.contactListName,
			timestamp: changedAt,
			source: "UnsubscribeHeader",
			newTopicPreferences: {
				unsubscribeAll: false,
				topicSubscriptionStatus: [
					{ topicName: "test", subscriptionStatus: "OptOut" },
					{ topicName: "real", subscriptionStatus: "OptIn" },
				],
			},
			oldTopicPreferences: { unsubscribeAll: false },
		},
	};
}

const common = { messageId, attemptId, email };

describe("SES event normalization", () => {
	it("correlates delivery to the provider ID and full recipient attempt token", () => {
		expect(parseSesEvent(delivery(), expected)).toEqual({
			...common,
			type: "delivery",
			timestamp: changedAt,
		});
	});

	it("uses the authoritative SES messageId rather than email Message-ID headers", () => {
		const event = delivery();
		Object.assign(event.mail, {
			commonHeaders: { messageId: "an-original-header@example.com" },
		});
		expect(parseSesEvent(event, expected)).toMatchObject({ messageId });
	});

	it("normalizes recipient case when both destination and delivery references match", () => {
		const event = delivery();
		event.mail.destination = ["Reader@Example.com"];
		event.delivery.recipients = ["READER@example.com"];
		expect(parseSesEvent(event, expected)).toMatchObject({ email });
	});

	it.each([
		"Reader+Tag@sub.Example.com",
		`${"a".repeat(242)}@example.com`,
		"reader@example..com",
		"reader@..example",
		"reader@example..",
	])(
		"preserves accepted address structure with a bounded linear scan: %s",
		(address) => {
			const event = delivery();
			event.mail.destination = [address];
			event.delivery.recipients = [address];
			expect(parseSesEvent(event, expected)).toMatchObject({
				email: address.toLowerCase(),
			});
		},
	);

	it.each([
		"reader@example",
		"reader@.example",
		"reader@example.",
		"@example.com",
		"reader@@example.com",
		"reader@example.com@other.example",
		"reader @example.com",
		"reader@example.com ",
		"reader@example.com\t",
		"reader:tag@example.com",
		"reader,tag@example.com",
		"reader;tag@example.com",
		"reader(tag)@example.com",
		'"reader"@example.com',
	])(
		"rejects missing address components and unsupported syntax: %s",
		(address) => {
			const event = delivery();
			event.mail.destination = [address];
			event.delivery.recipients = [address];
			expect(parseSesEvent(event, expected)).toBeNull();
		},
	);

	it.each([
		["Send", { send: {} }, "send"],
		["Reject", { reject: { reason: "Bad content" } }, "reject"],
		[
			"Rendering Failure",
			{
				failure: {
					errorMessage: "Missing attribute",
					templateName: "bulletin",
				},
			},
			"renderingFailure",
		],
	])(
		"normalizes %s using its documented mail timestamp",
		(eventType, body, type) => {
			expect(
				parseSesEvent({ eventType, mail: mail(), ...body }, expected),
			).toEqual({ ...common, type, timestamp: sentAt });
		},
	);

	it.each([
		["Permanent", true],
		["Transient", false],
		["Undetermined", false],
	])(
		"classifies %s bounces without treating temporary failures as permanent",
		(type, permanent) => {
			expect(parseSesEvent(bounce(type), expected)).toEqual({
				...common,
				type: "bounce",
				timestamp: changedAt,
				permanent,
			});
		},
	);

	it("normalizes complaints only for the one referenced recipient", () => {
		expect(parseSesEvent(complaint(), expected)).toEqual({
			...common,
			type: "complaint",
			timestamp: changedAt,
		});
	});

	it.each([
		["U+0000", "\u0000"],
		["U+001F", "\u001f"],
		["U+007F", "\u007f"],
		["U+0080", "\u0080"],
		["U+009F", "\u009f"],
	])("rejects Unicode Cc boundary %s in event text", (_label, character) => {
		expect(
			parseSesEvent(
				{
					eventType: "Reject",
					mail: mail(),
					reject: { reason: `Before${character}after` },
				},
				expected,
			),
		).toBeNull();
	});

	it.each([
		["U+00A0 internal nonbreaking space", "Before\u00a0after"],
		["U+00A1 after the C1 range", "Before\u00a1after"],
		["U+200B format character", "\u200bBefore\u200bafter\u200b"],
		["U+200D format character", "Before\u200dafter"],
		["surrogate-pair Unicode", "Before😀after"],
	])("preserves non-Cc Unicode text: %s", (_label, reason) => {
		expect(
			parseSesEvent(
				{ eventType: "Reject", mail: mail(), reject: { reason } },
				expected,
			),
		).toEqual({
			...common,
			type: "reject",
			timestamp: sentAt,
		});
	});

	it.each([" Before", "After ", "\u00a0Before", "After\u00a0"])(
		"preserves the original trimming restriction for text %j",
		(reason) => {
			expect(
				parseSesEvent(
					{ eventType: "Reject", mail: mail(), reject: { reason } },
					expected,
				),
			).toBeNull();
		},
	);

	it.each([null, undefined, [], {}, "{}", 7, true])(
		"ignores non-SES payload %j",
		(payload) => expect(parseSesEvent(payload, expected)).toBeNull(),
	);

	it("does not unwrap an SNS envelope or infer an event from notificationType", () => {
		expect(
			parseSesEvent(
				{ Type: "Notification", Message: JSON.stringify(delivery()) },
				expected,
			),
		).toBeNull();
		const event = delivery();
		Object.assign(event, {
			eventType: undefined,
			notificationType: "Delivery",
		});
		expect(parseSesEvent(event, expected)).toBeNull();
	});

	it.each([
		"Open",
		"Click",
		"DeliveryDelay",
		"delivery",
		"SubscriptionConfirmation",
	])("ignores unrelated event type %s", (eventType) => {
		expect(parseSesEvent({ ...delivery(), eventType }, expected)).toBeNull();
	});

	it.each([
		{ accountId: "999999999999" },
		{ configurationSetName: "other-configuration" },
		{ accountId: "" },
		{ accountId: "not-an-account" },
		{ configurationSetName: "" },
		{ contactListName: "" },
		{ contactListName: " list-with-whitespace " },
	])("rejects mismatched or invalid expectations %j", (override) => {
		expect(parseSesEvent(delivery(), { ...expected, ...override })).toBeNull();
	});

	it.each([
		["sendingAccountId", undefined],
		["sendingAccountId", 123456789012],
		["tags", undefined],
		["tags", []],
		["messageId", undefined],
		["messageId", ""],
		["messageId", "contains spaces"],
		["messageId", "<header@example.com>"],
		["messageId", "a".repeat(257)],
		["timestamp", "not-a-date"],
		["destination", undefined],
		["destination", []],
		["destination", [email, "other@example.com"]],
		["destination", [email, email]],
		["destination", [null]],
		["destination", ["reader@example.com\r\nBcc:other@example.com"]],
		["destination", ["Reader <reader@example.com>"]],
		["destination", ["no-domain"]],
		["destination", [`${"a".repeat(250)}@example.com`]],
		["destination", ["reader@דוגמה.com"]],
	])("fails closed for malformed mail.%s = %j", (key, value) => {
		const event = delivery();
		Object.assign(event.mail, { [key]: value });
		expect(parseSesEvent(event, expected)).toBeNull();
	});

	it.each([
		undefined,
		expected.configurationSetName,
		[],
		[expected.configurationSetName, "other-config"],
		[expected.configurationSetName, expected.configurationSetName],
		["other-config"],
		[null],
	])("requires one exact configuration-set tag %j", (value) => {
		const event = delivery();
		Object.assign(event.mail.tags, { "ses:configuration-set": value });
		expect(parseSesEvent(event, expected)).toBeNull();
	});

	it("does not trust tag values inherited from an object's prototype", () => {
		const event = delivery();
		event.mail.tags = Object.create(event.mail.tags);
		expect(parseSesEvent(event, expected)).toBeNull();
	});

	it.each([
		undefined,
		attemptId,
		[],
		[attemptId, attemptId],
		[null],
		["daily-test-2026-10-28"],
		["0_token"],
		["01_token"],
		["9007199254740992_token"],
		["42_"],
		["42_token with spaces"],
		[`42_${"a".repeat(254)}`],
	])("requires a complete safe recipient-row and attempt tag %j", (value) => {
		const event = delivery();
		Object.assign(event.mail.tags, { bulletin_attempt: value });
		expect(parseSesEvent(event, expected)).toBeNull();
	});

	it.each([
		"2026-02-30T08:02:03.456Z",
		"2026-13-01T08:02:03.456Z",
		"2026-10-28T24:00:00.000Z",
		"2026-10-28T08:02:60.000Z",
		"2026-10-28",
		"2026-10-28T08:02:03+00:00",
		"2026-10-28T08:02:03.456Z ",
	])("rejects invalid or ambiguous timestamp %s", (value) => {
		const event = delivery();
		event.delivery.timestamp = value;
		expect(parseSesEvent(event, expected)).toBeNull();
	});

	it("normalizes the documented UTC timestamps with optional fractional seconds", () => {
		const event = delivery();
		event.delivery.timestamp = "2026-10-28T08:02:03Z";
		expect(parseSesEvent(event, expected)).toMatchObject({
			timestamp: "2026-10-28T08:02:03.000Z",
		});
		event.delivery.timestamp = "2026-10-28T08:02:03.456789Z";
		expect(parseSesEvent(event, expected)).toMatchObject({
			timestamp: changedAt,
		});
	});

	it.each([undefined, [], ["other@example.com"], [email, "other@example.com"]])(
		"rejects an inconsistent delivery recipient reference %j",
		(recipients) => {
			const event = delivery();
			Object.assign(event.delivery, { recipients });
			expect(parseSesEvent(event, expected)).toBeNull();
		},
	);

	it.each(["Other", "permanent", "", undefined])(
		"rejects undocumented bounce type %j",
		(bounceType) => {
			const event = bounce();
			Object.assign(event.bounce, { bounceType });
			expect(parseSesEvent(event, expected)).toBeNull();
		},
	);

	it.each([
		undefined,
		[],
		[null],
		[{}],
		[{ emailAddress: "other@example.com" }],
		[{ emailAddress: email }, { emailAddress: "other@example.com" }],
	])(
		"rejects missing, redacted or inconsistent bounce/complaint references %j",
		(recipients) => {
			const bounced = bounce();
			Object.assign(bounced.bounce, { bouncedRecipients: recipients });
			const complained = complaint();
			Object.assign(complained.complaint, { complainedRecipients: recipients });
			expect(parseSesEvent(bounced, expected)).toBeNull();
			expect(parseSesEvent(complained, expected)).toBeNull();
		},
	);

	it.each([
		{ eventType: "Send" },
		{ eventType: "Delivery", delivery: [] },
		{ eventType: "Bounce", bounce: null },
		{ eventType: "Complaint", complaint: false },
		{ eventType: "Reject", reject: {} },
		{ eventType: "Reject", reject: { reason: "" } },
		{ eventType: "Rendering Failure", failure: { templateName: "bulletin" } },
		{
			eventType: "Rendering Failure",
			failure: { errorMessage: "Missing data" },
		},
	])("rejects a malformed event-specific body %j", (body) => {
		expect(parseSesEvent({ mail: mail(), ...body }, expected)).toBeNull();
	});

	it("returns null without logging or exposing errors for inaccessible input properties", () => {
		const payload = Object.defineProperty({}, "mail", {
			get() {
				throw new Error("private data must not escape");
			},
		});
		expect(parseSesEvent(payload, expected)).toBeNull();
	});
});

describe("SES native subscription events", () => {
	it("normalizes native statuses and ignores old preferences", () => {
		expect(parseSesEvent(subscription(), expected)).toEqual({
			type: "subscription",
			email,
			timestamp: changedAt,
			unsubscribeAll: false,
			topics: { test: "OPT_OUT", real: "OPT_IN" },
		});
	});

	it("accepts global unsubscribe with no topic entries and no obsolete attempt tag", () => {
		const event = subscription();
		Object.assign(event.mail.tags, { bulletin_attempt: undefined });
		Object.assign(event.subscription, {
			newTopicPreferences: { unsubscribeAll: true },
		});
		expect(parseSesEvent(event, expected)).toEqual({
			type: "subscription",
			email,
			timestamp: changedAt,
			unsubscribeAll: true,
			topics: {},
		});
	});

	it("uses defaults only where a topic has no explicit preference", () => {
		const event = subscription();
		Object.assign(event.subscription.newTopicPreferences, {
			topicDefaultSubscriptionStatus: [
				{ topicName: "test", subscriptionStatus: "OptIn" },
				{ topicName: "real", subscriptionStatus: "OptOut" },
			],
			topicSubscriptionStatus: [
				{ topicName: "test", subscriptionStatus: "OptOut" },
			],
		});
		expect(parseSesEvent(event, expected)).toMatchObject({
			topics: { test: "OPT_OUT", real: "OPT_OUT" },
		});
	});

	it("keeps a partial map rather than inventing preferences for absent topics", () => {
		const event = subscription();
		event.subscription.newTopicPreferences.topicSubscriptionStatus = [
			{ topicName: "test", subscriptionStatus: "OptOut" },
			{ topicName: "other-application", subscriptionStatus: "OptIn" },
		];
		expect(parseSesEvent(event, expected)).toMatchObject({
			topics: { test: "OPT_OUT" },
		});
	});

	it.each([
		{ contactList: "other-list" },
		{ contactList: undefined },
		{ timestamp: "not-a-time" },
		{ newTopicPreferences: undefined },
		{ newTopicPreferences: [] },
		{ newTopicPreferences: { unsubscribeAll: "true" } },
		{
			newTopicPreferences: {
				unsubscribeAll: false,
				topicSubscriptionStatus: {},
			},
		},
	])("rejects malformed native subscription metadata %j", (override) => {
		const event = subscription();
		Object.assign(event.subscription, override);
		expect(parseSesEvent(event, expected)).toBeNull();
	});

	it.each([
		null,
		{},
		[null],
		[{ topicName: "test", subscriptionStatus: "OPT_OUT" }],
		[{ topicName: "test", subscriptionStatus: "Other" }],
		[{ topicName: "test" }],
		[{ subscriptionStatus: "OptOut" }],
		[
			{ topicName: "test", subscriptionStatus: "OptOut" },
			{ topicName: "test", subscriptionStatus: "OptIn" },
		],
		Array.from({ length: 21 }, (_, index) => ({
			topicName: `topic-${index}`,
			subscriptionStatus: "OptOut",
		})),
	])("rejects malformed or duplicate preferences %j", (value) => {
		for (const key of [
			"topicSubscriptionStatus",
			"topicDefaultSubscriptionStatus",
		]) {
			const event = subscription();
			Object.assign(event.subscription.newTopicPreferences, { [key]: value });
			expect(parseSesEvent(event, expected)).toBeNull();
		}
	});

	it("requires account, configuration and a single valid destination for subscriptions too", () => {
		const event = subscription();
		event.mail.sendingAccountId = "999999999999";
		expect(parseSesEvent(event, expected)).toBeNull();
		event.mail = mail();
		event.mail.tags["ses:configuration-set"] = ["different-config"];
		expect(parseSesEvent(event, expected)).toBeNull();
		event.mail = mail();
		event.mail.destination.push("other@example.com");
		expect(parseSesEvent(event, expected)).toBeNull();
	});
});
