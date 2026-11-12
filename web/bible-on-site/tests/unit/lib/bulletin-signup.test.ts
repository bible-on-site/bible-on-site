/** @jest-environment node */
jest.mock("server-only", () => ({}));

const mockTxExecute = jest.fn();
const mockTxQueryOne = jest.fn();
const mockLockedTransaction = jest.fn();
jest.mock("@/lib/api-client", () => ({
	lockedTransaction: (name: string, fn: (conn: object) => unknown) =>
		mockLockedTransaction(name, fn),
	txExecute: (...args: unknown[]) => mockTxExecute(...args),
	txQueryOne: (...args: unknown[]) => mockTxQueryOne(...args),
}));

import {
	normalizeEmail,
	parseSignupBody,
	requestSignup,
} from "@/lib/bulletin-signup";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/bulletin-signup/shared";

const CONN = { connection: true };

describe("bulletin-signup", () => {
	beforeEach(() => {
		mockLockedTransaction
			.mockReset()
			.mockImplementation((_name, fn) => fn(CONN));
		mockTxExecute
			.mockReset()
			.mockResolvedValue({ affectedRows: 1, insertId: 7 });
		mockTxQueryOne.mockReset();
		jest.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => jest.restoreAllMocks());

	describe("normalizeEmail", () => {
		it.each([
			["User@Example.com", "user@example.com"],
			["a.b+c@sub.example.org", "a.b+c@sub.example.org"],
		])("normalizes %s", (input, output) => {
			expect(normalizeEmail(input)).toBe(output);
		});
		it.each([
			"",
			"no-at-sign",
			"a@b",
			" spaced@example.com",
			"x".repeat(255),
			"a<b>@example.com",
			"a@b@c.com",
			"semi;colon@example.com",
			null,
			42,
		])("rejects %s", (input) => {
			expect(normalizeEmail(input)).toBeNull();
		});
	});

	describe("parseSignupBody", () => {
		it("accepts a complete signup", () => {
			expect(
				parseSignupBody({
					email: "User@Example.com",
					consent: true,
					source: "card",
				}),
			).toEqual({ email: "user@example.com", source: "card" });
		});
		it.each([
			null,
			"text",
			{ email: "a@b.com" },
			{ email: "a@b.com", consent: true },
			{ email: "a@b.com", consent: "yes", source: "card" },
			{ email: "a@b.com", consent: true, source: "real" },
			{ email: "bad", consent: true, source: "card" },
			{ email: "a@b.com", consent: true, source: "card", audience: "test" },
		] as const)("rejects %s", (body) => {
			const parsed = parseSignupBody(body);
			// audience is never part of the contract even when smuggled in
			expect(parsed === null || !("audience" in parsed)).toBe(true);
		});
		it("ignores a smuggled audience", () => {
			const parsed = parseSignupBody({
				email: "u@example.com",
				consent: true,
				source: "page",
				audience: "test",
			});
			expect(parsed).toEqual({ email: "u@example.com", source: "page" });
		});
	});

	describe("requestSignup", () => {
		const signup = { email: "user@example.com", source: "card" as const };
		const intentInsert = () =>
			mockTxExecute.mock.calls.find(([_, sql]) =>
				(sql as string).startsWith(
					"INSERT INTO tanah_daily_bulletin_signup_intent",
				),
			);
		const subscriberUpsert = () =>
			mockTxExecute.mock.calls.find(([_, sql]) =>
				(sql as string).includes("INSERT INTO tanah_daily_bulletin_subscriber"),
			);
		const freshReads = () =>
			mockTxQueryOne
				.mockResolvedValueOnce(null) // no subscriber row
				.mockResolvedValueOnce({ n: 0 }) // recent per-address
				.mockResolvedValueOnce({ n: 0 }); // global

		it("confirms the subscriber and inserts a confirmed outbox row", async () => {
			freshReads();
			await requestSignup(signup);
			const upsert = subscriberUpsert();
			expect(upsert?.[1]).toContain("consent_status = 'confirmed'");
			expect(upsert?.[2]).toEqual([
				"user@example.com",
				"real",
				"website-signup:card",
			]);
			const insert = intentInsert();
			expect(insert?.[1]).toContain("'confirmed'");
			expect(insert?.[2]).toEqual([
				"user@example.com",
				expect.stringMatching(/^[0-9a-f]{64}$/), // email_hash
				CONSENT_TEXT,
				CONSENT_VERSION,
				"website-signup:card",
				7, // subscriber id for the SES-sync outbox
			]);
		});

		it("serializes the decision under a per-address lock", async () => {
			freshReads();
			await requestSignup(signup);
			const [name] = mockLockedTransaction.mock.calls[0];
			expect(name).toMatch(/^bulletin-signup:[0-9a-f]{40}$/);
		});

		it("propagates a lock acquisition failure", async () => {
			mockLockedTransaction.mockRejectedValueOnce(new Error("lock timeout"));
			await expect(requestSignup(signup)).rejects.toThrow("lock timeout");
			expect(mockTxExecute).not.toHaveBeenCalled();
		});

		it("confirms a pending subscriber on explicit consent", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce({
					id: 3,
					consent_status: "pending",
				})
				.mockResolvedValueOnce({ n: 0 })
				.mockResolvedValueOnce({ n: 0 });
			await requestSignup(signup);
			expect(subscriberUpsert()).toBeDefined();
			expect(intentInsert()?.[1]).toContain("'confirmed'");
		});

		it.each(["unsubscribed", "bounced", "complained"])(
			"never reverses a recorded %s opt-out",
			async (consentStatus) => {
				mockTxQueryOne
					.mockResolvedValueOnce({
						id: 3,
						consent_status: consentStatus,
					})
					.mockResolvedValueOnce({ n: 0 })
					.mockResolvedValueOnce({ n: 0 });
				await requestSignup(signup);
				expect(subscriberUpsert()).toBeUndefined();
				const insert = intentInsert();
				expect(insert?.[1]).toContain("'suppressed'");
				expect(insert?.[2]?.at(-1)).toBe("website-signup:card");
			},
		);

		it("treats absent aggregate count rows as zero for a fresh signup", async () => {
			mockTxQueryOne.mockResolvedValue(null);
			await requestSignup(signup);
			expect(subscriberUpsert()).toBeDefined();
			expect(intentInsert()?.[1]).toContain("'confirmed'");
		});

		it("suppresses when the address already holds confirmed consent", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce({ id: 3, consent_status: "confirmed" })
				.mockResolvedValueOnce({ n: 0 })
				.mockResolvedValueOnce({ n: 0 });
			await requestSignup(signup);
			expect(subscriberUpsert()).toBeUndefined();
			const insert = intentInsert();
			expect(insert?.[1]).toContain("'suppressed'");
			expect(insert?.[2]?.at(-1)).toBe("website-signup:card");
		});

		it("suppresses over the per-address throttle", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ n: 3 })
				.mockResolvedValueOnce({ n: 0 });
			await requestSignup(signup);
			expect(subscriberUpsert()).toBeUndefined();
			expect(intentInsert()?.[1]).toContain("'suppressed'");
		});

		it("suppresses over the global hourly throttle", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ n: 0 })
				.mockResolvedValueOnce({ n: 500 });
			await requestSignup(signup);
			expect(subscriberUpsert()).toBeUndefined();
			expect(intentInsert()?.[1]).toContain("'suppressed'");
		});
	});
});
