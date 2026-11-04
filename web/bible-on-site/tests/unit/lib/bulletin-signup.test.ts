/** @jest-environment node */
jest.mock("server-only", () => ({}));

const mockTxExecute = jest.fn();
const mockTxQueryOne = jest.fn();
const mockTransaction = jest.fn();
jest.mock("@/lib/api-client", () => ({
	transaction: (fn: (conn: object) => unknown) => mockTransaction(fn),
	txExecute: (...args: unknown[]) => mockTxExecute(...args),
	txQueryOne: (...args: unknown[]) => mockTxQueryOne(...args),
}));

import {
	confirmSignup,
	isChallengeToken,
	newChallengeToken,
	normalizeEmail,
	parseSignupBody,
	requestSignup,
} from "@/lib/bulletin-signup";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/bulletin-signup/shared";

const CONN = { connection: true };

describe("bulletin-signup", () => {
	beforeEach(() => {
		mockTransaction.mockImplementation((fn) => fn(CONN));
		mockTxExecute.mockReset().mockResolvedValue({ affectedRows: 1, insertId: 7 });
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

	describe("challenge tokens", () => {
		it("mints 43-char base64url tokens", () => {
			const token = newChallengeToken();
			expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(isChallengeToken(token)).toBe(true);
		});
		it.each(["", "short", `${"x".repeat(43)}!`, null, 42])(
			"rejects %s",
			(token) => {
				expect(isChallengeToken(token)).toBe(false);
			},
		);
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
		const insertParams = () =>
			mockTxExecute.mock.calls.find(([_, sql]) =>
				(sql as string).startsWith("INSERT INTO tanah_daily_bulletin_signup_intent"),
			)?.[2] as unknown[];

		it("supersedes live intents then inserts a pending outbox row", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce(null) // no subscriber row
				.mockResolvedValueOnce({ n: 0 }) // recent per-address
				.mockResolvedValueOnce({ n: 0 }); // global
			await requestSignup(signup);
			expect(mockTxExecute.mock.calls[0]?.[1]).toContain(
				"status = 'superseded'",
			);
			const params = insertParams();
			expect(params[0]).toBe("user@example.com");
			expect(params[1]).toMatch(/^[0-9a-f]{64}$/); // email_hash
			expect(params[2]).toMatch(/^[0-9a-f]{64}$/); // placeholder challenge_hash
			expect(params[3]).toBe("pending");
			expect(params[4]).toBe(CONSENT_TEXT);
			expect(params[5]).toBe(CONSENT_VERSION);
			expect(params[6]).toBe("website-signup:card");
		});

		it("suppresses when the address already holds confirmed consent", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce({ consent_status: "confirmed" })
				.mockResolvedValueOnce({ n: 0 })
				.mockResolvedValueOnce({ n: 0 });
			await requestSignup(signup);
			expect(insertParams()[3]).toBe("suppressed");
		});

		it("suppresses over the per-address throttle", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ n: 3 })
				.mockResolvedValueOnce({ n: 0 });
			await requestSignup(signup);
			expect(insertParams()[3]).toBe("suppressed");
		});

		it("suppresses over the global hourly throttle", async () => {
			mockTxQueryOne
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce({ n: 0 })
				.mockResolvedValueOnce({ n: 500 });
			await requestSignup(signup);
			expect(insertParams()[3]).toBe("suppressed");
		});
	});

	describe("confirmSignup", () => {
		const intent = {
			id: 5,
			email: "user@example.com",
			status: "sent",
			expired: 0,
			consent_source: "website-signup:card",
		};

		it("rejects malformed tokens without touching the database", async () => {
			expect(await confirmSignup("not-a-token")).toBe("invalid");
			expect(mockTransaction).not.toHaveBeenCalled();
		});

		it("returns invalid for an unknown challenge", async () => {
			mockTxQueryOne.mockResolvedValue(null);
			expect(await confirmSignup(newChallengeToken())).toBe("invalid");
		});

		it("confirms a live intent and upserts the subscriber", async () => {
			mockTxQueryOne.mockResolvedValue(intent);
			expect(await confirmSignup(newChallengeToken())).toBe("confirmed");
			const upsert = mockTxExecute.mock.calls.find(([_, sql]) =>
				(sql as string).includes("INSERT INTO tanah_daily_bulletin_subscriber"),
			);
			expect(upsert?.[2]).toEqual([
				"user@example.com",
				"real",
				"website-signup:card",
			]);
			const mark = mockTxExecute.mock.calls.find(([_, sql]) =>
				(sql as string).includes("SET status = 'confirmed'"),
			);
			expect(mark?.[2]).toEqual([7, 5]);
		});

		it("is a successful no-op on replay", async () => {
			mockTxQueryOne.mockResolvedValue({ ...intent, status: "confirmed" });
			expect(await confirmSignup(newChallengeToken())).toBe("confirmed");
			expect(
				mockTxExecute.mock.calls.some(([_, sql]) =>
					(sql as string).includes("INSERT INTO tanah_daily_bulletin_subscriber"),
				),
			).toBe(false);
		});

		it.each(["superseded", "suppressed", "failed", "expired"] as const)(
			"returns invalid for a %s intent",
			async (status) => {
				mockTxQueryOne.mockResolvedValue({ ...intent, status });
				expect(await confirmSignup(newChallengeToken())).toBe("invalid");
			},
		);

		it("marks an expired challenge expired", async () => {
			mockTxQueryOne.mockResolvedValue({ ...intent, expired: 1 });
			expect(await confirmSignup(newChallengeToken())).toBe("expired");
			expect(
				mockTxExecute.mock.calls.some(([_, sql]) =>
					(sql as string).includes("status = 'expired'"),
				),
			).toBe(true);
		});
	});
});
