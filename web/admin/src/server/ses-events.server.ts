import "@tanstack/react-start/server-only";

type Topic = "test" | "real";
type Preference = "OPT_IN" | "OPT_OUT";

export interface SesDeliveryEvent {
	type:
		| "send"
		| "delivery"
		| "bounce"
		| "complaint"
		| "reject"
		| "renderingFailure";
	messageId: string;
	attemptId: string;
	email: string;
	timestamp: string;
	permanent?: boolean;
}

export interface SesSubscriptionEvent {
	type: "subscription";
	email: string;
	timestamp: string;
	unsubscribeAll: boolean;
	topics: Partial<Record<Topic, Preference>>;
}

export type SesEvent = SesDeliveryEvent | SesSubscriptionEvent;

export interface SesEventExpectation {
	accountId: string;
	configurationSetName: string;
	contactListName: string;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 256): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maximum &&
		value.trim() === value &&
		!/\p{Cc}/u.test(value)
	);
}

function emailAddress(value: unknown): string | null {
	if (typeof value !== "string" || value.length === 0 || value.length > 254) {
		return null;
	}
	let separator = -1;
	let hasDomainDot = false;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		const char = value[index];
		if (code < 0x21 || code > 0x7e || '<>(),;:"'.includes(char)) return null;
		if (char === "@") {
			if (separator !== -1 || index === 0) return null;
			separator = index;
		} else if (
			char === "." &&
			separator !== -1 &&
			index > separator + 1 &&
			index < value.length - 1
		) {
			hasDomainDot = true;
		}
	}
	return hasDomainDot ? value.toLowerCase() : null;
}

function singleEmail(value: unknown, objects = false): string | null {
	if (!Array.isArray(value) || value.length !== 1) return null;
	if (!objects) return emailAddress(value[0]);
	return record(value[0]) ? emailAddress(value[0].emailAddress) : null;
}

function timestamp(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
	) {
		return null;
	}
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return null;
	const normalized = date.toISOString();
	// Date.parse otherwise accepts impossible dates such as February 30.
	return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : null;
}

function singleTag(tags: Record<string, unknown>, name: string): string | null {
	if (!Object.hasOwn(tags, name)) return null;
	const value = tags[name];
	return Array.isArray(value) && value.length === 1 && text(value[0])
		? value[0]
		: null;
}

function attemptId(value: string | null): string | null {
	if (!value) return null;
	const match = /^([1-9]\d*)_([A-Za-z0-9_-]+)$/.exec(value);
	if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
	return value;
}

function topicPreferences(
	value: unknown,
): Partial<Record<Topic, Preference>> | null {
	if (value === undefined) return {};
	if (!Array.isArray(value) || value.length > 20) return null;
	const topics: Partial<Record<Topic, Preference>> = {};
	const seen = new Set<string>();
	for (const item of value) {
		if (
			!record(item) ||
			!text(item.topicName) ||
			seen.has(item.topicName) ||
			(item.subscriptionStatus !== "OptIn" &&
				item.subscriptionStatus !== "OptOut")
		) {
			return null;
		}
		seen.add(item.topicName);
		if (item.topicName === "test" || item.topicName === "real") {
			topics[item.topicName] =
				item.subscriptionStatus === "OptIn" ? "OPT_IN" : "OPT_OUT";
		}
	}
	return topics;
}

// Input is the SES JSON body from a trusted SNS -> SQS raw-message destination.
// The consumer must match messageId AND attemptId to its persisted recipient attempt.
// Schema: https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html
export function parseSesEvent(
	payload: unknown,
	expected: SesEventExpectation,
): SesEvent | null {
	try {
		if (
			!expected ||
			!/^\d{12}$/.test(expected.accountId) ||
			!text(expected.configurationSetName) ||
			!text(expected.contactListName) ||
			!record(payload) ||
			!record(payload.mail)
		) {
			return null;
		}
		const mail = payload.mail;
		if (
			mail.sendingAccountId !== expected.accountId ||
			!record(mail.tags) ||
			singleTag(mail.tags, "ses:configuration-set") !==
				expected.configurationSetName ||
			!text(mail.messageId) ||
			!/^[A-Za-z0-9_-]+$/.test(mail.messageId)
		) {
			return null;
		}
		const email = singleEmail(mail.destination);
		const mailTimestamp = timestamp(mail.timestamp);
		if (!email || !mailTimestamp) return null;

		if (payload.eventType === "Subscription") {
			const subscription = payload.subscription;
			if (
				!record(subscription) ||
				subscription.contactList !== expected.contactListName ||
				!record(subscription.newTopicPreferences) ||
				typeof subscription.newTopicPreferences.unsubscribeAll !== "boolean"
			) {
				return null;
			}
			const changedAt = timestamp(subscription.timestamp);
			const preferences = subscription.newTopicPreferences;
			const defaults = topicPreferences(
				preferences.topicDefaultSubscriptionStatus,
			);
			const explicit = topicPreferences(preferences.topicSubscriptionStatus);
			if (!changedAt || !defaults || !explicit) return null;
			return {
				type: "subscription",
				email,
				timestamp: changedAt,
				unsubscribeAll: preferences.unsubscribeAll as boolean,
				topics: { ...defaults, ...explicit },
			};
		}

		const attempt = attemptId(singleTag(mail.tags, "bulletin_attempt"));
		if (!attempt) return null;
		const common = { messageId: mail.messageId, attemptId: attempt, email };
		switch (payload.eventType) {
			case "Send":
				return record(payload.send)
					? { ...common, type: "send", timestamp: mailTimestamp }
					: null;
			case "Delivery": {
				if (!record(payload.delivery)) return null;
				const changedAt = timestamp(payload.delivery.timestamp);
				return changedAt && singleEmail(payload.delivery.recipients) === email
					? { ...common, type: "delivery", timestamp: changedAt }
					: null;
			}
			case "Bounce": {
				if (!record(payload.bounce)) return null;
				const changedAt = timestamp(payload.bounce.timestamp);
				const bounceType = payload.bounce.bounceType;
				if (
					!changedAt ||
					!["Permanent", "Transient", "Undetermined"].includes(
						bounceType as string,
					) ||
					singleEmail(payload.bounce.bouncedRecipients, true) !== email
				) {
					return null;
				}
				return {
					...common,
					type: "bounce",
					timestamp: changedAt,
					permanent: bounceType === "Permanent",
				};
			}
			case "Complaint": {
				if (!record(payload.complaint)) return null;
				const changedAt = timestamp(payload.complaint.timestamp);
				return changedAt &&
					singleEmail(payload.complaint.complainedRecipients, true) === email
					? { ...common, type: "complaint", timestamp: changedAt }
					: null;
			}
			case "Reject":
				return record(payload.reject) && text(payload.reject.reason, 16_384)
					? { ...common, type: "reject", timestamp: mailTimestamp }
					: null;
			case "Rendering Failure":
				return record(payload.failure) &&
					text(payload.failure.errorMessage, 16_384) &&
					text(payload.failure.templateName)
					? { ...common, type: "renderingFailure", timestamp: mailTimestamp }
					: null;
			default:
				return null;
		}
	} catch {
		return null;
	}
}
