import {
	CreateContactCommand,
	GetContactCommand,
	SendEmailCommand,
	UpdateContactCommand,
} from "@aws-sdk/client-sesv2";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	queryOne: vi.fn(),
	execute: vi.fn(),
	send: vi.fn(),
	destroy: vi.fn(),
}));
const config = vi.hoisted(() => ({
	region: "il-central-1",
	fromAddress: "sender@example.com",
	contactListName: "daily-bulletin",
	configurationSetName: "daily-bulletin-events",
	senderName: "Bulletin",
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("~/server/db", () => mocks);
vi.mock("~/server/outbox-deadline.server", () => ({
	runOutboxSweep: async (
		_shutdown: unknown,
		operation: (signal: AbortSignal) => Promise<void>,
	) => operation(new AbortController().signal),
}));
vi.mock("~/server/ses-settings.server", () => ({
	loadEmailRuntime: () => config,
}));
vi.mock("@aws-sdk/client-sesv2", async (importOriginal) => ({
	...(await importOriginal<typeof import("@aws-sdk/client-sesv2")>()),
	SESv2Client: class {
		send = mocks.send;
		destroy = mocks.destroy;
	},
}));

import { SesClient, SesSuppressedError } from "~/server/ses-client.server";
import { reconcileSignupOutbox } from "~/server/signup-delivery.server";

const email = "reader@example.com";
const contact = () => ({
	EmailAddress: email,
	ContactListName: "daily-bulletin",
	UnsubscribeAll: false,
	TopicPreferences: [
		{ TopicName: "test", SubscriptionStatus: "OPT_IN" },
		{ TopicName: "real", SubscriptionStatus: "OPT_IN" },
	],
});

function expectSettled(status: string) {
	expect(mocks.execute).toHaveBeenCalledWith(
		expect.stringContaining("ses_status = ?"),
		[status, 7],
	);
	const commands = mocks.send.mock.calls.map(([command]) => command);
	expect(
		commands.some((command) => command instanceof UpdateContactCommand),
	).toBe(false);
	expect(commands.some((command) => command instanceof SendEmailCommand)).toBe(
		false,
	);
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.query.mockResolvedValue([{ id: 7, email }]);
	mocks.queryOne.mockResolvedValue({ consent_status: "confirmed" });
	mocks.execute.mockResolvedValue({ affectedRows: 1 });
});

describe("signup worker with the real SES subscription client", () => {
	it("preserves a concurrent test opt-out when real consent changes after the SES read", async () => {
		const stored = contact();
		mocks.send.mockImplementation(async (command) => {
			if (command instanceof GetContactCommand) {
				const snapshot = structuredClone(stored);
				// Both withdrawals happen after the read's snapshot was taken.
				stored.TopicPreferences[0].SubscriptionStatus = "OPT_OUT";
				mocks.queryOne.mockResolvedValue({ consent_status: "unsubscribed" });
				return snapshot;
			}
			throw new Error("Signup must not overwrite existing preferences");
		});
		await reconcileSignupOutbox();
		expectSettled("opted_out");
		expect(mocks.send).toHaveBeenCalledTimes(1);
		expect(stored.TopicPreferences[0].SubscriptionStatus).toBe("OPT_OUT");

		mocks.send.mockResolvedValue(stored);
		const client = new SesClient(config);
		try {
			await expect(
				client.sendOne({
					to: email,
					audience: "test",
					subject: "Test",
					html: "Test",
				}),
			).rejects.toBeInstanceOf(SesSuppressedError);
		} finally {
			client.destroy();
		}
		expectSettled("opted_out");
	});

	it.each(["topic", "global", "missing topic"])(
		"leaves an existing %s opt-out to the recipient's preference page",
		async (suppression) => {
			const stored = contact();
			if (suppression === "global") stored.UnsubscribeAll = true;
			else if (suppression === "missing topic") stored.TopicPreferences.pop();
			else stored.TopicPreferences[1].SubscriptionStatus = "OPT_OUT";
			mocks.send.mockResolvedValue(stored);
			await reconcileSignupOutbox();
			expectSettled("opted_out");
			expect(mocks.send).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["confirmed", "unsubscribed"])(
		"creates only a missing contact and retains local consent %s after creation",
		async (consent) => {
			mocks.send.mockImplementation(async (command) => {
				if (command instanceof GetContactCommand)
					throw Object.assign(new Error("Missing"), {
						name: "NotFoundException",
					});
				if (command instanceof CreateContactCommand) {
					mocks.queryOne.mockResolvedValue({ consent_status: consent });
					return {};
				}
				throw new Error("Unexpected SES mutation");
			});
			await reconcileSignupOutbox();
			expectSettled(consent === "confirmed" ? "subscribed" : "opted_out");
			const create = mocks.send.mock.calls.find(
				([command]) => command instanceof CreateContactCommand,
			)?.[0];
			expect(create?.input).toMatchObject({
				EmailAddress: email,
				TopicPreferences: [{ TopicName: "real", SubscriptionStatus: "OPT_IN" }],
			});
			expect(mocks.destroy).toHaveBeenCalledOnce();
		},
	);
});
